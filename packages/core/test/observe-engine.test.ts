// Observation of the engine (spec §5.2, §6.1, §6.2, §7.4, §7.5, §7.8): every durable step hangs
// from the command that created the flow's entity through `trace_contexts`, the provider call
// leaves its span with the GenAI attributes, its raw events and the texts it sent, the session is
// the one the engine decided, plan B and retries are told apart, and the classifier's calls carry
// the update that caused them. Everything runs on the simulated provider and a fake Codex.

import {
  ATTR,
  ENGINE_SOURCES,
  LOG,
  type Provider,
  type ProviderInvocation,
  SPAN,
  composeSystem,
  human,
  packDelta,
  sha256Hex,
} from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAgentCatalog } from '../src/agents/catalog.ts';
import { DEFAULT_SCRIPTS, type SimulatedInvocation, createSimulatedProvider } from '../src/agents/simulated.ts';
import { assignAgent } from '../src/assignments/assignments.ts';
import { agentClassifiers } from '../src/assignments/classifiers.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { PRIMITIVE_RULES } from '../src/classifier/agent-classifier.ts';
import { waitForRun } from '../src/engine/engine.ts';
import { waitForKnowledge } from '../src/knowledge/workflows.ts';
import type { ReadableLogRecord, ReadableSpan } from '../src/observe/core.ts';
import { useEnvironment } from './support/env.ts';
import { seedCatalog } from './support/seed.ts';

const received: SimulatedInvocation[] = [];
let failResumed = false;

/** The simulated provider, which can be told to lose its session on a resumed call (plan B). */
function flakySimulated(): Provider {
  const base = createSimulatedProvider({
    onInvoke: (p) => received.push(p),
    scripts: {
      echo: (p) => {
        const text = (p.context.content as { input: { text: string } }).input.text;
        return text === 'invalid' ? { reply: 42 } : { reply: `Echo: ${text}` };
      },
      exploration_chat: (p) => DEFAULT_SCRIPTS.exploration_chat(p),
    },
  });
  return {
    ...base,
    async run(inv) {
      if (failResumed && inv.session.mode === 'resumed') {
        inv.onEvent?.({ kind: 'error', raw: JSON.stringify({ type: 'error', message: 'No conversation found.' }) });
        return {
          state: 'error',
          failureKind: 'agent_error',
          message: 'The session was lost.',
          rawEvents: '',
          provider: 'simulated',
          model: inv.model,
        };
      }
      return base.run(inv);
    },
  };
}

type Schema = Record<string, unknown>;

/** One valid response per id the classifier's schema asks for: the first option, high confidence. */
function answerChoices(schema: Schema): unknown {
  const items = ((schema.properties as { responses: { items: Schema } }).responses ?? { items: {} }).items;
  const branches = Array.isArray(items.anyOf) ? (items.anyOf as Schema[]) : [items];
  const responses: unknown[] = [];
  for (const branch of branches) {
    const props = branch.properties as Record<string, { enum?: string[]; const?: string }>;
    const ids = props.id?.enum ?? (props.id?.const ? [props.id.const] : []);
    const choice = props.choice?.enum?.[0] ?? '';
    for (const id of ids) responses.push({ id, choice, confidence: 0.9, justification: 'Because.' });
  }
  return { responses };
}

const classifierCalls: ProviderInvocation[] = [];
const GPT = { id: 'gpt-test', label: 'GPT test', efforts: ['low', 'high'], defaultEffort: 'low' };
const CODEX_USAGE = { type: 'turn.completed', usage: { input_tokens: 10, cached_input_tokens: 4, output_tokens: 5 } };

/** A provider under Codex's id that answers the classifier's schema, so the agent classifier runs without quota. */
const fakeCodex: Provider = {
  id: 'codex',
  label: 'Codex',
  sessions: false,
  discover: async () => ({
    provider: 'codex',
    label: 'Codex',
    installed: true,
    version: 'test',
    ready: true,
    message: null,
    sessions: false,
    models: [GPT],
  }),
  async run(inv) {
    classifierCalls.push(inv);
    inv.onEvent?.({ kind: 'started', raw: JSON.stringify({ type: 'turn.started' }) });
    inv.onEvent?.({ kind: 'usage', raw: JSON.stringify(CODEX_USAGE), tokens: 5 });
    return {
      state: 'ok',
      rawOutput: answerChoices(inv.schema),
      usage: { inputTokens: 10, outputTokens: 5, durationMs: 1 },
      rawEvents: '',
      provider: 'codex',
      model: inv.model,
      details: { rawUsage: CODEX_USAGE, cliCommand: ['codex', 'exec'], exitCode: 0 },
    };
  },
};

const environment = useEnvironment({
  durable: true,
  providers: () => [flakySimulated(), fakeCodex],
  classifierFor: (services) => agentClassifiers(services),
});

const ana = human('ana');
let projectId = '';

beforeAll(async () => {
  const s = environment().services;
  projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Observed' } })).projectId;
  await seedCatalog(s.db, 'codex', [GPT]);
  await assignAgent({ db: s.db, providers: s.providers }, ana, {
    agent: 'knowledge_classifier',
    provider: 'codex',
    model: 'gpt-test',
    effort: 'low',
  });
});

const spans = (): ReadableSpan[] => environment().observer.spans();
const logs = (): ReadonlyArray<ReadableLogRecord> => environment().observer.logs();
const spanNamed = (name: string, predicate: (s: ReadableSpan) => boolean = () => true): ReadableSpan | undefined =>
  spans().find((s) => s.name === name && predicate(s));
const withRun = (runId: string) => (s: ReadableSpan) => s.attributes[ATTR.runId] === runId;
const texts = (kind: string): ReadableLogRecord[] =>
  logs().filter((l) => l.eventName === LOG.text && l.attributes[ATTR.textKind] === kind);
/** The body of a text note: the observer emits texts as strings. */
const bodyOf = (record: ReadableLogRecord | undefined): string => (typeof record?.body === 'string' ? record.body : '');

const cmd = (command: Parameters<typeof executeCommand>[1]['command'], data: unknown, entityId?: string) =>
  executeCommand(environment().services, { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });

/** Runs `fn` as an API interaction of Ana's, like the API route does. */
function interaction<T>(command: string, fn: () => Promise<T>): Promise<{ id: string; traceId: string; result: T }> {
  return environment().observer.interaction(
    { channel: 'api', actor: 'human:ana', actorType: 'human', command, projectId },
    async (c) => ({ id: c.id, traceId: c.traceId, result: await fn() }),
  );
}

async function requestEcho(text: string): Promise<{ id: string; traceId: string; runId: string }> {
  const r = await interaction('run.request', async () => {
    const created = await cmd('run.request', { action: 'echo', scope: { type: 'echo' }, input: { text } });
    return created.entityId;
  });
  await waitForRun(r.result);
  return { id: r.id, traceId: r.traceId, runId: r.result };
}

const run = (id: string) =>
  environment().services.db.selectFrom('ai_runs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

const callOf = (runId: string, attempt = 1) =>
  environment()
    .services.db.selectFrom('agent_calls')
    .selectAll()
    .where('run_id', '=', runId)
    .orderBy('started_at')
    .execute()
    .then((rows) => rows[attempt - 1]);

async function openThread(purpose: string): Promise<string> {
  return (await cmd('exploration.open', { purpose })).entityId;
}

async function ask(thread: string): Promise<string> {
  const r = await cmd('run.request', { action: 'exploration_chat', scope: { type: 'exploration', id: thread } });
  await waitForRun(r.entityId);
  return r.entityId;
}

describe('the engine under observation', () => {
  it('the reconcilers at startup are system roots', () => {
    for (const component of ['reconcileRuns', 'reconcileResponses', 'reconcileKnowledge']) {
      const root = spanNamed(`${SPAN.interaction} ${component}`);
      expect(root?.name).toBe(`${SPAN.interaction} ${component}`);
      expect(root?.parentSpanContext).toBeUndefined();
      expect(root?.attributes).toMatchObject({
        [ATTR.channel]: 'system',
        [ATTR.actor]: `system:${component}`,
        [ATTR.actorType]: 'system',
        [ATTR.command]: component,
      });
    }
  });

  it('a run requested in an interaction leaves its steps, call, events and texts in that trace, hanging from the command', async () => {
    const { id, traceId, runId } = await requestEcho('hello');
    expect((await run(runId)).state).toBe('completed');

    const command = spanNamed(`${SPAN.command} run.request`, (s) => s.spanContext().traceId === traceId);
    const prepare = spanNamed(SPAN.runPrepare, withRun(runId));
    const invoke = spanNamed(SPAN.runInvoke, withRun(runId));
    const apply = spanNamed(SPAN.runApply, withRun(runId));
    expect(command).toBeDefined();
    for (const step of [prepare, invoke, apply]) {
      expect(step).toBeDefined();
      expect(step?.spanContext().traceId).toBe(traceId);
      // Through trace_contexts: the parent is the command that created the run, marked remote.
      expect(step?.parentSpanContext?.spanId).toBe(command?.spanContext().spanId);
      expect(step?.parentSpanContext?.isRemote).toBe(true);
      expect(step?.attributes[ATTR.workflowId]).toBe(`run:${runId}`);
      expect(step?.attributes[ATTR.stepAttempt]).toBe(1);
      expect(step?.attributes[ATTR.projectId]).toBe(projectId);
    }
    expect(prepare?.attributes[ATTR.stepResult]).toBe('running');
    expect(invoke?.attributes[ATTR.stepResult]).toBe('ok');
    expect(apply?.attributes[ATTR.stepResult]).toBe('completed');

    // The call span: a child of run.invoke (AsyncLocalStorage survives the DBOS step), with §6.2.
    const call = await callOf(runId);
    const callSpan = spanNamed(`${SPAN.invokeAgent} echo`, withRun(runId));
    expect(callSpan?.parentSpanContext?.spanId).toBe(invoke?.spanContext().spanId);
    expect(callSpan?.spanContext().traceId).toBe(traceId);
    const { rows: requests } = await sql<{ after: { engine_source?: string } }>`
      select after from events where command = 'run.request' and entity_id = ${runId}::uuid`.execute(environment().services.db);
    const engineSource = requests[0]?.after.engine_source;
    expect(ENGINE_SOURCES).toContain(engineSource);
    const echo = (await loadAgentCatalog()).get('echo');
    expect(callSpan?.attributes).toMatchObject({
      [ATTR.genAiOperationName]: 'invoke_agent',
      [ATTR.genAiProviderName]: 'demiurgo_simulated',
      [ATTR.providerId]: 'simulated',
      [ATTR.genAiAgentName]: 'echo',
      [ATTR.genAiAgentVersion]: echo?.version,
      [ATTR.genAiRequestModel]: 'simulated',
      [ATTR.genAiResponseModel]: 'simulated',
      [ATTR.engineSource]: engineSource,
      [ATTR.sessionMode]: 'none',
      [ATTR.callId]: call?.id,
      [ATTR.callAttempt]: 1,
      [ATTR.runId]: runId,
      [ATTR.projectId]: projectId,
      [ATTR.schemaVersion]: (await run(runId)).schema_version,
      [ATTR.cliCommand]: ['simulated'],
      [ATTR.cliTraceParent]: `00-${traceId}-${callSpan?.spanContext().spanId}-01`,
      [ATTR.genAiUsageInputTokens]: expect.any(Number),
      [ATTR.genAiUsageOutputTokens]: expect.any(Number),
      [ATTR.usageProvenance]: expect.stringContaining('simulated:'),
      [ATTR.usageRaw]: expect.stringContaining('inputTokens'),
      [ATTR.callDurationReportedMs]: expect.any(Number),
    });
    expect(callSpan?.attributes[ATTR.packHash]).toBeDefined();
    expect(callSpan?.attributes).not.toHaveProperty(ATTR.failureKind);
    // The child got the call's traceparent.
    expect(received.at(-1)?.trace?.traceParent).toBe(callSpan?.attributes[ATTR.cliTraceParent]);
    expect(received.at(-1)?.trace?.resourceAttributes).toMatchObject({ [ATTR.callId]: call?.id, [ATTR.interactionId]: id });

    // Every raw event, whole, attached to the call span, with the call id.
    const events = logs().filter((l) => l.eventName === LOG.providerEvent && l.attributes[ATTR.callId] === call?.id);
    expect(events.map((e) => e.attributes[ATTR.eventKind])).toEqual(['started', 'message', 'result']);
    expect(events.map((e) => e.attributes[ATTR.eventSeq])).toEqual([1, 2, 3]);
    for (const e of events) {
      expect(e.attributes[ATTR.eventId]).toMatch(/^[0-9a-f-]{36}$/);
      expect(e.attributes[ATTR.eventReceivedAt]).toMatch(/^\d{4}-/);
      expect(e.spanContext?.spanId).toBe(callSpan?.spanContext().spanId);
    }
    const stored = await environment()
      .services.db.selectFrom('agent_call_events')
      .select('raw')
      .where('call_id', '=', call?.id ?? '')
      .orderBy('seq')
      .execute();
    expect(events.map((e) => e.body)).toEqual(stored.map((r) => r.raw));

    // The texts, whose hashes are the ones on the spans.
    const last = received.at(-1);
    expect(callSpan?.attributes[ATTR.promptHash]).toBe(sha256Hex(last?.system ?? ''));
    expect(callSpan?.attributes[ATTR.inputHash]).toBe(sha256Hex(last?.input ?? ''));
    expect(callSpan?.attributes[ATTR.schemaHash]).toBe(sha256Hex(JSON.stringify(last?.schema)));
    expect(apply?.attributes[ATTR.outputHash]).toBe(sha256Hex(JSON.stringify({ reply: 'Echo: hello' })));
    for (const [kind, hash] of [
      ['system_prompt', callSpan?.attributes[ATTR.promptHash]],
      ['input', callSpan?.attributes[ATTR.inputHash]],
      ['schema', callSpan?.attributes[ATTR.schemaHash]],
      ['output_raw', apply?.attributes[ATTR.outputHash]],
    ] as const) {
      const text = texts(kind).find((t) => t.attributes[ATTR.textHash] === hash);
      expect(text?.attributes[ATTR.textKind]).toBe(kind);
      expect(sha256Hex(bodyOf(text))).toBe(hash);
    }

    // The journal's correlation is the interaction.
    const { rows } = await sql<{ command: string; correlation: string }>`
      select command, cause->>'correlation' as correlation from events where entity_id = ${runId}::uuid order by seq`.execute(
      environment().services.db,
    );
    expect(rows.map((r) => r.command)).toEqual(['run.request', 'run.begin', 'run.complete']);
    for (const r of rows) expect(r.correlation).toBe(id);
  });

  it('an invalid output still leaves the whole raw output as a text', async () => {
    const { runId } = await requestEcho('invalid');
    expect(await run(runId)).toMatchObject({ state: 'failed', failure_kind: 'invalid_output' });
    const apply = spanNamed(SPAN.runApply, withRun(runId));
    const hash = sha256Hex(JSON.stringify({ reply: 42 }));
    expect(apply?.attributes[ATTR.outputHash]).toBe(hash);
    expect(apply?.attributes[ATTR.stepResult]).toBe('failed');
    expect(texts('output_raw').some((t) => t.attributes[ATTR.textHash] === hash)).toBe(true);
  });

  it('a retry is a new interaction whose first step links to the original run, with the engine source it was given', async () => {
    const original = await requestEcho('invalid');
    const retry = await interaction('run.retry', async () => {
      const r = await cmd('run.retry', {
        run_id: original.runId,
        override: { provider: 'simulated', model: 'simulated', effort: null },
      });
      return r.entityId;
    });
    await waitForRun(retry.result);
    expect(await run(retry.result)).toMatchObject({ retry_of: original.runId, state: 'failed' });
    const prepare = spanNamed(SPAN.runPrepare, withRun(retry.result));
    expect(prepare?.spanContext().traceId).toBe(retry.traceId);
    expect(prepare?.spanContext().traceId).not.toBe(original.traceId);
    expect(prepare?.attributes[ATTR.retryOf]).toBe(original.runId);
    expect(prepare?.links[0]?.context.traceId).toBe(original.traceId);
    expect(prepare?.links[0]?.attributes).toEqual({ [ATTR.runId]: original.runId });
    const { rows } = await sql<{ after: { engine_source?: string } }>`
      select after from events where command = 'run.retry' and entity_id = ${retry.result}::uuid`.execute(
      environment().services.db,
    );
    expect(rows[0]?.after.engine_source).toBe('override');
    const call = spanNamed(`${SPAN.invokeAgent} echo`, withRun(retry.result));
    expect(call?.attributes).toMatchObject({ [ATTR.engineSource]: 'override', [ATTR.retryOf]: original.runId });
  });

  it('a thread resumes with the session the engine decided, its base run and the delta as a text; plan B is attempt 2 with a new session', async () => {
    // The first answers in a project give the stage questions their options, a few per run
    // (questionsNeedingOptions caps them): after two turns, a fork's packs only append.
    const warmUp = await openThread('Warm-up');
    for (const text of ['A recipe app.', 'For home cooks.']) {
      await cmd('message.post', { exploration_id: warmUp, text, respond: false });
      await ask(warmUp);
    }

    const thread = await openThread('Pricing');
    await cmd('message.post', { exploration_id: thread, text: 'Who pays for this?', respond: false });
    const first = await ask(thread);
    const fresh = spanNamed(`${SPAN.invokeAgent} explorer`, withRun(first));
    const ourId = fresh?.attributes[ATTR.sessionId];
    expect(ourId).toMatch(/^[0-9a-f-]{36}$/);
    expect(received.at(-1)?.session).toEqual({
      mode: 'fresh',
      directory: expect.any(String),
      id: ourId,
      name: `demiurgo explorer ${thread.slice(0, 8)}`,
    });
    expect(fresh?.attributes).toMatchObject({
      [ATTR.sessionMode]: 'fresh',
      [ATTR.sessionName]: `demiurgo explorer ${thread.slice(0, 8)}`,
      [ATTR.genAiConversationId]: ourId,
      [ATTR.callAttempt]: 1,
    });
    expect(fresh?.attributes[ATTR.sessionKeyHash]).toMatch(/^[0-9a-f]{64}$/);
    expect((await run(first)).provider_session_id).toBe(ourId);

    await cmd('message.post', { exploration_id: thread, text: 'Restaurants pay a monthly fee.', respond: false });
    const second = await ask(thread);
    const packOf = async (runId: string) =>
      environment()
        .services.db.selectFrom('context_packs')
        .select('content')
        .where('id', '=', (await run(runId)).context_pack_id ?? '')
        .executeTakeFirstOrThrow();
    const packs = packDelta((await packOf(first)).content, (await packOf(second)).content);
    expect(packs.appendOnly ? 'append-only' : packs.reason).toBe('append-only');
    expect(await run(second)).toMatchObject({ session_mode: 'resumed', provider_session_id: ourId });
    const resumed = spanNamed(`${SPAN.invokeAgent} explorer`, withRun(second));
    expect(resumed?.attributes).toMatchObject({
      [ATTR.sessionMode]: 'resumed',
      [ATTR.sessionId]: ourId,
      [ATTR.genAiConversationId]: ourId,
      [ATTR.sessionBaseRun]: first,
      [ATTR.sessionKeyHash]: fresh?.attributes[ATTR.sessionKeyHash],
      [ATTR.callAttempt]: 1,
    });
    const deltaHash = resumed?.attributes[ATTR.deltaHash];
    expect(deltaHash).toMatch(/^[0-9a-f]{64}$/);
    const delta = texts('delta').find((t) => t.attributes[ATTR.textHash] === deltaHash);
    // Only what was added since the base pack: the new message (and the agent's own reply, which
    // quotes the first one), never the first message itself.
    expect(bodyOf(delta)).toContain('"text":"Restaurants pay a monthly fee."');
    expect(bodyOf(delta)).not.toContain('"text":"Who pays for this?"');

    // Plan B: the provider lost the session; the run starts over on a new session of ours.
    failResumed = true;
    try {
      await cmd('message.post', { exploration_id: thread, text: 'And a free trial.', respond: false });
      const third = await ask(thread);
      expect(await run(third)).toMatchObject({ state: 'completed', session_mode: 'fresh', delta_hash: null });
      const attempts = spans()
        .filter((s) => s.name === `${SPAN.invokeAgent} explorer` && withRun(third)(s))
        .sort((a, b) => Number(a.attributes[ATTR.callAttempt]) - Number(b.attributes[ATTR.callAttempt]));
      expect(attempts.map((s) => s.attributes[ATTR.callAttempt])).toEqual([1, 2]);
      expect(attempts[0]?.attributes).toMatchObject({ [ATTR.sessionMode]: 'resumed', [ATTR.failureKind]: 'agent_error' });
      expect(attempts[0]?.status.code).toBe(2);
      expect(attempts[0]?.attributes[ATTR.errorType]).toBe('agent_error');
      const planB = attempts[1]?.attributes[ATTR.sessionId];
      expect(attempts[1]?.attributes).toMatchObject({ [ATTR.sessionMode]: 'fresh' });
      expect(attempts[1]?.attributes).not.toHaveProperty(ATTR.sessionBaseRun);
      expect(attempts[1]?.attributes).not.toHaveProperty(ATTR.deltaHash);
      expect(planB).toMatch(/^[0-9a-f-]{36}$/);
      expect(planB).not.toBe(ourId);
      expect((await run(third)).provider_session_id).toBe(planB);
      const calls = await environment().services.db.selectFrom('agent_calls').select('id').where('run_id', '=', third).execute();
      expect(calls).toHaveLength(2);
    } finally {
      failResumed = false;
    }
  });

  it("the classifier's calls carry the update that caused them, and record the hash of the system actually sent", async () => {
    const s = environment().services;
    const decision = async (title: string, text: string) => {
      const r = await cmd('record.create', {
        type: 'decision',
        domain: 'socios',
        title,
        sections: [
          { title: 'Context', content: `Context of ${title}.` },
          { title: 'Decision', content: text },
          { title: 'Consequences', content: 'It has to be designed.' },
        ],
      });
      await cmd('record_version.approve', {}, (r.result as { versionId: string }).versionId);
      await waitForKnowledge(s, projectId);
    };
    await decision('Guests', 'Each member may bring guests.');
    const before = classifierCalls.length;
    await decision('Limited guests', 'Each member may bring two guests.');
    expect(classifierCalls.length).toBeGreaterThan(before);

    const update = await s.db
      .selectFrom('knowledge_updates')
      .select(['id', 'state'])
      .where('project_id', '=', projectId)
      .orderBy('trigger_seq', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirstOrThrow();
    const classify = spanNamed(SPAN.knowledgeClassify, (x) => x.attributes[ATTR.updateId] === update.id);
    expect(classify).toBeDefined();
    expect(classify?.attributes).toMatchObject({ [ATTR.classifySource]: 'provider', [ATTR.stepResult]: 'classified' });
    expect(classify?.attributes[ATTR.workflowId]).toMatch(/^knowledge:/);
    const apply = spanNamed(SPAN.knowledgeApply, (x) => x.attributes[ATTR.updateId] === update.id);
    expect(apply?.attributes[ATTR.stepResult]).toBe(update.state);
    // Hanging from the command that created the update, through trace_contexts.
    expect(classify?.parentSpanContext?.isRemote).toBe(true);

    const call = spanNamed(`${SPAN.invokeAgent} knowledge_classifier`, (x) => x.attributes[ATTR.updateId] === update.id);
    expect(call?.parentSpanContext?.spanId).toBe(classify?.spanContext().spanId);
    expect(call?.attributes).toMatchObject({
      [ATTR.genAiProviderName]: 'openai',
      [ATTR.providerId]: 'codex',
      [ATTR.modelObservedProvenance]: 'not_reported',
      [ATTR.engineSource]: 'agent',
      [ATTR.genAiRequestModel]: 'gpt-test',
      [ATTR.effort]: 'low',
      [ATTR.sessionMode]: 'none',
      [ATTR.genAiUsageInputTokens]: 10,
      [ATTR.genAiUsageCacheReadInputTokens]: 4,
      [ATTR.usageUncachedInputTokens]: 6,
      [ATTR.cliExitCode]: 0,
    });
    expect(call?.attributes[ATTR.runId]).toBeUndefined();

    const agent = (await loadAgentCatalog()).get('knowledge_classifier');
    if (!agent) throw new Error('No knowledge_classifier agent.');
    const sent = classifierCalls.at(-1);
    const composed = composeSystem(agent, agent.skillDefinitions, PRIMITIVE_RULES.choice);
    expect(sent?.system).toBe(composed.system);
    const row = await s.db
      .selectFrom('agent_calls')
      .selectAll()
      .where('agent', '=', 'knowledge_classifier')
      .orderBy('started_at', 'desc')
      .executeTakeFirstOrThrow();
    expect(row.prompt_hash).toBe(composed.promptHash);
    expect(row.run_id).toBeNull();
    expect(call?.attributes[ATTR.callId]).toBe(row.id);
    expect(call?.attributes[ATTR.promptHash]).toBe(sha256Hex(composed.system));
    // The classifier's texts arrive through the call itself.
    expect(texts('system_prompt').some((t) => t.attributes[ATTR.textHash] === sha256Hex(composed.system))).toBe(true);
  });
});
