// An answer that fails its schema or its action's checks goes back to the same engine once, with the
// problems, instead of being dropped whole: the corrected answer is applied; if the correction fails
// too, the run fails as before and both calls are on record.

import { type AgentResult, type Provider, human } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSimulatedProvider } from '../src/agents/simulated.ts';
import { insertChoice } from '../src/assignments/index.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { waitForRun } from '../src/engine/engine.ts';
import { useEnvironment } from './support/env.ts';
import { seedCatalog } from './support/seed.ts';

const SLOPPY = { provider: 'opencode', model: 'sloppy', effort: null };
const STUBBORN = { provider: 'opencode', model: 'stubborn', effort: null };
const inputs: string[] = [];

const answer = (model: string, output: unknown): AgentResult => ({
  state: 'ok',
  rawOutput: output,
  rawEvents: '',
  usage: { inputTokens: 1, outputTokens: 1, durationMs: 1, provenance: { inputTokens: 'test', outputTokens: 'test' } },
  provider: 'opencode',
  model,
});

/** A model that answers outside the schema first; "sloppy" fixes it when told what was wrong. */
function sloppyModel(): Provider {
  return {
    id: 'opencode',
    label: 'OpenCode',
    sessions: false,
    async discover() {
      return {
        provider: 'opencode',
        label: 'OpenCode',
        installed: true,
        version: 'test',
        ready: true,
        message: null,
        sessions: false,
        models: [],
      };
    },
    async run(inv) {
      inputs.push(inv.input);
      const told = inv.input.includes("Your previous answer can't be used as it is");
      return inv.model === SLOPPY.model && told
        ? answer(inv.model, { reply: 'Fixed.' })
        : answer(inv.model, { reply: 'x'.repeat(2500) });
    },
  };
}

const environment = useEnvironment({ durable: true, providers: () => [createSimulatedProvider(), sloppyModel()] });
const ana = human('ana');
let projectId = '';

beforeAll(async () => {
  const s = environment().services;
  projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Corrections' } })).projectId;
  await seedCatalog(s.db, 'opencode', [
    { id: SLOPPY.model, label: 'Sloppy', efforts: [], defaultEffort: null },
    { id: STUBBORN.model, label: 'Stubborn', efforts: [], defaultEffort: null },
  ]);
});

async function echo(): Promise<string> {
  const r = await executeCommand(environment().services, {
    command: 'run.request',
    actor: ana,
    projectId,
    data: { action: 'echo', scope: { type: 'project' }, input: { text: 'hello' } },
  });
  await waitForRun(r.entityId);
  return r.entityId;
}

const run = (id: string) =>
  environment().services.db.selectFrom('ai_runs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
const calls = (id: string) =>
  environment()
    .services.db.selectFrom('agent_calls')
    .select(['requested_model', 'state'])
    .where('run_id', '=', id)
    .orderBy('started_at')
    .execute();

describe('an answer the engine can correct', () => {
  it('goes back once with what was wrong, and the corrected answer is the one applied', async () => {
    inputs.length = 0;
    await insertChoice(environment().services.db, { agent: 'echo' }, SLOPPY, 'human:ana');
    const id = await echo();
    expect(await run(id)).toMatchObject({ state: 'completed', output: { reply: 'Fixed.' } });
    expect(await calls(id)).toEqual([
      { requested_model: SLOPPY.model, state: 'ok' },
      { requested_model: SLOPPY.model, state: 'ok' },
    ]);
    // Without a session, the correction carries the whole input, its own answer and the problem.
    expect(inputs[1]).toContain(inputs[0]);
    expect(inputs[1]).toContain('Your previous answer:');
    expect(inputs[1]).toContain('reply: Too big');
  });

  it('fails as before when the correction is still wrong, and only one correction is asked', async () => {
    await insertChoice(environment().services.db, { agent: 'echo' }, STUBBORN, 'human:ana');
    const id = await echo();
    expect(await run(id)).toMatchObject({ state: 'failed', failure_kind: 'invalid_output' });
    expect(await calls(id)).toHaveLength(2);
  });
});
