// Regenerates `interaction.otlp.json`: the notes of §6 for one message that runs the explorer on a
// fresh session, the human acceptance of its proposal, and a second message that resumes the
// session, recorded with the core's memory observer and serialized exactly as the exporter would.
//
//   node packages/evidence/test/fixtures/build.ts

import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createMemoryObserver } from '@demiurgo/core';
import { ATTR, GEN_AI_PROVIDER_NAMES, LOG, SPAN, normalizeUsage, sha256Hex, usageAttributes } from '@demiurgo/domain';
import { IDS, TEXTS } from './ids.ts';

export const FIXTURE_PATH = fileURLToPath(new URL('./interaction.otlp.json', import.meta.url));

type Attrs = Record<string, string | number | boolean | readonly string[] | undefined | null>;

export async function buildInteractionFixture(): Promise<{ traces: unknown; logs: unknown }> {
  const o = createMemoryObserver({ environment: 'test', serviceVersion: 'fixture', instance: '8100' });
  const human = { actor: 'human:ana', actorType: 'human' };
  const commandAttrs = (command: string, entityType: string, entityId: string, extra: Attrs = {}): Attrs => ({
    [ATTR.command]: command,
    [ATTR.actor]: human.actor,
    [ATTR.actorType]: human.actorType,
    [ATTR.projectId]: IDS.project,
    [ATTR.entityType]: entityType,
    [ATTR.entityId]: entityId,
    [ATTR.outcome]: 'ok',
    ...extra,
  });
  const journal = (seq: number, command: string, entityType: string, entityId: string, after: unknown, before: unknown = null) =>
    o.event(
      LOG.journal,
      {
        [ATTR.eventSeq]: seq,
        [ATTR.command]: command,
        [ATTR.entityType]: entityType,
        [ATTR.entityId]: entityId,
        [ATTR.projectId]: IDS.project,
      },
      { before, after },
    );

  const call = async (opts: { runId: string; callId: string; mode: 'fresh' | 'resumed'; usage: Record<string, number> }) => {
    const normalized = normalizeUsage('claude', { usage: opts.usage, total_cost_usd: 0.042, num_turns: 1 });
    await o.span(
      `${SPAN.invokeAgent} explorer`,
      {
        [ATTR.genAiOperationName]: 'invoke_agent',
        [ATTR.genAiProviderName]: GEN_AI_PROVIDER_NAMES.claude,
        [ATTR.providerId]: 'claude',
        [ATTR.genAiAgentName]: 'explorer',
        [ATTR.genAiAgentVersion]: 'v3',
        [ATTR.genAiRequestModel]: 'claude-sonnet-4-5',
        [ATTR.genAiResponseModel]: 'claude-sonnet-4-5-20260901',
        [ATTR.effort]: 'medium',
        [ATTR.engineSource]: 'group',
        [ATTR.genAiConversationId]: IDS.session,
        [ATTR.sessionId]: IDS.session,
        [ATTR.sessionMode]: opts.mode,
        [ATTR.sessionKeyHash]: 'k'.repeat(64),
        [ATTR.sessionName]: 'demiurgo explorer 0199a000',
        ...(opts.mode === 'resumed'
          ? { [ATTR.sessionBaseRun]: IDS.run1, [ATTR.sessionBasePackHash]: IDS.pack1, [ATTR.deltaHash]: IDS.delta }
          : {}),
        [ATTR.callId]: opts.callId,
        [ATTR.callAttempt]: 1,
        [ATTR.runId]: opts.runId,
        [ATTR.projectId]: IDS.project,
        [ATTR.promptHash]: sha256Hex(TEXTS.systemPrompt),
        [ATTR.inputHash]: sha256Hex(TEXTS.input),
        [ATTR.schemaHash]: 's'.repeat(64),
        [ATTR.schemaVersion]: '2',
        [ATTR.outputHash]: sha256Hex(TEXTS.outputRaw),
        ...usageAttributes(normalized),
        [ATTR.callDurationReportedMs]: 1234,
        [ATTR.callDurationApiMs]: 1100,
        [ATTR.cliVersion]: '2.1.283',
        [ATTR.cliCommand]: ['claude', '-p', '--output-format', 'stream-json'],
        [ATTR.cliCwd]: 'D:/Dev/Demiurgo',
        [ATTR.cliExitCode]: 0,
        [ATTR.cliStopReason]: 'end_turn',
      },
      async () => {
        o.text('system_prompt', TEXTS.systemPrompt, { [ATTR.callId]: opts.callId });
        o.text('input', opts.mode === 'fresh' ? TEXTS.input : TEXTS.delta, { [ATTR.callId]: opts.callId });
        o.text('output_raw', TEXTS.outputRaw, { [ATTR.callId]: opts.callId });
        const lines = [
          { type: 'system', subtype: 'init', session_id: IDS.session },
          { type: 'result', usage: opts.usage, total_cost_usd: 0.042 },
        ];
        lines.forEach((line, i) =>
          o.event(
            LOG.providerEvent,
            {
              [ATTR.eventId]: `0199a200-0000-7000-8000-${opts.callId.slice(-8)}000${i}`,
              [ATTR.callId]: opts.callId,
              [ATTR.eventSeq]: i + 1,
              [ATTR.eventKind]: line.type,
              [ATTR.eventTokens]: JSON.stringify(opts.usage),
              [ATTR.eventReceivedAt]: new Date().toISOString(),
            },
            JSON.stringify(line),
          ),
        );
      },
    );
  };

  const runSteps = async (runId: string, callId: string, mode: 'fresh' | 'resumed', usage: Record<string, number>) => {
    await o.span(
      SPAN.runPrepare,
      { [ATTR.runId]: runId, [ATTR.workflowId]: `wf-${runId}`, [ATTR.stepAttempt]: 1 },
      async () => undefined,
    );
    await o.span(SPAN.runInvoke, { [ATTR.runId]: runId, [ATTR.workflowId]: `wf-${runId}`, [ATTR.stepAttempt]: 1 }, () =>
      call({ runId, callId, mode, usage }),
    );
    await o.span(
      SPAN.runApply,
      { [ATTR.runId]: runId, [ATTR.workflowId]: `wf-${runId}`, [ATTR.stepAttempt]: 1, [ATTR.stepResult]: 'applied' },
      async () => undefined,
    );
  };

  // 1. A message from Ana: the run on a fresh session, its batch and proposal.
  await o.interaction(
    {
      channel: 'api',
      ...human,
      command: 'message.send',
      projectId: IDS.project,
      httpRoute: '/api/projects/:projectId/commands/:command',
      interactionId: IDS.interaction1,
    },
    async () => {
      await o.span(
        `${SPAN.command} message.send`,
        commandAttrs('message.send', 'message', IDS.message, { [ATTR.stateAfter]: 'sent', [ATTR.eventSeq]: 1 }),
        async () => {
          journal(1, 'message.send', 'message', IDS.message, { body: 'What is the purpose of the project?' });
          await o.span(
            `${SPAN.command} run.request`,
            commandAttrs('run.request', 'ai_run', IDS.run1, { [ATTR.stateAfter]: 'requested', [ATTR.eventSeq]: 2 }),
            async () => {
              journal(2, 'run.request', 'ai_run', IDS.run1, {
                action: 'exploration_chat',
                agent: 'explorer',
                engine: { provider: 'claude', model: 'claude-sonnet-4-5', effort: 'medium' },
                scope: { exploration: 'x1' },
                context_pack: IDS.pack1,
                answers_message: IDS.message,
              });
            },
          );
        },
      );
      await runSteps(IDS.run1, IDS.call1, 'fresh', {
        input_tokens: 9000,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 1000,
        output_tokens: 400,
      });
      await o.span(
        `${SPAN.command} batch.submit`,
        {
          ...commandAttrs('batch.submit', 'batch', IDS.batch, { [ATTR.stateAfter]: 'open', [ATTR.eventSeq]: 3 }),
          [ATTR.actor]: `agent:run:${IDS.run1}`,
          [ATTR.actorType]: 'agent_run',
          [ATTR.causeRun]: IDS.run1,
        },
        async () => {
          journal(3, 'batch.submit', 'batch', IDS.batch, {
            type: 'agent',
            resolution: 'item',
            proposals: 1,
            producer: `agent:run:${IDS.run1}`,
          });
          await o.span(
            `${SPAN.command} proposal.create`,
            {
              ...commandAttrs('proposal.create', 'proposal', IDS.proposal, { [ATTR.stateAfter]: 'pending', [ATTR.eventSeq]: 4 }),
              [ATTR.actor]: `agent:run:${IDS.run1}`,
              [ATTR.actorType]: 'agent_run',
              [ATTR.causeRun]: IDS.run1,
            },
            async () => {
              journal(4, 'proposal.create', 'proposal', IDS.proposal, { batch: IDS.batch, type: 'answer', dependencies: [] });
            },
          );
        },
      );
    },
  );

  // 2. Ana accepts the proposal as it came.
  await o.interaction(
    {
      channel: 'api',
      ...human,
      command: 'proposal.accept',
      projectId: IDS.project,
      entityType: 'proposal',
      entityId: IDS.proposal,
      interactionId: IDS.interaction2,
    },
    async () => {
      await o.span(
        `${SPAN.command} proposal.accept`,
        commandAttrs('proposal.accept', 'proposal', IDS.proposal, {
          [ATTR.stateBefore]: 'pending',
          [ATTR.stateAfter]: 'accepted',
          [ATTR.eventSeq]: 5,
        }),
        async () => {
          journal(5, 'proposal.accept', 'proposal', IDS.proposal, { effect: { kind: 'answer' }, approve: false });
        },
      );
    },
  );

  // 3. A second message: the run resumes the session from run 1 with a delta; most input comes from the cache.
  await o.interaction(
    { channel: 'api', ...human, command: 'message.send', projectId: IDS.project, interactionId: IDS.interaction3 },
    async () => {
      await o.span(
        `${SPAN.command} run.request`,
        commandAttrs('run.request', 'ai_run', IDS.run2, { [ATTR.stateAfter]: 'requested', [ATTR.eventSeq]: 6 }),
        async () => {
          journal(6, 'run.request', 'ai_run', IDS.run2, {
            action: 'exploration_chat',
            agent: 'explorer',
            engine: { provider: 'claude', model: 'claude-sonnet-4-5', effort: 'medium' },
            scope: { exploration: 'x1' },
            context_pack: 'b'.repeat(64),
          });
        },
      );
      await runSteps(IDS.run2, IDS.call2, 'resumed', {
        input_tokens: 1000,
        cache_read_input_tokens: 8000,
        cache_creation_input_tokens: 500,
        output_tokens: 300,
      });
    },
  );

  await o.flush(1000);
  return o.toOtlpJson();
}

if (process.argv[1]?.endsWith('build.ts')) {
  const json = await buildInteractionFixture();
  await writeFile(FIXTURE_PATH, `${JSON.stringify(json, null, 2)}\n`, 'utf8');
  process.stdout.write(`Wrote ${FIXTURE_PATH}\n`);
}
