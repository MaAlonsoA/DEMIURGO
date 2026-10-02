// Durable step engine on top of DBOS Transact, in the same Postgres as the domain.
// Flow of a run: prepare (tx) → invoke (agent, at least once) → apply (tx).
// "apply" is idempotent: the mark in step_completions is committed in the same transaction
// as its effects, so a crash and resume never repeat the effect (AC-ESQ-001-07).

import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import { DBOS } from '@dbos-inc/dbos-sdk';
import {
  ATTR,
  type AgentAction,
  type AgentResult,
  ENGINE_SOURCES,
  type EngineSource,
  OUTPUT_SCHEMAS,
  type Provider,
  type ProviderInvocation,
  SPAN,
  type SessionRequest,
  agentRun,
  composeInput,
  composeSystem,
  isDomainError,
  parseActor,
  normalizeOutput,
  packDelta,
  runSchemaOf,
  sha256Hex,
  system,
} from '@demiurgo/domain';
import { sql } from 'kysely';
import { APPLIERS, CHECKERS } from '../actions/appliers.ts';
import { DEFAULT_AGENTS, loadAgentCatalog, schemaVersion } from '../agents/catalog.ts';
import { type Engine, couldNotAnswer, fallbackOf, sameEngine } from '../assignments/assignments.ts';
import { type CallMeta, type CallSession, callProvider, closeOrphanCalls, noCallSession } from '../assignments/calls.ts';
import { previousSession, saveSession, sessionDirectory, sessionKey } from '../assignments/sessions.ts';
import { executeCommand, inTransaction } from '../bus/bus.ts';
import { graphUpToDate } from '../context/graph.ts';
import type { Db, Tx } from '../db/connection.ts';
import type { Row } from '../db/schema.ts';
import { traceParentOf } from '../observe/trace-contexts.ts';
import type { DeferredRunRequest, WorkflowEngine, Services } from '../services.ts';
import { cancelBuildWorkflow, closeWithdrawnPullRequest, startBuildWorkflow } from '../build/orchestrator.ts';
import { type EngineMark, buildEngineMark, cliVersionOf } from '../harness/engine.ts';
import { stepSpan, systemInteraction } from './observe.ts';
import { starters, reconcilers, setEngineServices, engineServices } from './registry.ts';

export {
  registerUpdateStarter,
  registerAssessmentStarter,
  registerReconciler,
  engineServices,
} from './registry.ts';
export type { WorkflowStarter } from './registry.ts';

const compress = promisify(gzip);
const ENGINE = system('engine');

/**
 * Fixed application version for DBOS: without it, DBOS derives it from the code, and a
 * change between a crash and restart would prevent recovering pending workflows. Bump it
 * by hand only when a workflow's shape changes incompatibly.
 */
export const WORKFLOWS_VERSION = 'demiurgo-v2-workflows-1';

/** Retries for transactional steps on transient failures (connection drop, lock). */
const RETRIES = { retriesAllowed: true, maxAttempts: 3, intervalSeconds: 1 } as const;

const controllers = new Map<string, AbortController>();

// DBOS does not allow starting a workflow from inside a step. Starts requested inside a
// workflow (e.g. after committing a step) are deferred to a timer created when the engine
// launches, outside any DBOS context. If the process crashes first, startup reconciliation recovers them.
const deferred: (() => Promise<void>)[] = [];
let dispatcher: NodeJS.Timeout | undefined;

function startOutsideWorkflow(startup: () => Promise<void>): Promise<void> {
  if (!DBOS.isWithinWorkflow()) return startup();
  deferred.push(startup);
  return Promise.resolve();
}

async function drainDeferred(): Promise<void> {
  while (deferred.length > 0) {
    const next = deferred.shift();
    try {
      await next?.();
    } catch (e) {
      console.error(JSON.stringify({ level: 'error', m: 'Could not start a deferred workflow', error: String(e) }));
    }
  }
}

/** The deferred starts run from a timer, outside any interaction: they get a system root (§7.2). */
async function dispatchDeferred(): Promise<void> {
  if (deferred.length === 0) return;
  const s = engineServices();
  if (s.observer.currentInteractionId() !== null) return drainDeferred();
  return systemInteraction(s, 'dispatchDeferred', drainDeferred);
}
let onStepComplete: ((step: string, id: string) => void | Promise<void>) | undefined;

function requireServices(): Services {
  return engineServices();
}

export const workflowRunId = (runId: string): string => `run:${runId}`;

const runEntity = (runId: string) => ({ type: 'ai_run', id: runId }) as const;

async function prepare(runId: string, projectId: string): Promise<string> {
  const s = requireServices();
  return stepSpan(
    s,
    SPAN.runPrepare,
    runEntity(runId),
    { [ATTR.runId]: runId, [ATTR.projectId]: projectId },
    async (span) => {
      const run = await s.db
        .selectFrom('ai_runs')
        .select(['state', 'retry_of'])
        .where('id', '=', runId)
        .executeTakeFirstOrThrow();
      if (run.retry_of) {
        // A retry is another interaction, linked to the run it retries (§5.1).
        span.setAttributes({ [ATTR.retryOf]: run.retry_of });
        const original = await traceParentOf(s.db, 'ai_run', run.retry_of);
        if (original) span.addLink(original, { [ATTR.runId]: run.retry_of });
      }
      if (run.state === 'queued') {
        await executeCommand(s, { command: 'run.begin', actor: ENGINE, projectId, entityId: runId, data: {} });
        return 'running';
      }
      return run.state;
    },
    (state) => state,
  );
}

/**
 * Where the run's engine came from (`override`, `agent`, `group`): the journal is its only source,
 * in the `after` of the request or retry that created the run (§7.4).
 */
async function engineSourceOf(db: Db, runId: string): Promise<EngineSource | null> {
  const row = await db
    .selectFrom('events')
    .select('after')
    .where('entity_id', '=', runId)
    .where('command', 'in', ['run.request', 'run.retry'])
    .orderBy('seq', 'desc')
    .executeTakeFirst();
  const after = row?.after;
  const source = typeof after === 'object' && after !== null ? (after as { engine_source?: unknown }).engine_source : undefined;
  return typeof source === 'string' && (ENGINE_SOURCES as readonly string[]).includes(source) ? (source as EngineSource) : null;
}

/** The text of a raw output, whatever the adapter delivered, for the `output_raw` note. */
function rawOutputText(rawOutput: unknown): string {
  if (typeof rawOutput === 'string') return rawOutput;
  try {
    return JSON.stringify(rawOutput) ?? 'undefined';
  } catch {
    return String(rawOutput);
  }
}

/** How a run talked to its provider: recorded with the run, and the session kept for the thread. */
export type SessionOutcome = {
  mode: 'none' | 'fresh' | 'resumed';
  key: string | null;
  providerSessionId: string | null;
  deltaHash: string | null;
};

/** The run ran on its backup engine: which one, the one it replaced and why. */
export type FallbackOutcome = { engine: Engine; from: Engine; reason: string };

export type InvokeResult = AgentResult & { session?: SessionOutcome; fallback?: FallbackOutcome };

/**
 * Runs the run's agent on its engine (FDR-AGE-002): composes the prompt, decides the provider
 * session and calls the provider through the recorder. The session is resumed, sending only the
 * delta, if the agent keeps one per thread, this is not a retry, the conversation's last run
 * completed and the new pack only appends to its pack. Otherwise it starts over with the whole pack.
 * When the engine couldn't answer at all (unreachable, or no answer in time) and the agent has a
 * backup, the whole pack goes once more to the backup, without a session, and the run says so.
 */
async function invoke(runId: string, projectId: string): Promise<InvokeResult> {
  const s = requireServices();
  return stepSpan(
    s,
    SPAN.runInvoke,
    runEntity(runId),
    { [ATTR.runId]: runId, [ATTR.projectId]: projectId },
    () => invokeInSpan(s, runId),
    (r) => (r.state === 'ok' ? 'ok' : r.failureKind),
  );
}

/** The scope's id (the thread) or the run's, shortened, for the visible name of a session (§5.4). */
function shortScopeOf(scope: unknown, runId: string): string {
  const id = typeof scope === 'object' && scope !== null ? (scope as { id?: unknown }).id : undefined;
  return (typeof id === 'string' && id.length > 0 ? id : runId).slice(0, 8);
}

async function invokeInSpan(s: Services, runId: string): Promise<InvokeResult> {
  const run = await s.db.selectFrom('ai_runs').selectAll().where('id', '=', runId).executeTakeFirstOrThrow();
  const pack = await s.db
    .selectFrom('context_packs')
    .select(['hash', 'content'])
    .where('id', '=', run.context_pack_id ?? '')
    .executeTakeFirstOrThrow();
  const action = run.action as AgentAction;
  const fail = (failureKind: 'infra', message: string): InvokeResult => ({
    state: 'error',
    failureKind,
    message,
    rawEvents: '',
    provider: run.provider,
    model: run.requested_model ?? 'unknown',
  });
  const agent = (await loadAgentCatalog()).get(run.agent ?? DEFAULT_AGENTS[action]);
  if (!agent || run.method !== `${agent.id}@${agent.version}`) {
    return fail('infra', `The agent ${run.agent ?? action} changed since the run was requested: retry it.`);
  }
  const provider = s.providers.get(run.provider);
  if (!provider) return fail('infra', `${run.provider} isn't available here: retry it with another engine.`);
  const model = run.requested_model ?? '';
  const { system: systemPrompt, promptHash } = composeSystem(agent, agent.skillDefinitions);
  const full = composeInput({ action, packHash: pack.hash, content: pack.content });
  const engineSource = await engineSourceOf(s.db, runId);

  let session: SessionRequest = { mode: 'none' };
  let key: string | null = null;
  let input = full;
  let deltaHash: string | null = null;
  // The session as the evidence sees it: our id, the base run and pack, the delta text's hash.
  let sessionSeen: CallSession = { id: null, mode: 'none', baseRunId: null, basePackHash: null, deltaHash: null, keyHash: null };
  if (agent.session === 'thread' && provider.sessions) {
    key = sessionKey({ scope: run.scope, agent: agent.id, version: agent.version, provider: provider.id, model });
    const keyHash = sha256Hex(key);
    const name = `demiurgo ${agent.id} ${shortScopeOf(run.scope, runId)}`;
    const directory = sessionDirectory(s.agentSessionsDir, provider.id, key);
    // The engine decides the id of a new session (§5.4); adapters that can fix it use it as is.
    session = { mode: 'fresh', directory, id: randomUUID(), name };
    sessionSeen = { id: session.id ?? null, mode: 'fresh', baseRunId: null, basePackHash: null, deltaHash: null, keyHash, name };
    const previous = run.retry_of ? null : await previousSession(s.db, key);
    const last = previous
      ? await s.db
          .selectFrom('ai_runs')
          .innerJoin('context_packs', 'context_packs.id', 'ai_runs.context_pack_id')
          .select(['ai_runs.state', 'context_packs.hash', 'context_packs.content'])
          .where('ai_runs.id', '=', previous.lastRunId)
          .executeTakeFirst()
      : undefined;
    if (previous && last?.state === 'completed') {
      const delta = packDelta(last.content, pack.content);
      if (delta.appendOnly) {
        session = { mode: 'resumed', directory, id: previous.providerSessionId };
        input = composeInput({ action, packHash: pack.hash, content: delta.added, continuation: { basePackHash: last.hash } });
        deltaHash = delta.hash;
        sessionSeen = {
          id: previous.providerSessionId,
          mode: 'resumed',
          baseRunId: previous.lastRunId,
          basePackHash: last.hash,
          deltaHash: s.observer.text('delta', JSON.stringify(delta.added)),
          keyHash,
          name,
        };
      }
    }
  }

  const control = new AbortController();
  controllers.set(runId, control);
  try {
    // A reply-only agent isn't asked for question options: only its reply and, on the question in
    // progress, the idea it leads to are applied.
    const schema = runSchemaOf(action, agent.replyOnly ? replyOnlyContent(pack.content) : pack.content);
    // The texts as sent, with their full hashes (§5.5), before the call.
    s.observer.text('system_prompt', systemPrompt);
    const inputHash = s.observer.text('input', input);
    const schemaHash = s.observer.text('schema', JSON.stringify(schema));
    const meta: CallMeta = {
      projectId: run.project_id,
      runId,
      updateId: null,
      agent: agent.id,
      agentVersion: agent.version,
      promptHash,
      engineSource,
      session: sessionSeen,
      attempt: 1,
      inputHash,
      schemaHash,
      schemaVersion: run.schema_version,
      packHash: pack.hash,
      retryOf: run.retry_of,
    };
    const base: Omit<ProviderInvocation, 'input' | 'session'> = {
      system: systemPrompt,
      schema,
      model,
      effort: run.effort,
      timeMs: agent.timeLimitSeconds * 1000,
      signal: control.signal,
      task: { action, context: { hash: pack.hash, content: pack.content } },
    };
    let result = await callProvider(s, provider, meta, { ...base, input, session });
    let attempt = 1;
    let mode = session.mode;
    let asked: SessionRequest = session;
    if (session.mode === 'resumed' && result.state === 'error' && result.failureKind === 'agent_error') {
      // The provider may have lost the session: once more from scratch, on the same engine and
      // model, with a new session of ours (plan B, attempt 2).
      const again: SessionRequest = { mode: 'fresh', directory: session.directory, id: randomUUID(), name: sessionSeen.name };
      const seen: CallSession = {
        id: again.id ?? null,
        mode: 'fresh',
        baseRunId: null,
        basePackHash: null,
        deltaHash: null,
        keyHash: sessionSeen.keyHash,
        name: sessionSeen.name,
      };
      result = await callProvider(
        s,
        provider,
        { ...meta, attempt: 2, session: seen, inputHash: s.observer.text('input', full) },
        { ...base, input: full, session: again },
      );
      attempt = 2;
      mode = 'fresh';
      deltaHash = null;
      asked = again;
    }
    const backup =
      couldNotAnswer(result) && engineSource !== 'override' && engineSource !== 'fallback'
        ? await fallbackOf(s.db, s.providers, agent.id)
        : null;
    const backupProvider = backup && !backup.problem ? s.providers.get(backup.provider) : undefined;
    const from: Engine = { provider: run.provider, model, effort: run.effort };
    if (backup && backupProvider && !control.signal.aborted && !sameEngine(backup, from)) {
      const engine: Engine = { provider: backup.provider, model: backup.model, effort: backup.effort };
      attempt += 1;
      const again = await callProvider(
        s,
        backupProvider,
        {
          ...meta,
          attempt,
          engineSource: 'fallback',
          session: { id: null, mode: 'none', baseRunId: null, basePackHash: null, deltaHash: null, keyHash: null },
          inputHash: s.observer.text('input', full),
        },
        { ...base, model: engine.model, effort: engine.effort, input: full, session: { mode: 'none' } },
      );
      const reason = result.state === 'error' ? result.message : 'It could not answer.';
      const answer: InvokeResult = {
        ...again,
        session: { mode: 'none', key: null, providerSessionId: null, deltaHash: null },
        fallback: { engine, from, reason },
      };
      return await corrected(s, run, answer, {
        provider: backupProvider,
        meta: { ...meta, engineSource: 'fallback' },
        base: { ...base, model: engine.model, effort: engine.effort },
        full,
        attempt,
        session: null,
      });
    }
    const resumedId = session.mode === 'resumed' && mode === 'resumed' ? session.id : null;
    const providerSessionId = mode === 'none' ? null : (result.sessionId ?? resumedId);
    const answer: InvokeResult = { ...result, session: { mode, key, providerSessionId, deltaHash } };
    return await corrected(s, run, answer, {
      provider,
      meta,
      base,
      full,
      attempt,
      session:
        asked.mode !== 'none' && providerSessionId
          ? { request: { mode: 'resumed', directory: asked.directory, id: providerSessionId }, seen: sessionSeen }
          : null,
    });
  } catch (e) {
    return fail('infra', `The adapter failed: ${String(e)}`);
  } finally {
    controllers.delete(runId);
  }
}

/** What the engine checks in an answer before applying it: its schema, then what the action's checker finds. */
async function problemsOf(db: Db, run: Row<'ai_runs'>, rawOutput: unknown): Promise<string[]> {
  const action = run.action as AgentAction;
  const v = OUTPUT_SCHEMAS[action].safeParse(normalizeOutput(action, rawOutput));
  if (!v.success) return v.error.issues.slice(0, 20).map((i) => `${i.path.map(String).join('.') || 'output'}: ${i.message}`);
  const checker = CHECKERS[action] as ((e: { db: Db; run: Row<'ai_runs'>; output: unknown }) => Promise<string[]>) | undefined;
  return checker ? checker({ db, run, output: v.data }) : [];
}

type Correction = {
  provider: Provider;
  meta: CallMeta;
  base: Omit<ProviderInvocation, 'input' | 'session'>;
  full: string;
  attempt: number;
  /** The provider session the answer came from, to ask for the correction there; null to send it all again. */
  session: { request: SessionRequest & { mode: 'resumed' }; seen: CallSession } | null;
};

/**
 * An answer that fails the schema or its action's checks goes back to the same engine once, with the
 * problems, instead of being dropped whole for one of them: in its session when it has one, or with
 * the whole input and its own answer otherwise. The corrected answer replaces it only if the engine
 * gave one; the engine's word is still checked when it is applied.
 */
async function corrected(s: Services, run: Row<'ai_runs'>, answer: InvokeResult, c: Correction): Promise<InvokeResult> {
  if (answer.state !== 'ok' || c.base.signal?.aborted) return answer;
  const problems = await problemsOf(s.db, run, answer.rawOutput);
  if (problems.length === 0) return answer;
  const note = [
    "Your previous answer can't be used as it is:",
    ...problems.map((p) => `- ${p}`),
    'Answer again with the whole output: fix only these problems and keep everything else as it was.',
  ].join('\n');
  const input = c.session ? note : `${c.full}\n\nYour previous answer:\n${rawOutputText(answer.rawOutput)}\n\n${note}`;
  const again = await callProvider(
    s,
    c.provider,
    {
      ...c.meta,
      attempt: c.attempt + 1,
      session: c.session
        ? {
            ...c.session.seen,
            id: c.session.request.id,
            mode: 'resumed',
            baseRunId: run.id,
            deltaHash: s.observer.text('delta', note),
          }
        : noCallSession(),
      inputHash: s.observer.text('input', input),
    },
    { ...c.base, input, session: c.session?.request ?? { mode: 'none' } },
  );
  if (again.state !== 'ok') return answer;
  const session =
    answer.session && c.session
      ? { ...answer.session, providerSessionId: again.sessionId ?? c.session.request.id }
      : answer.session;
  return { ...again, session, ...(answer.fallback ? { fallback: answer.fallback } : {}) };
}

/** The run's session columns, as run.complete and run.fail record them. */
function sessionData(r: InvokeResult) {
  return r.session
    ? { mode: r.session.mode, provider_session_id: r.session.providerSessionId, delta_hash: r.session.deltaHash }
    : null;
}

/**
 * The engine mark of the call that ended the run (salud-del-harness §9.3): the engine that ran it (the backup's when it
 * ran on the backup), the model the provider reported and the CLI's version (the stream's own, else `<cli> --version`).
 * Never throws: marking must not stop the run it marks.
 */
async function engineMarkOfResult(r: InvokeResult, run: Row<'ai_runs'>): Promise<EngineMark | null> {
  try {
    const provider = r.provider || run.provider || '';
    const model = r.fallback?.engine.model ?? run.requested_model ?? r.model;
    if (!provider || !model) return null;
    return buildEngineMark({ provider, model, modelReported: r.model, cliVersion: r.details?.cliVersion ?? (await cliVersionOf(provider)) });
  } catch {
    return null;
  }
}

function summarizeErrors(issues: readonly { path: readonly PropertyKey[]; message: string }[]): string {
  return issues
    .slice(0, 8)
    .map((i) => `${i.path.map(String).join('.') || 'output'}: ${i.message}`)
    .join('; ');
}

async function apply(runId: string, projectId: string, r: InvokeResult, workflow: string): Promise<string> {
  const s = requireServices();
  return stepSpan(
    s,
    SPAN.runApply,
    runEntity(runId),
    { [ATTR.runId]: runId, [ATTR.projectId]: projectId },
    async (span) => {
      // The raw output, whole, before validation: an invalid_output still leaves it (§7.4).
      if (r.state === 'ok') span.setAttributes({ [ATTR.outputHash]: s.observer.text('output_raw', rawOutputText(r.rawOutput)) });
      return applyInSpan(s, runId, projectId, r, workflow);
    },
    (state) => state,
  );
}

async function applyInSpan(s: Services, runId: string, projectId: string, r: InvokeResult, workflow: string): Promise<string> {
  const final = await inTransaction(s, async (execute, trx) => {
    // Same lock order as the bus (project, then entity): no deadlocks.
    await sql`select 1 from projects where id = ${projectId}::uuid for update`.execute(trx);
    const done = await trx
      .selectFrom('step_completions')
      .select('result')
      .where('workflow_id', '=', workflow)
      .where('step', '=', 'apply')
      .executeTakeFirst();
    if (done) return String(done.result);
    const run = await trx.selectFrom('ai_runs').selectAll().where('id', '=', runId).forUpdate().executeTakeFirstOrThrow();
    let state = run.state;
    if (run.state === 'running') {
      const attempt =
        Number(
          (
            await trx
              .selectFrom('ai_run_logs')
              .select((eb) => eb.fn.countAll().as('n'))
              .where('run_id', '=', runId)
              .executeTakeFirst()
          )?.n ?? 0,
        ) + 1;
      await trx
        .insertInto('ai_run_logs')
        .values({ project_id: projectId, run_id: runId, attempt: attempt, raw_gzip: await compress(r.rawEvents) })
        .execute();
      const base = { actor: ENGINE, projectId, entityId: runId, cause: { run: runId } };
      const action = run.action as AgentAction;
      let problems: string[] = [];
      if (r.state === 'error') {
        await execute({
          ...base,
          command: 'run.fail',
          data: {
            failure_kind: r.failureKind,
            error: r.message,
            usage: r.usage ?? null,
            model: r.model,
            session: sessionData(r),
            fallback: r.fallback ?? null,
            engine: await engineMarkOfResult(r, run),
          },
        });
        state = 'failed';
      } else if (schemaVersion(action) !== run.schema_version) {
        // The schema is fixed per run (I7): if the code changed since it was requested, it isn't validated against a different one.
        await execute({
          ...base,
          command: 'run.fail',
          data: {
            failure_kind: 'infra',
            error: "The action's output schema changed since the run was requested.",
            usage: r.usage,
            model: r.model,
            session: sessionData(r),
            fallback: r.fallback ?? null,
            engine: await engineMarkOfResult(r, run),
          },
        });
        state = 'failed';
      } else {
        const v = OUTPUT_SCHEMAS[action].safeParse(normalizeOutput(action, r.rawOutput));
        if (!v.success) {
          // Output outside the schema: no effect besides the run's own failure (I7).
          await execute({
            ...base,
            command: 'run.fail',
            data: {
              failure_kind: 'invalid_output',
              error: summarizeErrors(v.error.issues),
              usage: r.usage,
              model: r.model,
              session: sessionData(r),
              fallback: r.fallback ?? null,
              engine: await engineMarkOfResult(r, run),
            },
          });
          state = 'failed';
        } else if ((problems = await problemsOf(trx, run, r.rawOutput)).length > 0) {
          // What the action's checker still finds after the one correction: no effect besides the run's own failure.
          await execute({
            ...base,
            command: 'run.fail',
            data: {
              failure_kind: 'invalid_output',
              error: problems.slice(0, 8).join('; '),
              usage: r.usage,
              model: r.model,
              session: sessionData(r),
              fallback: r.fallback ?? null,
              engine: await engineMarkOfResult(r, run),
            },
          });
          state = 'failed';
        } else {
          const applier = APPLIERS[action] as
            | ((e: { trx: typeof trx; execute: typeof execute; run: typeof run; output: unknown }) => Promise<void>)
            | undefined;
          if (!applier) throw new Error(`There is no applier for "${action}".`);
          await applier({ trx, execute: (p) => execute({ cause: { run: runId }, ...p }), run, output: v.data });
          await execute({
            ...base,
            command: 'run.complete',
            data: { output: v.data, usage: r.usage, model: r.model, session: sessionData(r), fallback: r.fallback ?? null, engine: await engineMarkOfResult(r, run) },
          });
          state = 'completed';
        }
      }
      // The conversation's session now ends at this run: a later run resumes it only if this one completed.
      if (r.session?.key && r.session.providerSessionId) {
        await saveSession(trx, {
          key: r.session.key,
          projectId,
          provider: run.provider,
          providerSessionId: r.session.providerSessionId,
          runId,
        });
      }
    }
    await trx
      .insertInto('step_completions')
      .values({ workflow_id: workflow, step: 'apply', result: JSON.stringify(state) })
      .execute();
    return state;
  });
  await onStepComplete?.('apply', runId);
  return final;
}

async function runWorkflow(runId: string, projectId: string): Promise<string> {
  const workflow = DBOS.workflowID ?? workflowRunId(runId);
  const state = await DBOS.runStep(() => prepare(runId, projectId), { name: 'prepare', ...RETRIES });
  if (state !== 'running') return state;
  const result = await DBOS.runStep(() => invoke(runId, projectId), { name: 'invoke' });
  try {
    return await DBOS.runStep(() => apply(runId, projectId, result, workflow), { name: 'apply', ...RETRIES });
  } catch (e) {
    await DBOS.runStep(() => failForInfrastructure(runId, projectId, e), { name: 'fail', ...RETRIES });
    return 'failed';
  }
}

/** A system error while applying leaves the run failed (infra), never stuck. */
async function failForInfrastructure(runId: string, projectId: string, e: unknown): Promise<void> {
  const s = requireServices();
  await stepSpan(
    s,
    SPAN.runFail,
    runEntity(runId),
    { [ATTR.runId]: runId, [ATTR.projectId]: projectId },
    async () => {
      const run = await s.db.selectFrom('ai_runs').select('state').where('id', '=', runId).executeTakeFirstOrThrow();
      if (run.state !== 'running') return run.state;
      await executeCommand(s, {
        command: 'run.fail',
        actor: ENGINE,
        projectId,
        entityId: runId,
        data: { failure_kind: 'infra', error: `Error applying the output: ${String(e).slice(0, 3000)}` },
      });
      return 'failed';
    },
    (state) => state,
  );
}

/** What shapes a reply-only agent's schema: only the question in progress, never the questions. */
function replyOnlyContent(content: unknown): unknown {
  const q = content && typeof content === 'object' ? (content as { question_in_progress?: unknown }).question_in_progress : null;
  return typeof q === 'string' ? { question_in_progress: q } : null;
}

const runWorkflowRegistered = DBOS.registerWorkflow(runWorkflow, { name: 'demiurgo.run' });

// Durable response to a person's message: waits for knowledge to be up to date and
// requests the exploration_chat run exactly once (marked in step_completions). Knowledge that went
// stale again since the wait (another update started) is not a reason to drop the answer: the
// request is not marked and the workflow waits again.
async function requestResponse(
  workflow: string,
  projectId: string,
  explorationId: string,
  questionId: string | null,
  agent: string | null,
  input: Record<string, unknown> | null = null,
  request: DeferredRunRequest | null = null,
): Promise<'requested' | 'stale'> {
  const s = requireServices();
  return stepSpan(
    s,
    SPAN.responseRequest,
    messageEntity(workflow),
    { [ATTR.projectId]: projectId, [ATTR.entityId]: messageOf(workflow) },
    () => requestResponseInSpan(s, workflow, projectId, explorationId, questionId, agent, input, request),
    (r) => r,
  );
}

async function requestResponseInSpan(
  s: Services,
  workflow: string,
  projectId: string,
  explorationId: string,
  questionId: string | null,
  agent: string | null,
  input: Record<string, unknown> | null = null,
  request: DeferredRunRequest | null = null,
): Promise<'requested' | 'stale'> {
  return inTransaction(s, async (execute, trx) => {
    await sql`select 1 from projects where id = ${projectId}::uuid for update`.execute(trx);
    const done = await trx
      .selectFrom('step_completions')
      .select('step')
      .where('workflow_id', '=', workflow)
      .where('step', '=', 'request')
      .executeTakeFirst();
    if (done) return 'requested';
    if (!(await graphUpToDate(trx, projectId)).upToDate) return 'stale';
    if (request) {
      // A person's queued request: the same run.request, with the person as actor.
      try {
        await execute({
          command: 'run.request',
          actor: parseActor(request.actor),
          projectId,
          data: {
            action: request.action,
            ...(request.agent ? { agent: request.agent } : {}),
            scope: request.scope,
            input: request.input,
          },
        });
      } catch (e) {
        // What is left is a refusal (the draft was made meanwhile, the engine went away): it is
        // logged and not retried; the person sees the thread's state and asks again if they need to.
        if (!isDomainError(e) || !['guard', 'validation'].includes(e.type)) throw e;
        s.logger.error('A queued request was not made', { action: request.action, reason: e.reasons.join(' ') });
      }
      await trx
        .insertInto('step_completions')
        .values({ workflow_id: workflow, step: 'request', result: JSON.stringify('ok') })
        .execute();
      return 'requested';
    }
    const exploration = await trx.selectFrom('explorations').select('state').where('id', '=', explorationId).executeTakeFirst();
    // A thread's automatic first turn is not needed once the person wrote in it (e.g. «Design the
    // next one» opens the thread and posts the person's request, which is answered on its own).
    const firstTurnTaken =
      input?.thread_opened === true &&
      (await trx
        .selectFrom('messages')
        .select('id')
        .where('exploration_id', '=', explorationId)
        .where('author', 'like', 'human:%')
        .executeTakeFirst()) !== undefined;
    if (exploration?.state === 'active' && !firstTurnTaken) {
      try {
        await execute({
          command: 'run.request',
          // A person's message is answered by the conversation; a system request (a stage opened)
          // is the design engine's.
          actor: system(messageOf(workflow) ? 'conversation' : 'design'),
          projectId,
          data: {
            action: 'exploration_chat',
            ...(agent ? { agent } : {}),
            scope: { type: 'exploration', id: explorationId },
            input: questionId ? { question_id: questionId } : (input ?? {}),
            ...(messageOf(workflow) ? { answers_message: messageOf(workflow) } : {}),
          },
        });
      } catch (e) {
        // Knowledge is up to date here, so what is left is the engine: it was checked when the
        // message was posted, and if it went away since, the answer is not requested (the person
        // asks again) instead of retrying the workflow forever.
        if (!isDomainError(e) || !['guard', 'validation'].includes(e.type)) throw e;
        s.logger.error('The answer to a message was not requested', { exploration: explorationId, reason: e.reasons.join(' ') });
        await abandonIn(execute, trx, projectId, workflow, e.reasons.join(' ') || e.message);
      }
    } else {
      await abandonIn(execute, trx, projectId, workflow, 'The thread is no longer active.');
    }
    await trx
      .insertInto('step_completions')
      .values({ workflow_id: workflow, step: 'request', result: JSON.stringify('ok') })
      .execute();
    return 'requested';
  });
}

/**
 * How long an answer waits for knowledge updates in flight: real classifiers take minutes (two
 * calls and the reviewer, each with its own time limit, one update after another). Checked every
 * 0.5 s during the first minute and every 5 s after.
 */
const RESPONSE_PATIENCE_MS = 30 * 60_000;
let responsePatienceMs = RESPONSE_PATIENCE_MS;

/** The message a response workflow answers: its id is `response:<messageId>`. */
const messageOf = (workflow: string): string | null => (workflow.startsWith('response:') ? workflow.slice(9) : null);

/** The entity of a response flow, for the spans of its steps (§7.4). */
function messageEntity(workflow: string): { type: 'message'; id: string } | null {
  const id = messageOf(workflow);
  return id ? { type: 'message', id } : null;
}

/** The same, inside the request's transaction (the run could not be requested). */
async function abandonIn(
  execute: (p: Parameters<typeof executeCommand>[1]) => Promise<unknown>,
  trx: Tx,
  projectId: string,
  workflow: string,
  reason: string,
): Promise<void> {
  const messageId = messageOf(workflow);
  if (!messageId) return;
  const m = await trx.selectFrom('messages').select('response').where('id', '=', messageId).executeTakeFirst();
  if (m?.response !== 'waiting') return;
  await execute({
    command: 'message.abandon_response',
    actor: system('conversation'),
    projectId,
    entityId: messageId,
    data: { reason: reason.slice(0, 2000) },
  });
}

/** Leaves the message's answer abandoned, with its event, so the web can offer to ask again. */
async function abandonResponse(projectId: string, workflow: string, reason: string): Promise<void> {
  const messageId = messageOf(workflow);
  if (!messageId) return;
  const s = requireServices();
  await stepSpan(
    s,
    SPAN.responseAbandon,
    { type: 'message', id: messageId },
    { [ATTR.projectId]: projectId, [ATTR.entityId]: messageId },
    async () => {
      const m = await s.db.selectFrom('messages').select('response').where('id', '=', messageId).executeTakeFirst();
      if (m?.response !== 'waiting') return m?.response ?? 'none';
      await executeCommand(s, {
        command: 'message.abandon_response',
        actor: system('conversation'),
        projectId,
        entityId: messageId,
        data: { reason },
      });
      return 'abandoned';
    },
    (state) => state,
  );
}

/** Whether the project's knowledge is up to date, inside the `response.freshness` step span. */
async function freshness(workflow: string, projectId: string): Promise<{ upToDate: boolean }> {
  const s = requireServices();
  return stepSpan(
    s,
    SPAN.responseFreshness,
    messageEntity(workflow),
    { [ATTR.projectId]: projectId, [ATTR.entityId]: messageOf(workflow) },
    () => s.db.transaction().execute((trx) => graphUpToDate(trx, projectId)),
    (r) => (r.upToDate ? 'up_to_date' : 'stale'),
  );
}

async function respondWorkflow(
  projectId: string,
  explorationId: string,
  questionId: string | null,
  agent: string | null = null,
  // Appended last so workflows recorded with four arguments still recover.
  input: Record<string, unknown> | null = null,
  // Appended last, after `input`: workflows recorded without it recover with no request.
  request: DeferredRunRequest | null = null,
): Promise<void> {
  const workflow = DBOS.workflowID ?? `response:${explorationId}`;
  let waited = 0;
  for (;;) {
    for (;;) {
      const upToDate = await DBOS.runStep(() => freshness(workflow, projectId), { name: 'freshness' });
      if (upToDate.upToDate || waited >= responsePatienceMs) break;
      const pause = waited < 60_000 ? 500 : 5000;
      await DBOS.sleepms(pause);
      waited += pause;
    }
    await onStepComplete?.('freshness', workflow);
    const requested = await DBOS.runStep(() => requestResponse(workflow, projectId, explorationId, questionId, agent ?? null, input, request), {
      name: 'request',
      ...RETRIES,
    });
    if (requested === 'requested') return;
    if (waited >= responsePatienceMs) {
      requireServices().logger.error('The answer to a message was not requested: knowledge stayed out of date', {
        exploration: explorationId,
      });
      await DBOS.runStep(
        () => abandonResponse(projectId, workflow, 'Knowledge stayed out of date for too long; ask DEMIURGO again.'),
        { name: 'abandon', ...RETRIES },
      );
      return;
    }
  }
}

const respondWorkflowRegistered = DBOS.registerWorkflow(respondWorkflow, { name: 'demiurgo.respond' });

export const dbosEngine: WorkflowEngine = {
  async startRun(runId, projectId) {
    // With the same workflowID, DBOS doesn't repeat the workflow: it returns the existing one.
    await startOutsideWorkflow(async () => {
      await DBOS.startWorkflow(runWorkflowRegistered, { workflowID: workflowRunId(runId) })(runId, projectId);
    });
  },
  async cancelRun(runId) {
    controllers.get(runId)?.abort();
    await DBOS.cancelWorkflow(workflowRunId(runId)).catch(() => undefined);
  },
  async startUpdate(id, projectId) {
    await startOutsideWorkflow(() => starters.update(id, projectId));
  },
  async startAssessment(batchId, projectId) {
    await startOutsideWorkflow(() => starters.assessment(batchId, projectId));
  },
  async startBuild(buildRequestId, projectId, attempt) {
    await startOutsideWorkflow(() => startBuildWorkflow(buildRequestId, projectId, attempt));
  },
  async cancelBuild(buildRequestId, attempt) {
    await cancelBuildWorkflow(buildRequestId, attempt);
  },
  async closeBuildPullRequest(buildRequestId, reason) {
    await closeWithdrawnPullRequest(buildRequestId, reason);
  },
  async startResponse(messageId, projectId, explorationId, questionId, agent) {
    await startOutsideWorkflow(async () => {
      await DBOS.startWorkflow(respondWorkflowRegistered, { workflowID: `response:${messageId}` })(
        projectId,
        explorationId,
        questionId ?? null,
        agent ?? null,
      );
    });
  },
  async startDeferredRun(key, projectId, explorationId, input, request) {
    // Same key, same workflow: a run is never requested twice for it.
    await startOutsideWorkflow(async () => {
      await DBOS.startWorkflow(respondWorkflowRegistered, { workflowID: `deferred:${key}` })(
        projectId,
        explorationId,
        null,
        null,
        input,
        request ?? null,
      );
    });
  },
  async deferredRunPending(keyPrefix) {
    const rows = await DBOS.listWorkflows({
      workflow_id_prefix: `deferred:${keyPrefix}`,
      status: ['PENDING', 'ENQUEUED'],
      limit: 1,
    });
    return rows.length > 0;
  },
  async deferredRunsOf(projectId) {
    const rows = await DBOS.listWorkflows({
      workflow_id_prefix: 'deferred:run:',
      status: ['PENDING', 'ENQUEUED'],
      loadInput: true,
    });
    return rows
      .filter((r) => r.input?.[0] === projectId)
      .map((r) => ({ key: r.workflowID.slice('deferred:'.length), createdAt: r.createdAt }));
  },
};

export type EngineOptions = {
  /** Only for durability tests: called right after a step is committed. */
  onStepComplete?: (step: string, id: string) => void | Promise<void>;
  /** Only for tests: how long an answer waits for knowledge before it is abandoned. */
  responsePatienceMs?: number;
  /**
   * A process beside the API (the CLI): its own DBOS application and executor, so launching it never recovers the API's
   * pending workflows and no queue of the API (the internal one included) hands it the API's work; and none of the API's reconciliation (orphan calls,
   * runs, answers), which would act on runs the API is still executing. It only executes what it starts itself.
   */
  sidecar?: boolean;
};

export type StartedEngine = { services: Services; stop(): Promise<void> };

/**
 * Reconciles at startup: a queued run with no workflow gets started; a running one whose
 * workflow can no longer be resumed (failed, cancelled or missing) is left interrupted so
 * the person can retry it with the same context pack. Never left stuck.
 */
async function reconcileRuns(s: Services): Promise<void> {
  await systemInteraction(s, 'reconcileRuns', () => reconcileRunsIn(s));
}

async function reconcileRunsIn(s: Services): Promise<void> {
  const liveRuns = await s.db
    .selectFrom('ai_runs')
    .select(['id', 'project_id', 'state'])
    .where('state', 'in', ['queued', 'running'])
    .execute();
  for (const r of liveRuns) {
    const workflow = await DBOS.getWorkflowStatus(workflowRunId(r.id));
    // A workflow that finished (SUCCESS) always leaves its run completed or failed; a run still
    // open with a finished workflow was put back by a project snapshot and is interrupted too.
    const alive = workflow && ['PENDING', 'ENQUEUED'].includes(workflow.status);
    if (alive) continue;
    if (!workflow && r.state === 'queued') {
      await dbosEngine.startRun(r.id, r.project_id);
      continue;
    }
    const reason = workflow
      ? workflow.status === 'SUCCESS'
        ? 'The run was left open although its workflow had finished (restored from a snapshot); retry it.'
        : `The run's workflow ended in ${workflow.status} without completing it; retry it.`
      : 'The process was interrupted with no workflow to resume; retry it with the same context pack.';
    await executeCommand(s, {
      command: r.state === 'running' ? 'run.interrupt' : 'run.fail',
      actor: ENGINE,
      projectId: r.project_id,
      entityId: r.id,
      data: r.state === 'running' ? { reason } : { failure_kind: 'infra', error: reason },
    });
  }
}

/**
 * Reconciles at startup the answers still waiting: a message whose response workflow is missing
 * (a crash before it started) or ended without requesting a run is left abandoned, so the person
 * can ask again. Never waiting forever.
 */
async function reconcileResponses(s: Services): Promise<void> {
  await systemInteraction(s, 'reconcileResponses', () => reconcileResponsesIn(s));
}

async function reconcileResponsesIn(s: Services): Promise<void> {
  const waiting = await s.db.selectFrom('messages').select(['id', 'project_id']).where('response', '=', 'waiting').execute();
  for (const m of waiting) {
    const workflow = await DBOS.getWorkflowStatus(`response:${m.id}`);
    if (workflow && ['PENDING', 'ENQUEUED'].includes(workflow.status)) continue;
    await executeCommand(s, {
      command: 'message.abandon_response',
      actor: system('conversation'),
      projectId: m.project_id,
      entityId: m.id,
      data: {
        reason: workflow
          ? `The answer's workflow ended in ${workflow.status} without asking DEMIURGO; ask again.`
          : 'DEMIURGO stopped before it could ask for the answer; ask again.',
      },
    });
  }
}

/**
 * Configures and launches DBOS on the application's database (`dbos` schema). On launch, DBOS
 * resumes pending workflows; runs, answers and updates are then reconciled.
 */
export async function startEngine(
  base: Omit<Services, 'engine'>,
  baseUrl: string,
  options: EngineOptions = {},
): Promise<StartedEngine> {
  const s: Services = { ...base, engine: dbosEngine };
  setEngineServices(s);
  onStepComplete = options.onStepComplete;
  responsePatienceMs = options.responsePatienceMs ?? RESPONSE_PATIENCE_MS;
  DBOS.setConfig({
    // A sidecar is its own DBOS application: dequeues (the internal queue too, which ignores `listenQueues`) only see
    // rows of their own application, so it never takes a workflow of the API (a pull request review was taken once).
    name: options.sidecar ? 'demiurgo-cli' : 'demiurgo',
    systemDatabaseUrl: baseUrl,
    systemDatabaseSchemaName: 'dbos',
    // DBOS wants version names unique across the applications of one system database.
    applicationVersion: options.sidecar ? `${WORKFLOWS_VERSION}-cli` : WORKFLOWS_VERSION,
    executorID: options.sidecar ? `sidecar-${randomUUID()}` : 'local',
    ...(options.sidecar ? { listenQueues: [] } : {}),
    logLevel: 'warn',
  });
  // Before DBOS resumes anything: a call still "running" now was left so by a crash.
  if (!options.sidecar) await closeOrphanCalls(s.db);
  await DBOS.launch();
  dispatcher = setInterval(() => {
    void dispatchDeferred();
  }, 50);
  if (!options.sidecar) {
    await reconcileRuns(s);
    await reconcileResponses(s);
    for (const c of reconcilers) await systemInteraction(s, c.name, () => c.run(s));
  }
  return {
    services: s,
    async stop() {
      for (const c of controllers.values()) c.abort();
      clearInterval(dispatcher);
      await dispatchDeferred();
      await DBOS.shutdown();
      setEngineServices(null);
    },
  };
}

/** Waits for a run's workflow result (tests and CLI). */
export async function waitForRun(runId: string): Promise<string | null> {
  return DBOS.retrieveWorkflow<string>(workflowRunId(runId)).getResult();
}

/** Waits for the durable response to a message (tests). */
export async function waitForResponse(messageId: string): Promise<void> {
  await DBOS.retrieveWorkflow<void>(`response:${messageId}`).getResult();
}

/** Actor mark for a run's effects. */
export const actorOfRun = agentRun;
