// Regenerates `business.otlp.json`: the notes of two threads of one project, recorded with the core's
// memory observer and serialized as the exporter would, for the exploitation views (§15.3):
//
//   thread X1: Ana posts a message → run R1 (claude, fresh session) answers, raises question Q1 and
//              infers it, submits batch B1 with proposal P1 · Ana confirms Q1 as inferred · Ana accepts
//              P1 (the decision) · Ana posts again → run R2 (claude, resumed) times out with no cache
//              read (session lost) · Ana retries R2 on codex (override) → run R3 raises Q2, submits B2
//              with P2 · Ana rejects P2;
//   thread X2: Ana opens it and posts a message without asking for an answer.
//
// Three runs on two engines, one accepted decision, one rejection, one retry with override, two
// questions raised and one answered. Payload shapes follow the core's handlers (runs.ts,
// exploration.ts, proposals.ts): `run.retry` carries no scope, so R3's thread comes from R2's.
//
//   node packages/evidence/test/fixtures/build-business.ts

import { writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createMemoryObserver } from '@demiurgo/core';
import { ATTR, GEN_AI_PROVIDER_NAMES, LOG, SPAN, normalizeUsage, sha256Hex, usageAttributes } from '@demiurgo/domain';

export const BUSINESS_FIXTURE_PATH = fileURLToPath(new URL('./business.otlp.json', import.meta.url));

/** The ids of the business fixture, shared by this builder and the tests. */
export const BIZ = {
  project: '0199b000-0000-7000-8000-00000000aa01',
  thread1: '0199b000-0000-7000-8000-00000000ab01',
  thread2: '0199b000-0000-7000-8000-00000000ab02',
  message1: '0199b000-0000-7000-8000-00000000bb01',
  answer1: '0199b000-0000-7000-8000-00000000bb02',
  message2: '0199b000-0000-7000-8000-00000000bb03',
  message3: '0199b000-0000-7000-8000-00000000bb04',
  run1: '0199b000-0000-7000-8000-00000000c001',
  run2: '0199b000-0000-7000-8000-00000000c002',
  run3: '0199b000-0000-7000-8000-00000000c003',
  call1: '0199b000-0000-7000-8000-00000000d001',
  call2: '0199b000-0000-7000-8000-00000000d002',
  call3: '0199b000-0000-7000-8000-00000000d003',
  sessionClaude: '5e4d3c2b-1a0f-4e8d-9c7b-6a5f4e3d2c1b',
  sessionCodex: '6f5e4d3c-2b1a-4f9e-8d7c-7b6a5f4e3d2c',
  question1: '0199b000-0000-7000-8000-00000000e101',
  question2: '0199b000-0000-7000-8000-00000000e102',
  batch1: '0199b000-0000-7000-8000-00000000e001',
  batch2: '0199b000-0000-7000-8000-00000000e002',
  proposal1: '0199b000-0000-7000-8000-00000000f001',
  proposal2: '0199b000-0000-7000-8000-00000000f002',
  pack1: '1'.repeat(64),
  pack2: '2'.repeat(64),
  pack3: '3'.repeat(64),
  delta: 'e'.repeat(64),
  interactions: {
    post1: '0199b100-0000-7000-8000-000000000001',
    confirm: '0199b100-0000-7000-8000-000000000002',
    accept: '0199b100-0000-7000-8000-000000000003',
    post2: '0199b100-0000-7000-8000-000000000004',
    retry: '0199b100-0000-7000-8000-000000000005',
    reject: '0199b100-0000-7000-8000-000000000006',
    open2: '0199b100-0000-7000-8000-000000000007',
    post3: '0199b100-0000-7000-8000-000000000008',
  },
} as const;

export const BIZ_ENGINES = {
  claude: { provider: 'claude', model: 'claude-sonnet-4-5', effort: 'medium' },
  codex: { provider: 'codex', model: 'gpt-5-codex', effort: 'high' },
} as const;

type Attrs = Record<string, string | number | boolean | readonly string[] | undefined | null>;
type Engine = (typeof BIZ_ENGINES)[keyof typeof BIZ_ENGINES];

const SYSTEM_PROMPT = 'You are the explorer of DEMIURGO. Answer with a proposal.';
const agentOf = (runId: string) => ({ actor: `agent:run:${runId}`, actorType: 'agent_run' });

export async function buildBusinessFixture(): Promise<{ traces: unknown; logs: unknown }> {
  const o = createMemoryObserver({ environment: 'test', serviceVersion: 'fixture', instance: '8100' });
  const human = { actor: 'human:ana', actorType: 'human' };
  const system = { actor: 'system:engine:1', actorType: 'system' };
  let seq = 0;

  const commandAttrs = (
    who: { actor: string; actorType: string },
    command: string,
    entityType: string,
    entityId: string,
    extra: Attrs = {},
  ): Attrs => ({
    [ATTR.command]: command,
    [ATTR.actor]: who.actor,
    [ATTR.actorType]: who.actorType,
    [ATTR.projectId]: BIZ.project,
    [ATTR.entityType]: entityType,
    [ATTR.entityId]: entityId,
    [ATTR.outcome]: 'ok',
    [ATTR.eventSeq]: (seq += 1),
    ...extra,
  });
  const journal = (command: string, entityType: string, entityId: string, after: unknown, before: unknown = null) =>
    o.event(
      LOG.journal,
      {
        [ATTR.eventSeq]: seq,
        [ATTR.command]: command,
        [ATTR.entityType]: entityType,
        [ATTR.entityId]: entityId,
        [ATTR.projectId]: BIZ.project,
      },
      { before, after },
    );
  /** A command span with its journal event and, optionally, nested work. */
  const command = (
    who: { actor: string; actorType: string },
    name: string,
    entityType: string,
    entityId: string,
    states: { before?: string; after: string },
    payload: { before?: unknown; after: unknown },
    extra: Attrs = {},
    inside: () => Promise<void> = async () => undefined,
  ) =>
    o.span(
      `${SPAN.command} ${name}`,
      commandAttrs(who, name, entityType, entityId, {
        ...(states.before ? { [ATTR.stateBefore]: states.before } : {}),
        [ATTR.stateAfter]: states.after,
        ...extra,
      }),
      async () => {
        journal(name, entityType, entityId, payload.after, payload.before ?? null);
        await inside();
      },
    );

  type CallOptions = {
    runId: string;
    callId: string;
    engine: Engine;
    session: string;
    mode: 'fresh' | 'resumed';
    usage: Record<string, number>;
    input: string;
    failure?: { kind: string; message: string };
  };
  const call = async (opts: CallOptions) => {
    const raw =
      opts.engine.provider === 'claude' ? { usage: opts.usage, total_cost_usd: 0.042, num_turns: 1 } : { usage: opts.usage };
    const normalized = normalizeUsage(opts.engine.provider, raw);
    const output = opts.failure ? '' : '{"answer":"Guests need no account."}';
    await o.span(
      `${SPAN.invokeAgent} explorer`,
      {
        [ATTR.genAiOperationName]: 'invoke_agent',
        [ATTR.genAiProviderName]: GEN_AI_PROVIDER_NAMES[opts.engine.provider],
        [ATTR.providerId]: opts.engine.provider,
        [ATTR.genAiAgentName]: 'explorer',
        [ATTR.genAiAgentVersion]: 'v3',
        [ATTR.genAiRequestModel]: opts.engine.model,
        [ATTR.genAiResponseModel]: opts.failure ? undefined : `${opts.engine.model}-20260901`,
        [ATTR.effort]: opts.engine.effort,
        [ATTR.engineSource]: opts.engine.provider === 'codex' ? 'override' : 'group',
        [ATTR.genAiConversationId]: opts.session,
        [ATTR.sessionId]: opts.session,
        [ATTR.sessionMode]: opts.mode,
        [ATTR.sessionKeyHash]: 'k'.repeat(64),
        [ATTR.sessionName]: `demiurgo explorer ${opts.session.slice(0, 8)}`,
        ...(opts.mode === 'resumed'
          ? { [ATTR.sessionBaseRun]: BIZ.run1, [ATTR.sessionBasePackHash]: BIZ.pack1, [ATTR.deltaHash]: BIZ.delta }
          : {}),
        [ATTR.callId]: opts.callId,
        [ATTR.callAttempt]: 1,
        [ATTR.runId]: opts.runId,
        [ATTR.projectId]: BIZ.project,
        [ATTR.promptHash]: sha256Hex(SYSTEM_PROMPT),
        [ATTR.inputHash]: sha256Hex(opts.input),
        [ATTR.schemaHash]: 's'.repeat(64),
        [ATTR.schemaVersion]: '2',
        ...(opts.failure ? {} : { [ATTR.outputHash]: sha256Hex(output) }),
        ...usageAttributes(normalized),
        [ATTR.callDurationReportedMs]: opts.failure ? 30000 : 1234,
        [ATTR.cliVersion]: opts.engine.provider === 'claude' ? '2.1.283' : '0.104.0',
        [ATTR.cliCommand]:
          opts.engine.provider === 'claude' ? ['claude', '-p', '--output-format', 'stream-json'] : ['codex', 'exec', '--json'],
        [ATTR.cliCwd]: 'D:/Dev/Demiurgo',
        [ATTR.cliExitCode]: opts.failure ? 1 : 0,
        ...(opts.failure ? { [ATTR.failureKind]: opts.failure.kind } : { [ATTR.cliStopReason]: 'end_turn' }),
      },
      async (s) => {
        o.text('system_prompt', SYSTEM_PROMPT, { [ATTR.callId]: opts.callId });
        o.text('input', opts.input, { [ATTR.callId]: opts.callId });
        if (opts.failure) {
          s.setStatus('error', { type: opts.failure.kind, message: opts.failure.message });
          return;
        }
        o.text('output_raw', output, { [ATTR.callId]: opts.callId });
      },
    );
  };

  /** The three steps of a run; returns the traceparent of its prepare step (what a retry links to). */
  const runSteps = async (runId: string, callOptions: Omit<CallOptions, 'runId'>, linkTo?: string) => {
    const wf = { [ATTR.runId]: runId, [ATTR.workflowId]: `wf-${runId}`, [ATTR.stepAttempt]: 1 };
    let prepared = '';
    await o.span(SPAN.runPrepare, wf, async (s) => {
      if (linkTo) s.addLink(linkTo, { [ATTR.retryOf]: BIZ.run2 });
      prepared = s.traceParent();
    });
    await o.span(SPAN.runInvoke, wf, () => call({ runId, ...callOptions }));
    if (callOptions.failure) {
      await o.span(SPAN.runFail, { ...wf, [ATTR.failureKind]: callOptions.failure.kind }, async (s) => {
        s.setStatus('error', { type: callOptions.failure?.kind, message: callOptions.failure?.message });
        await command(
          system,
          'run.fail',
          'ai_run',
          runId,
          { before: 'running', after: 'failed' },
          { after: { failure_kind: callOptions.failure?.kind, error: callOptions.failure?.message } },
        );
      });
    }
    return prepared;
  };

  const runRequest = (runId: string, engine: Engine, pack: string, answers: string) =>
    command(
      system,
      'run.request',
      'ai_run',
      runId,
      { after: 'requested' },
      {
        after: {
          action: 'exploration_chat',
          agent: 'explorer',
          engine,
          engine_source: 'group',
          scope: { type: 'exploration', id: BIZ.thread1 },
          context_pack: pack,
          answers_message: answers,
        },
      },
    );

  const submitBatch = (runId: string, batchId: string, proposalId: string) =>
    command(
      agentOf(runId),
      'batch.submit',
      'batch',
      batchId,
      { after: 'open' },
      { after: { type: 'agent', resolution: 'item', proposals: 1, producer: `agent:run:${runId}` } },
      { [ATTR.causeRun]: runId },
      () =>
        command(
          agentOf(runId),
          'proposal.create',
          'proposal',
          proposalId,
          { after: 'pending' },
          { after: { batch: batchId, type: 'answer', dependencies: [] } },
          { [ATTR.causeRun]: runId },
        ),
    );

  const post = (interactionId: string, messageId: string, thread: string, inside: () => Promise<void>) =>
    o.interaction(
      {
        channel: 'api',
        ...human,
        command: 'message.post',
        projectId: BIZ.project,
        httpRoute: '/api/projects/:projectId/commands/:command',
        interactionId,
      },
      () =>
        command(
          human,
          'message.post',
          'message',
          messageId,
          { after: 'sent' },
          { after: { exploration: thread, question: null, type: null, length: 42 } },
          {},
          inside,
        ),
    );

  // 1. Ana asks in thread 1: R1 on claude answers, raises and infers Q1, submits P1.
  await post(BIZ.interactions.post1, BIZ.message1, BIZ.thread1, async () => {
    await runRequest(BIZ.run1, BIZ_ENGINES.claude, BIZ.pack1, BIZ.message1);
    await runSteps(BIZ.run1, {
      callId: BIZ.call1,
      engine: BIZ_ENGINES.claude,
      session: BIZ.sessionClaude,
      mode: 'fresh',
      usage: { input_tokens: 9000, cache_read_input_tokens: 0, cache_creation_input_tokens: 1000, output_tokens: 400 },
      input: 'Do guests need an account?',
    });
    await o.span(SPAN.runApply, { [ATTR.runId]: BIZ.run1, [ATTR.stepAttempt]: 1, [ATTR.stepResult]: 'applied' }, async () => {
      const agent = agentOf(BIZ.run1);
      const cause = { [ATTR.causeRun]: BIZ.run1 };
      await command(
        agent,
        'message.post',
        'message',
        BIZ.answer1,
        { after: 'sent' },
        { after: { exploration: BIZ.thread1, question: null, type: 'claim', length: 30 } },
        cause,
      );
      await command(
        agent,
        'question.raise',
        'question',
        BIZ.question1,
        { after: 'pending' },
        { after: { question: 'Do guests need an account?', impact: 'high', stage_key: null } },
        cause,
      );
      await command(
        agent,
        'question.infer',
        'question',
        BIZ.question1,
        { before: 'pending', after: 'inferred' },
        { before: { conclusion: null }, after: { conclusion: 'Guests need no account.', reasoning: 'The brief says so.' } },
        cause,
      );
      await submitBatch(BIZ.run1, BIZ.batch1, BIZ.proposal1);
    });
  });
  await sleep(5);

  // 2. Ana confirms Q1 as inferred: the inference was right.
  await o.interaction(
    {
      channel: 'api',
      ...human,
      command: 'question.confirm',
      projectId: BIZ.project,
      entityType: 'question',
      entityId: BIZ.question1,
      interactionId: BIZ.interactions.confirm,
    },
    () =>
      command(
        human,
        'question.confirm',
        'question',
        BIZ.question1,
        { before: 'inferred', after: 'confirmed' },
        { before: { conclusion: 'Guests need no account.' }, after: { conclusion: 'Guests need no account.' } },
      ),
  );
  await sleep(5);

  // 3. Ana accepts P1 as it came: the decision.
  await o.interaction(
    {
      channel: 'api',
      ...human,
      command: 'proposal.accept',
      projectId: BIZ.project,
      entityType: 'proposal',
      entityId: BIZ.proposal1,
      interactionId: BIZ.interactions.accept,
    },
    () =>
      command(
        human,
        'proposal.accept',
        'proposal',
        BIZ.proposal1,
        { before: 'pending', after: 'accepted' },
        { after: { effect: { kind: 'answer' }, approve: false } },
      ),
  );
  await sleep(5);

  // 4. Ana asks again: R2 resumes the claude session and times out without reading the cache.
  let retryLink = '';
  await post(BIZ.interactions.post2, BIZ.message2, BIZ.thread1, async () => {
    await runRequest(BIZ.run2, BIZ_ENGINES.claude, BIZ.pack2, BIZ.message2);
    retryLink = await runSteps(BIZ.run2, {
      callId: BIZ.call2,
      engine: BIZ_ENGINES.claude,
      session: BIZ.sessionClaude,
      mode: 'resumed',
      usage: { input_tokens: 1000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 0 },
      input: 'And what about the second pillar?',
      failure: { kind: 'timeout', message: 'The provider did not answer in 30 s.' },
    });
  });
  await sleep(5);

  // 5. Ana retries R2 on codex: R3 raises Q2 (left open) and submits P2.
  await o.interaction(
    {
      channel: 'api',
      ...human,
      command: 'run.retry',
      projectId: BIZ.project,
      entityType: 'ai_run',
      entityId: BIZ.run2,
      interactionId: BIZ.interactions.retry,
    },
    async () => {
      await command(
        human,
        'run.retry',
        'ai_run',
        BIZ.run3,
        { after: 'requested' },
        {
          after: {
            retry_of: BIZ.run2,
            engine: BIZ_ENGINES.codex,
            engine_source: 'override',
            override: BIZ_ENGINES.codex,
          },
        },
      );
      await runSteps(
        BIZ.run3,
        {
          callId: BIZ.call3,
          engine: BIZ_ENGINES.codex,
          session: BIZ.sessionCodex,
          mode: 'fresh',
          usage: { input_tokens: 5000, cached_input_tokens: 0, output_tokens: 600, reasoning_output_tokens: 120 },
          input: 'And what about the second pillar?',
        },
        retryLink,
      );
      await o.span(SPAN.runApply, { [ATTR.runId]: BIZ.run3, [ATTR.stepAttempt]: 1, [ATTR.stepResult]: 'applied' }, async () => {
        await command(
          agentOf(BIZ.run3),
          'question.raise',
          'question',
          BIZ.question2,
          { after: 'pending' },
          { after: { question: 'Is the second pillar in scope for H1?', impact: 'medium', stage_key: null } },
          { [ATTR.causeRun]: BIZ.run3 },
        );
        await submitBatch(BIZ.run3, BIZ.batch2, BIZ.proposal2);
      });
    },
  );
  await sleep(5);

  // 6. Ana rejects P2.
  await o.interaction(
    {
      channel: 'api',
      ...human,
      command: 'proposal.reject',
      projectId: BIZ.project,
      entityType: 'proposal',
      entityId: BIZ.proposal2,
      interactionId: BIZ.interactions.reject,
    },
    () =>
      command(
        human,
        'proposal.reject',
        'proposal',
        BIZ.proposal2,
        { before: 'pending', after: 'rejected' },
        { after: { reason: 'Out of scope for H1.' } },
      ),
  );
  await sleep(5);

  // 7. Ana opens thread 2 and posts without asking for an answer.
  await o.interaction(
    { channel: 'api', ...human, command: 'exploration.open', projectId: BIZ.project, interactionId: BIZ.interactions.open2 },
    () =>
      command(
        human,
        'exploration.open',
        'exploration',
        BIZ.thread2,
        { after: 'active' },
        { after: { purpose: 'The second pillar', origin: null, parent: null } },
      ),
  );
  await sleep(5);
  await post(BIZ.interactions.post3, BIZ.message3, BIZ.thread2, async () => undefined);

  await o.flush(1000);
  return o.toOtlpJson();
}

if (process.argv[1]?.endsWith('build-business.ts')) {
  const json = await buildBusinessFixture();
  await writeFile(BUSINESS_FIXTURE_PATH, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  process.stdout.write(`Wrote ${BUSINESS_FIXTURE_PATH}\n`);
}
