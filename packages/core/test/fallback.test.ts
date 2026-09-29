// Backup engines (Models & providers): a group's or an agent's backup runs only when the chosen
// engine can't answer, because it isn't available or can't be reached, and the run says so. A
// wrong answer and Retry with… never fall back, and translations fall back the same way.

import { type AgentResult, type Provider, human, isDomainError, system } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSimulatedProvider } from '../src/agents/simulated.ts';
import {
  currentFallbacks,
  fallbackOf,
  insertChoice,
  removeFallback,
  resolveEngine,
  setFallback,
  unassignAgent,
} from '../src/assignments/index.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { waitForRun } from '../src/engine/engine.ts';
import { translateFields } from '../src/translation/index.ts';
import { useEnvironment } from './support/env.ts';
import { seedCatalog } from './support/seed.ts';

const QWEN = { provider: 'opencode', model: 'qwen-test', effort: null };
const WRONG = { provider: 'opencode', model: 'qwen-wrong', effort: null };
const SIMULATED = { provider: 'simulated', model: 'simulated', effort: null };
const UNREACHABLE = 'Could not reach Qwen at http://192.0.2.1:8080/v1: connect ECONNREFUSED.';

/** A local model that is down: it can't be reached, or (qwen-wrong) it answers something useless. */
function downLocalModel(): Provider {
  const fail = (model: string): AgentResult =>
    model === WRONG.model
      ? {
          state: 'error',
          failureKind: 'agent_error',
          message: 'Qwen answered HTTP 500.',
          rawEvents: '',
          provider: 'opencode',
          model,
        }
      : { state: 'error', failureKind: 'infra', message: UNREACHABLE, rawEvents: '', provider: 'opencode', model };
  const provider: Provider = {
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
      return fail(inv.model);
    },
  };
  return provider;
}

const environment = useEnvironment({ durable: true, providers: () => [createSimulatedProvider(), downLocalModel()] });

const ana = human('ana');
let projectId = '';

beforeAll(async () => {
  const s = environment().services;
  projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Backups' } })).projectId;
  await seedCatalog(s.db, 'opencode', [
    { id: QWEN.model, label: 'Qwen test', efforts: [], defaultEffort: null },
    { id: WRONG.model, label: 'Qwen wrong', efforts: [], defaultEffort: null },
  ]);
});

const deps = () => ({ db: environment().services.db, providers: environment().services.providers });
const cmd = (command: Parameters<typeof executeCommand>[1]['command'], data: unknown) =>
  executeCommand(environment().services, { command, actor: ana, projectId, data });
const run = (id: string) =>
  environment().services.db.selectFrom('ai_runs').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
const calls = (runId: string) =>
  environment()
    .services.db.selectFrom('agent_calls')
    .select(['provider', 'requested_model', 'state', 'failure_kind'])
    .where('run_id', '=', runId)
    .orderBy('started_at')
    .execute();

async function echo(text: string): Promise<string> {
  const r = await cmd('run.request', { action: 'echo', scope: { type: 'project' }, input: { text } });
  await waitForRun(r.entityId);
  return r.entityId;
}

async function rejection(p: Promise<unknown>): Promise<{ type: string; message: string; reasons: string[] }> {
  const e: unknown = await p.then(
    () => null,
    (x: unknown) => x,
  );
  return isDomainError(e)
    ? { type: e.type, message: e.message, reasons: [...e.reasons] }
    : { type: 'none', message: '', reasons: [] };
}

describe('backup engines', () => {
  it('only a person sets a backup, from what the providers offer; removing an agent’s own leaves its group’s', async () => {
    expect(await rejection(setFallback(deps(), system('test'), { group: 'deep', ...SIMULATED }))).toMatchObject({
      type: 'forbidden',
    });
    expect(
      (await rejection(setFallback(deps(), ana, { group: 'deep', provider: 'simulated', model: 'gpt-9', effort: null }))).type,
    ).toBe('validation');
    await setFallback(deps(), ana, { group: 'deep', ...SIMULATED });
    await setFallback(deps(), ana, { agent: 'explorer', ...QWEN });
    expect(await fallbackOf(deps().db, deps().providers, 'explorer')).toMatchObject({ ...QWEN, source: 'agent', problem: null });
    await removeFallback(deps(), ana, { agent: 'explorer' });
    expect(await fallbackOf(deps().db, deps().providers, 'explorer')).toMatchObject({ ...SIMULATED, source: 'group' });
    expect((await currentFallbacks(deps().db)).groups.deep?.engine).toEqual(SIMULATED);
    await removeFallback(deps(), ana, { group: 'deep' });
    expect(await fallbackOf(deps().db, deps().providers, 'explorer')).toBeNull();
  });

  it('a run whose engine can’t be reached runs once more on the backup, and says which one it replaced and why', async () => {
    const s = environment().services;
    await insertChoice(s.db, { agent: 'echo' }, QWEN, 'human:ana');
    await setFallback(deps(), ana, { agent: 'echo', ...SIMULATED });

    const id = await echo('hello');
    expect(await run(id)).toMatchObject({
      state: 'completed',
      provider: 'simulated',
      requested_model: 'simulated',
      fallback: { from: QWEN, reason: UNREACHABLE },
      output: { reply: 'Echo: hello' },
    });
    // Both calls are recorded: the one that couldn't reach Qwen, then the backup's.
    expect(await calls(id)).toEqual([
      { provider: 'opencode', requested_model: QWEN.model, state: 'error', failure_kind: 'infra' },
      { provider: 'simulated', requested_model: 'simulated', state: 'ok', failure_kind: null },
    ]);
    const completed = await s.db
      .selectFrom('events')
      .select('after')
      .where('entity_id', '=', id)
      .where('command', '=', 'run.complete')
      .executeTakeFirstOrThrow();
    expect(completed.after).toMatchObject({ fallback: { engine: SIMULATED, from: QWEN, reason: UNREACHABLE } });
  });

  it('a wrong answer, a run without backup and Retry with… don’t fall back', async () => {
    const s = environment().services;
    await insertChoice(s.db, { agent: 'echo' }, WRONG, 'human:ana');
    const wrong = await echo('wrong');
    expect(await run(wrong)).toMatchObject({
      state: 'failed',
      failure_kind: 'agent_error',
      provider: 'opencode',
      fallback: null,
    });
    expect(await calls(wrong)).toHaveLength(1);

    // Retry with… runs exactly the engine the person chose.
    const retry = await cmd('run.retry', { run_id: wrong, override: QWEN });
    await waitForRun(retry.entityId);
    expect(await run(retry.entityId)).toMatchObject({
      state: 'failed',
      failure_kind: 'infra',
      provider: 'opencode',
      fallback: null,
    });

    await insertChoice(s.db, { agent: 'echo' }, QWEN, 'human:ana');
    await removeFallback(deps(), ana, { agent: 'echo' });
    const alone = await echo('alone');
    expect(await run(alone)).toMatchObject({ state: 'failed', failure_kind: 'infra', error: UNREACHABLE, fallback: null });
  });

  it('an engine that isn’t available any more starts the run on the backup; without one, the run isn’t created', async () => {
    const s = environment().services;
    const gone = { provider: 'opencode', model: 'qwen-gone', effort: null };
    await insertChoice(s.db, { agent: 'echo' }, gone, 'human:ana');
    const reason = 'qwen-gone is no longer offered by OpenCode.';
    expect(
      await rejection(cmd('run.request', { action: 'echo', scope: { type: 'project' }, input: { text: 'x' } })),
    ).toMatchObject({
      type: 'guard',
      reasons: [`${reason} Choose another model for echo.`],
    });

    await setFallback(deps(), ana, { agent: 'echo', ...SIMULATED });
    expect(await resolveEngine(s.db, s.providers, { agent: 'echo' })).toMatchObject({
      status: 'ok',
      source: 'fallback',
      ...SIMULATED,
      replaced: { ...gone, reason },
    });
    const id = await echo('still here');
    expect(await run(id)).toMatchObject({ state: 'completed', provider: 'simulated', fallback: { from: gone, reason } });
    const requested = await s.db
      .selectFrom('events')
      .select('after')
      .where('entity_id', '=', id)
      .where('command', '=', 'run.request')
      .executeTakeFirstOrThrow();
    expect(requested.after).toMatchObject({ engine_source: 'fallback', replaced: { ...gone, reason } });

    // A backup that can't run either is said too.
    await s.db
      .insertInto('engine_fallbacks')
      .values({ agent: 'echo', ...gone, assigned_by: 'human:ana' })
      .execute();
    expect(
      (await rejection(cmd('run.request', { action: 'echo', scope: { type: 'project' }, input: { text: 'x' } }))).reasons,
    ).toEqual([`${reason} Its backup can't run either: ${reason} Choose another model for echo.`]);
    await removeFallback(deps(), ana, { agent: 'echo' });
    await unassignAgent(deps(), ana, { agent: 'echo' });
    await insertChoice(s.db, { agent: 'echo' }, SIMULATED, 'human:ana');
  });

  it('a translation whose engine can’t be reached is made by the backup, which the translation names', async () => {
    const s = environment().services;
    const thread = (await cmd('exploration.open', { purpose: 'Reading it in Spanish' })).entityId;
    await insertChoice(s.db, { agent: 'translator' }, QWEN, 'human:ana');
    const translate = (text: string) =>
      translateFields(s, { projectId, subject: 'exploration', id: thread, lang: 'es', source: { purpose: text } });

    expect(await rejection(translate('A reading app.'))).toMatchObject({
      type: 'conflict',
      message: `The translation failed: ${UNREACHABLE}`,
    });

    await setFallback(deps(), ana, { agent: 'translator', ...SIMULATED });
    const t = await translate('A reading app.');
    expect(t.by).toBe('simulated/simulated');
    expect(t.fields.purpose).toBe('[es] A reading app.');
    await insertChoice(s.db, { agent: 'translator' }, SIMULATED, 'human:ana');
    await removeFallback(deps(), ana, { agent: 'translator' });
  });
});
