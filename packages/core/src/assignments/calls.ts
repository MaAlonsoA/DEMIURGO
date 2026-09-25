// Every provider invocation leaves a trace (FDR-AGE-002): a row in agent_calls from start to end,
// and each event of its stream in agent_call_events, in order, as it arrives (a NOTIFY per event
// feeds the live progress). Agent runs and the knowledge classifier both call through here, so this
// is also where the observability engine sees every call (spec §7.5): the `invoke_agent <agent>`
// span with the attributes of §6.2, each raw event as a `demiurgo.provider.event` note, and the
// traceparent the child CLI gets so its own telemetry joins the trace.

import { AsyncLocalStorage } from 'node:async_hooks';
import {
  ATTR,
  type AgentResult,
  type EngineSource,
  GEN_AI_PROVIDER_NAMES,
  LOG,
  NOT_REPORTED,
  type Provider,
  type ProviderEvent,
  type ProviderInvocation,
  type ProviderTrace,
  RESOURCE,
  SPAN,
  normalizeUsage,
  usageAttributes,
} from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';
import { uuidV7 } from '../observe/ids.ts';
import type { Attributes, Observer } from '../observe/observer.ts';
import { OPENCODE_PROVIDER } from '../providers/opencode.ts';

/** The session as DEMIURGO sees it (§5.4): the id it decided, the mode, the base and the delta. */
export type CallSession = {
  /** Our session id (fresh: the one we generated; resumed: the one being resumed). */
  id: string | null;
  mode: 'none' | 'fresh' | 'resumed';
  /** The run whose session is resumed, and the hash of its pack. */
  baseRunId: string | null;
  basePackHash: string | null;
  /** Hash of the delta text sent on a resumed call. */
  deltaHash: string | null;
  /** sha256 of the session key. */
  keyHash: string | null;
  /** The visible name given to the CLI's session. */
  name?: string;
};

export type CallMeta = {
  projectId: string | null;
  runId: string | null;
  /** The knowledge update that caused a classifier call; null for runs. */
  updateId: string | null;
  agent: string;
  agentVersion: string;
  /** The product's short fingerprint of the system prompt, as `ai_runs.prompt_hash` records it. */
  promptHash: string;
  engineSource: EngineSource | null;
  session: CallSession;
  /** 1, or 2 for the plan B after a lost session. */
  attempt: 1 | 2;
  /** Full hashes of the texts sent, when the caller already emitted them; otherwise computed here. */
  inputHash: string | null;
  schemaHash: string | null;
  schemaVersion: string | null;
  packHash: string | null;
  retryOf: string | null;
};

export type CallDeps = { db: Db; observer: Observer };

/** A call without a provider session (the classifier). */
export const noCallSession = (): CallSession => ({
  id: null,
  mode: 'none',
  baseRunId: null,
  basePackHash: null,
  deltaHash: null,
  keyHash: null,
});

/** Characters of the system and the input copied onto the span, for the viewer only (§6.2). */
export const SPAN_TEXT_LIMIT = 64_000;

// The knowledge update in progress: the classifier's calls carry it without threading it through
// the `Classifier` port (spec §7.8).
const updateScope = new AsyncLocalStorage<string>();

export function withUpdateScope<T>(updateId: string, fn: () => Promise<T>): Promise<T> {
  return updateScope.run(updateId, fn);
}

export function currentUpdateId(): string | null {
  return updateScope.getStore() ?? null;
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

/** `gen_ai.provider.name`: the provider behind the CLI, or OpenCode's provider key (`qwen-local/…`). */
export function genAiProviderName(providerId: string, model: string): string {
  const known = GEN_AI_PROVIDER_NAMES[providerId];
  if (known) return known;
  if (providerId === OPENCODE_PROVIDER) {
    const slash = model.indexOf('/');
    return slash > 0 ? model.slice(0, slash) : providerId;
  }
  return providerId;
}

/** The telemetry the child CLI gets (§7.6), only while observation exports somewhere. */
function traceFor(observer: Observer, traceParent: string, meta: CallMeta, callId: string): ProviderTrace | undefined {
  const options = observer.options();
  if (!options || options.mode !== 'otlp') return undefined;
  const resourceAttributes: Record<string, string> = {
    [ATTR.callId]: callId,
    [RESOURCE.environment]: options.environment,
  };
  const interactionId = observer.currentInteractionId();
  if (interactionId) resourceAttributes[ATTR.interactionId] = interactionId;
  if (meta.runId) resourceAttributes[ATTR.runId] = meta.runId;
  if (meta.updateId) resourceAttributes[ATTR.updateId] = meta.updateId;
  return { traceParent, resourceAttributes, otlpEndpoint: options.endpoint || null, environment: options.environment };
}

/** The attributes of the call known once it ended (§6.2): usage, model, times, what the CLI reported, failure. */
function closingAttributes(observer: Observer, provider: Provider, result: AgentResult): Attributes {
  const details = result.details;
  const rawUsage = details?.rawUsage ?? result.usage;
  const attrs: Attributes = {
    ...(rawUsage === undefined ? {} : usageAttributes(normalizeUsage(provider.id, rawUsage))),
    [ATTR.genAiResponseModel]: result.model,
    [ATTR.callDurationReportedMs]: result.usage?.durationMs,
    [ATTR.callDurationApiMs]: details?.durationApiMs,
    [ATTR.callTtftMs]: details?.ttftMs,
    [ATTR.cliVersion]: details?.cliVersion,
    [ATTR.cliCommand]: details?.cliCommand ? [...details.cliCommand] : undefined,
    [ATTR.cliCwd]: details?.cliCwd,
    [ATTR.cliExitCode]: details?.exitCode,
    [ATTR.cliStopReason]: details?.stopReason,
    [ATTR.cliStderrHash]: details?.stderr ? observer.text('stderr', details.stderr) : undefined,
    [ATTR.transcriptPath]: details?.transcriptPath,
  };
  // Codex never says which model answered: the observed model is the requested one (§6.2).
  if (provider.id === 'codex') attrs[ATTR.modelObservedProvenance] = NOT_REPORTED;
  if (result.sessionId) attrs[ATTR.genAiConversationId] = result.sessionId;
  if (result.state === 'error') attrs[ATTR.failureKind] = result.failureKind;
  return attrs;
}

export async function callProvider(
  deps: CallDeps,
  provider: Provider,
  meta: CallMeta,
  inv: ProviderInvocation,
): Promise<AgentResult> {
  const { db, observer } = deps;
  const updateId = meta.updateId ?? currentUpdateId();
  // The texts as sent, once per fingerprint: the engine already emitted the run's; the classifier's arrive here.
  const promptHash = observer.text('system_prompt', inv.system);
  const inputHash = meta.inputHash ?? observer.text('input', inv.input);
  const schemaHash = meta.schemaHash ?? observer.text('schema', JSON.stringify(inv.schema));
  const conversationId = inv.session.mode === 'none' ? null : (inv.session.id ?? null);
  const opening: Attributes = {
    [ATTR.genAiOperationName]: SPAN.invokeAgent,
    [ATTR.genAiProviderName]: genAiProviderName(provider.id, inv.model),
    [ATTR.providerId]: provider.id,
    [ATTR.genAiAgentName]: meta.agent,
    [ATTR.genAiAgentVersion]: meta.agentVersion,
    [ATTR.genAiRequestModel]: inv.model,
    [ATTR.effort]: inv.effort,
    [ATTR.engineSource]: meta.engineSource,
    [ATTR.genAiConversationId]: conversationId,
    [ATTR.sessionId]: meta.session.id,
    [ATTR.sessionMode]: meta.session.mode,
    [ATTR.sessionKeyHash]: meta.session.keyHash,
    [ATTR.sessionBaseRun]: meta.session.baseRunId,
    [ATTR.sessionBasePackHash]: meta.session.basePackHash,
    [ATTR.sessionName]: meta.session.name,
    [ATTR.deltaHash]: meta.session.deltaHash,
    [ATTR.callAttempt]: meta.attempt,
    [ATTR.runId]: meta.runId,
    [ATTR.updateId]: updateId,
    [ATTR.retryOf]: meta.retryOf,
    [ATTR.projectId]: meta.projectId,
    [ATTR.promptHash]: promptHash,
    [ATTR.inputHash]: inputHash,
    [ATTR.schemaHash]: schemaHash,
    [ATTR.schemaVersion]: meta.schemaVersion,
    [ATTR.packHash]: meta.packHash,
    [ATTR.genAiSystemInstructions]: clip(inv.system, SPAN_TEXT_LIMIT),
    [ATTR.genAiInputMessages]: clip(inv.input, SPAN_TEXT_LIMIT),
  };
  return observer.span(`${SPAN.invokeAgent} ${meta.agent}`, opening, async (span) => {
    const { id } = await db
      .insertInto('agent_calls')
      .values({
        project_id: meta.projectId,
        run_id: meta.runId,
        agent: meta.agent,
        agent_version: meta.agentVersion,
        provider: provider.id,
        requested_model: inv.model,
        effort: inv.effort,
        session_mode: inv.session.mode,
        provider_session_id: inv.session.mode === 'resumed' ? inv.session.id : null,
        prompt_hash: meta.promptHash,
        state: 'running',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const traceParent = span.traceParent();
    span.setAttributes({ [ATTR.callId]: id, [ATTR.cliTraceParent]: traceParent });
    const trace = traceFor(observer, traceParent, { ...meta, updateId }, id);
    // Events are written one after another, in arrival order, without blocking the provider.
    let seq = 0;
    let writing: Promise<void> = Promise.resolve();
    const onEvent = (e: ProviderEvent) => {
      seq++;
      const n = seq;
      // The whole line goes to the observer; the product's copy stays clipped.
      observer.event(
        LOG.providerEvent,
        {
          [ATTR.eventId]: uuidV7(),
          [ATTR.callId]: id,
          [ATTR.eventSeq]: n,
          [ATTR.eventKind]: e.kind,
          [ATTR.eventTokens]: e.tokens,
          [ATTR.eventReceivedAt]: new Date().toISOString(),
        },
        e.raw,
      );
      writing = writing
        .then(async () => {
          await db
            .insertInto('agent_call_events')
            .values({
              project_id: meta.projectId,
              call_id: id,
              seq: n,
              kind: e.kind,
              tokens: e.tokens ?? null,
              raw: clip(e.raw, 200_000),
            })
            .execute();
        })
        .catch(() => undefined);
      inv.onEvent?.(e);
    };
    let result: AgentResult;
    try {
      result = await provider.run({ ...inv, onEvent, ...(trace ? { trace } : {}) });
    } catch (e) {
      result = {
        state: 'error',
        failureKind: 'infra',
        message: `The ${provider.label} adapter failed: ${e instanceof Error ? e.message : String(e)}`,
        rawEvents: '',
        provider: provider.id,
        model: inv.model,
      };
    }
    await writing;
    await db
      .updateTable('agent_calls')
      .set({
        state: result.state,
        failure_kind: result.state === 'error' ? result.failureKind : null,
        error: result.state === 'error' ? clip(result.message, 4000) : null,
        usage: result.usage ? JSON.stringify(result.usage) : null,
        observed_model: result.model,
        provider_session_id: result.sessionId ?? (inv.session.mode === 'resumed' ? inv.session.id : null),
        finished_at: new Date(),
      })
      .where('id', '=', id)
      .execute();
    span.setAttributes(closingAttributes(observer, provider, result));
    if (result.state === 'error') span.setStatus('error', { type: result.failureKind, message: result.message });
    return result;
  });
}

/**
 * Closes the calls a crash left running: nothing is running when DEMIURGO starts, so each one ends
 * as interrupted, with an error event at the end of its trace. Returns how many were closed.
 */
export async function closeOrphanCalls(db: Db): Promise<number> {
  const orphans = await db.selectFrom('agent_calls').select(['id', 'project_id']).where('state', '=', 'running').execute();
  for (const o of orphans) {
    await db.transaction().execute(async (trx) => {
      const last = await trx
        .selectFrom('agent_call_events')
        .select((eb) => eb.fn.max('seq').as('seq'))
        .where('call_id', '=', o.id)
        .executeTakeFirst();
      await trx
        .insertInto('agent_call_events')
        .values({
          project_id: o.project_id,
          call_id: o.id,
          seq: (last?.seq ?? 0) + 1,
          kind: 'error',
          tokens: null,
          raw: JSON.stringify({ interrupted: true, reason: 'DEMIURGO stopped before this call finished.' }),
        })
        .execute();
      await trx
        .updateTable('agent_calls')
        .set({
          state: 'error',
          failure_kind: 'interrupted',
          error: 'DEMIURGO stopped before this call finished.',
          finished_at: new Date(),
        })
        .where('id', '=', o.id)
        .where('state', '=', 'running')
        .execute();
    });
  }
  return orphans.length;
}
