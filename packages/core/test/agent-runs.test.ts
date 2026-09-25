// Runs executed by DEMIURGO agents on the assigned provider (FDR-AGE-002): what each run records,
// how it resolves its engine, the provider session with its delta, and Retry with….

import { type ProviderId, composeSystem, human, isDomainError } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadAgentCatalog } from '../src/agents/catalog.ts';
import { DEFAULT_SCRIPTS, type SimulatedInvocation, createSimulatedProvider } from '../src/agents/simulated.ts';
import { assignAgent, unassignAgent } from '../src/assignments/index.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { waitForRun } from '../src/engine/engine.ts';
import { useEnvironment } from './support/env.ts';
import { seedCatalog } from './support/seed.ts';

const received: SimulatedInvocation[] = [];

/** A second provider under Codex's id, so Retry with… can switch engine without quota. */
function fakeCodex() {
  const base = createSimulatedProvider({ onInvoke: (p) => received.push(p) });
  return { ...base, id: 'codex' as ProviderId, label: 'Codex' };
}

const environment = useEnvironment({
  durable: true,
  providers: () => [
    createSimulatedProvider({
      onInvoke: (p) => received.push(p),
      scripts: {
        echo: (p) => {
          const text = (p.context.content as { input: { text: string } }).input.text;
          return text === 'invalid' ? { reply: 42 } : { reply: `Echo: ${text}` };
        },
        // A person's message with [invalid] makes the explorer answer outside the schema.
        exploration_chat: (p) =>
          JSON.stringify(p.context.content).includes('[invalid]') ? { reply: 42 } : DEFAULT_SCRIPTS.exploration_chat(p),
      },
    }),
    fakeCodex(),
  ],
});

const ana = human('ana');
let projectId = '';

beforeAll(async () => {
  const s = environment().services;
  projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Agents' } })).projectId;
  await seedCatalog(s.db, 'codex', [{ id: 'gpt-test', label: 'GPT test', efforts: ['low', 'high'], defaultEffort: 'low' }]);
});

const cmd = (command: Parameters<typeof executeCommand>[1]['command'], data: unknown, entityId?: string) =>
  executeCommand(environment().services, { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });

async function openThread(purpose: string): Promise<string> {
  return (await cmd('exploration.open', { purpose })).entityId;
}

async function ask(explorationId: string, agent?: string): Promise<string> {
  const r = await cmd('run.request', {
    action: 'exploration_chat',
    ...(agent ? { agent } : {}),
    scope: { type: 'exploration', id: explorationId },
  });
  await waitForRun(r.entityId);
  return r.entityId;
}

const run = (id: string) =>
  environment().services.db.selectFrom('ai_runs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();

async function rejection(p: Promise<unknown>): Promise<{ type: string; reasons: string[] }> {
  const e: unknown = await p.then(
    () => null,
    (x: unknown) => x,
  );
  return isDomainError(e) ? { type: e.type, reasons: [...e.reasons] } : { type: 'none', reasons: [] };
}

describe('agent runs', () => {
  it('AC-AGE-002-05 a run records its agent and version, prompt hash, engine, observed model and session mode', async () => {
    const thread = await openThread('Day 1 of a product');
    await cmd('message.post', { exploration_id: thread, text: 'I want to build a recipe app.', respond: false });
    const id = await ask(thread, 'onboarding');
    const onboarding = (await loadAgentCatalog()).get('onboarding');
    if (!onboarding) throw new Error('No onboarding agent.');
    expect(await run(id)).toMatchObject({
      state: 'completed',
      agent: 'onboarding',
      method: `onboarding@${onboarding.version}`,
      provider: 'simulated',
      requested_model: 'simulated',
      effort: null,
      model: 'simulated',
      prompt_hash: composeSystem(onboarding, onboarding.skillDefinitions).promptHash,
      session_mode: 'fresh',
      provider_session_id: expect.stringMatching(/^sim-/),
      delta_hash: null,
    });
    const last = received.at(-1);
    expect(last?.system).toBe(composeSystem(onboarding, onboarding.skillDefinitions).system);
    expect(last?.timeMs).toBe(onboarding.timeLimitSeconds * 1000);
  });

  it('AC-AGE-002-05 without an agent the run uses the default agent of its action', async () => {
    const id = (await cmd('run.request', { action: 'echo', scope: { type: 'echo' }, input: { text: 'hi' } })).entityId;
    expect(await waitForRun(id)).toBe('completed');
    expect(await run(id)).toMatchObject({ agent: 'echo', session_mode: 'none', provider_session_id: null });
    expect(received.at(-1)?.timeMs).toBe(120_000);
  });

  it('AC-AGE-002-05 an agent that does not serve the action is rejected with 422', async () => {
    const r = await rejection(cmd('run.request', { action: 'echo', agent: 'designer', scope: { type: 'echo' }, input: {} }));
    expect(r.type).toBe('validation');
  });

  it('AC-AGE-002-07 an output outside the schema fails as invalid_output and applies nothing, whatever the provider', async () => {
    const id = (await cmd('run.request', { action: 'echo', scope: { type: 'echo' }, input: { text: 'invalid' } })).entityId;
    expect(await waitForRun(id)).toBe('failed');
    expect(await run(id)).toMatchObject({ failure_kind: 'invalid_output', output: null });
    const call = await environment()
      .services.db.selectFrom('agent_calls')
      .selectAll()
      .where('run_id', '=', id)
      .executeTakeFirstOrThrow();
    expect(call.state).toBe('ok');
  });

  it('the run asks the options of every pending question without them, the reserve included, and they arrive', async () => {
    const thread = await openThread('Questions with answers');
    await cmd('message.post', { exploration_id: thread, text: 'A diary app.', respond: false });
    const raise = async (question: string, options: unknown[] = []) =>
      (await cmd('question.raise', { exploration_id: thread, question, options })).entityId;
    const bare = [await raise('Who writes in it?'), await raise('Is it private?'), await raise('Does it sync?')];
    const withOptions = await raise('Mobile or web?', [
      { answer: 'Mobile', implies: 'An app first.', exclusive: false },
      { answer: 'Web', implies: 'A site first.', exclusive: false },
    ]);
    await ask(thread);
    const schema = received.at(-1)?.schema as { properties: { question_options: { type: string; required: string[] } } };
    expect(schema.properties.question_options.type).toBe('object');
    // The project's stage questions without options may come too.
    const required = schema.properties.question_options.required;
    expect(required).toEqual(expect.arrayContaining(bare));
    expect(required).not.toContain(withOptions);
    const rows = await environment()
      .services.db.selectFrom('questions')
      .select(['id', 'options'])
      .where('id', 'in', [...bare, withOptions])
      .execute();
    expect(rows).toHaveLength(4);
    for (const r of rows) expect(r.options).toHaveLength(2);
  });

  it('AC-AGE-002-09 the thread resumes with only the delta while the pack only appends, and starts over otherwise', async () => {
    const thread = await openThread('Pricing');
    await cmd('message.post', { exploration_id: thread, text: 'Who pays for this?', respond: false });
    const first = await ask(thread);
    expect(await run(first)).toMatchObject({ session_mode: 'fresh', agent: 'explorer' });
    const sessionId = (await run(first)).provider_session_id;

    await cmd('message.post', { exploration_id: thread, text: 'Restaurants pay a monthly fee.', respond: false });
    const second = await ask(thread);
    const resumed = await run(second);
    expect(resumed).toMatchObject({ session_mode: 'resumed', provider_session_id: sessionId, delta_hash: expect.any(String) });
    const input = received.at(-1)?.input ?? '';
    expect(input).toContain('This continues the previous turn');
    expect(input).toContain('Restaurants pay a monthly fee.');
    // Only what was added: the new message (and the agent's own reply), not the first message.
    expect(input).not.toContain('"text": "Who pays for this?"');
    expect(received.at(-1)?.session).toEqual({ mode: 'resumed', directory: expect.any(String), id: sessionId });

    // A question changed state: the pack no longer only appends.
    const pending = (
      await environment()
        .services.db.selectFrom('questions')
        .select('id')
        .where('exploration_id', '=', thread)
        .where('state', '=', 'pending')
        .executeTakeFirst()
    )?.id;
    if (!pending) throw new Error('The simulated explorer should have raised a question.');
    await cmd('question.postpone', { reason: 'Later.' }, pending);
    const third = await ask(thread);
    expect(await run(third)).toMatchObject({ session_mode: 'fresh', delta_hash: null });
    expect(received.at(-1)?.input).toContain('Who pays for this?');

    // A resumed run that fails; its retry starts over with the whole pack.
    await cmd('message.post', { exploration_id: thread, text: '[invalid] one more thing', respond: false });
    const failed = await ask(thread);
    expect(await run(failed)).toMatchObject({ state: 'failed', failure_kind: 'invalid_output', session_mode: 'resumed' });
    const again = (await cmd('run.retry', { run_id: failed })).entityId;
    await waitForRun(again);
    expect(await run(again)).toMatchObject({ session_mode: 'fresh', retry_of: failed });
    expect(received.at(-1)?.input).toContain('Who pays for this?');
  });

  it('AC-AGE-002-11 Retry with… runs the same context pack on the chosen engine; an engine outside the catalog is 422', async () => {
    const failed = (await cmd('run.request', { action: 'echo', scope: { type: 'echo' }, input: { text: 'invalid' } })).entityId;
    await waitForRun(failed);
    const retried = (
      await cmd('run.retry', { run_id: failed, override: { provider: 'codex', model: 'gpt-test', effort: 'high' } })
    ).entityId;
    await waitForRun(retried);
    const [a, b] = [await run(failed), await run(retried)];
    expect(b).toMatchObject({
      provider: 'codex',
      requested_model: 'gpt-test',
      effort: 'high',
      context_pack_id: a.context_pack_id,
      retry_of: failed,
    });
    const bad = await rejection(
      cmd('run.retry', { run_id: failed, override: { provider: 'codex', model: 'gpt-9', effort: 'high' } }),
    );
    expect(bad.type).toBe('validation');
  });

  it('AC-AGE-002-03 without an engine the run is not created and the error names the agent', async () => {
    const s = environment().services;
    const deps = { db: s.db, providers: s.providers };
    const count = async () =>
      Number(
        (
          await s.db
            .selectFrom('ai_runs')
            .select((eb) => eb.fn.countAll<string>().as('n'))
            .executeTakeFirstOrThrow()
        ).n,
      );
    // designer and explorer are both Deep thinking.
    await unassignAgent(deps, ana, { group: 'deep' });
    try {
      const before = await count();
      const r = await rejection(
        cmd('run.request', {
          action: 'design_proposal',
          scope: { type: 'record_version', id: '00000000-0000-7000-8000-000000000001' },
        }),
      );
      expect(r).toEqual({ type: 'guard', reasons: ['Choose a model for designer in Models & providers.'] });
      const thread = await openThread('No engine');
      const m = await rejection(cmd('message.post', { exploration_id: thread, text: 'Hello?', respond: true }));
      expect(m).toEqual({ type: 'guard', reasons: ['Choose a model for explorer in Models & providers.'] });
      // Without asking for an answer, the message is posted.
      await cmd('message.post', { exploration_id: thread, text: 'Just a note.', respond: false });
      expect(await count()).toBe(before);
    } finally {
      await assignAgent(deps, ana, { group: 'deep', provider: 'simulated', model: 'simulated', effort: null });
    }
  });
});
