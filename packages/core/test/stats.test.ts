// Statistics and consumption of the engines, computed from the provider calls (FDR-AGE-002).

import { human } from '@demiurgo/domain';
import { beforeAll, describe, expect, it } from 'vitest';
import { consumption, providerStats } from '../src/assignments/stats.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { readConfig } from '../src/config.ts';
import { createProviders } from '../src/startup.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment({ seedAssignments: false });
const NOW = new Date('2026-09-25T15:00:00');
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

beforeAll(async () => {
  const s = environment().services;
  const projectId = (await executeCommand(s, { command: 'project.create', actor: human('ana'), data: { name: 'Usage' } }))
    .projectId;
  const call = (agent: string, provider: string, at: Date, input: number, output: number, cost?: number, failure?: string) => ({
    project_id: projectId,
    agent,
    agent_version: 'v',
    provider,
    requested_model: provider === 'codex' ? 'gpt-6-sol' : 'opus',
    effort: 'high',
    session_mode: 'none',
    prompt_hash: 'h',
    state: failure ? 'error' : 'ok',
    failure_kind: failure ?? null,
    usage: JSON.stringify({
      inputTokens: input,
      outputTokens: output,
      durationMs: 1000,
      ...(cost === undefined ? {} : { declaredCostUsd: cost }),
    }),
    started_at: at,
    finished_at: at,
  });
  await s.db
    .insertInto('agent_calls')
    .values([
      call('explorer', 'claude', hoursAgo(1), 1000, 200, 0.05),
      call('explorer', 'claude', hoursAgo(2), 500, 100, 0.02, 'timeout'),
      call('onboarding', 'codex', hoursAgo(3), 3000, 300),
      call('onboarding', 'codex', hoursAgo(72), 7000, 700),
      call('explorer', 'claude', hoursAgo(24 * 10), 90_000, 9_000, 1),
    ])
    .execute();
});

describe('consumption and statistics', () => {
  it("AC-AGE-002-12 today's and the week's consumption, per provider and per agent, add up their calls", async () => {
    const c = await consumption(environment().services.db, NOW);
    expect(c.today.byProvider).toEqual([
      { key: 'claude', calls: 2, inputTokens: 1500, outputTokens: 300, declaredCostUsd: 0.07 },
      { key: 'codex', calls: 1, inputTokens: 3000, outputTokens: 300, declaredCostUsd: 0 },
    ]);
    expect(c.week.byProvider.find((r) => r.key === 'codex')).toMatchObject({ calls: 2, inputTokens: 10_000, outputTokens: 1000 });
    expect(c.week.byProvider.find((r) => r.key === 'claude')).toMatchObject({ calls: 2, inputTokens: 1500 });
    expect(c.today.byAgent.map((r) => [r.key, r.calls])).toEqual([
      ['explorer', 2],
      ['onboarding', 1],
    ]);
  });

  it('AC-AGE-002-10 statistics per engine count calls and failures by kind, with averages', async () => {
    const stats = await providerStats(environment().services.db);
    expect(stats.find((r) => r.agent === 'explorer')).toMatchObject({
      provider: 'claude',
      model: 'opus',
      effort: 'high',
      calls: 3,
      failures: { timeout: 1 },
      avgDurationMs: 1000,
    });
    expect(stats.find((r) => r.agent === 'onboarding')?.avgTokens).toBe(5500);
  });

  it('AC-AGE-002-13 the simulated provider is only offered with the dev tools', () => {
    const base = { DEMIURGO_DATABASE_URL: 'postgres://x:y@127.0.0.1:5432/z' };
    expect(createProviders(readConfig(base)).get('simulated')).toBeUndefined();
    expect(
      createProviders(readConfig(base))
        .list()
        .map((p) => p.id),
    ).toEqual(['claude', 'codex', 'opencode']);
    expect(createProviders(readConfig({ ...base, DEMIURGO_DEV_TOOLS: '1' })).get('simulated')).toBeDefined();
  });
});
