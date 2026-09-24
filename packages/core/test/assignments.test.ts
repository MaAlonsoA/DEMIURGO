// Workspace settings of models and providers (FDR-AGE-002): the discovered catalog, the agents'
// assignments (global and per project), how a run resolves its engine, and the record of every
// provider call with its events.

import {
  type Actor,
  type ProviderCatalog,
  type ProviderEvent,
  type ProviderId,
  type Provider,
  externalAgent,
  human,
  system,
  agentRun,
  isDomainError,
} from '@demiurgo/domain';
import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';
import { createSimulatedProvider } from '../src/agents/simulated.ts';
import {
  assignAgent,
  callProvider,
  currentAssignments,
  currentCatalogs,
  previousSession,
  refreshCatalogs,
  resolutionProblem,
  resolveEngine,
  saveSession,
  sessionDirectory,
  sessionKey,
  unassignAgent,
} from '../src/assignments/index.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { createProviderRegistry } from '../src/providers/registry.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment({ seedAssignments: false });
const ana = human('ana');

function fakeProvider(id: ProviderId, models: ProviderCatalog['models'], fail = false): Provider {
  return {
    id,
    label: id === 'codex' ? 'Codex' : 'Claude',
    sessions: true,
    async discover() {
      if (fail) throw new Error('spawn failed');
      return {
        provider: id,
        label: id === 'codex' ? 'Codex' : 'Claude',
        installed: true,
        version: '1.0',
        ready: true,
        message: null,
        sessions: true,
        models,
      };
    },
    async run() {
      throw new Error('not used');
    },
  };
}

const SOL = { id: 'gpt-6-sol', label: 'GPT-6-Sol', efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' };
const LUNA = { id: 'gpt-6-luna', label: 'GPT-6-Luna', efforts: ['low', 'medium'], defaultEffort: 'medium' };

let projectId = '';
let otherProjectId = '';
let deps: { db: ReturnType<typeof environment>['services']['db']; providers: ReturnType<typeof createProviderRegistry> };

async function expectError(p: Promise<unknown>, type: string): Promise<string[]> {
  const e: unknown = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toMatchObject({ type });
  return isDomainError(e) ? [e.message, ...e.reasons] : [];
}

beforeAll(async () => {
  const s = environment().services;
  projectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Models' } })).projectId;
  otherProjectId = (await executeCommand(s, { command: 'project.create', actor: ana, data: { name: 'Other' } })).projectId;
  deps = {
    db: s.db,
    providers: createProviderRegistry([
      fakeProvider('codex', [SOL, LUNA]),
      fakeProvider('claude', [], true),
      createSimulatedProvider(),
    ]),
  };
  await refreshCatalogs(deps, ana);
});

describe('provider catalog', () => {
  it('AC-AGE-002-01 refreshing stores one dated row per provider; a failing discovery is stored as not installed', async () => {
    const catalogs = await currentCatalogs(deps.db);
    expect(catalogs.map((c) => c.provider).toSorted()).toEqual(['claude', 'codex', 'simulated']);
    expect(catalogs.find((c) => c.provider === 'codex')).toMatchObject({
      ready: true,
      models: [SOL, LUNA],
      discoveredAt: expect.any(String),
    });
    expect(catalogs.find((c) => c.provider === 'claude')).toMatchObject({
      installed: false,
      ready: false,
      message: expect.stringContaining('spawn failed'),
    });
    const before = (await sql<{ n: number }>`select count(*)::int as n from provider_catalogs`.execute(deps.db)).rows[0]?.n ?? 0;
    await refreshCatalogs(deps, system('providers'));
    const after = (await sql<{ n: number }>`select count(*)::int as n from provider_catalogs`.execute(deps.db)).rows[0]?.n ?? 0;
    expect(after).toBe(before + 3);
    expect(await currentCatalogs(deps.db)).toHaveLength(3);
  });

  it('AC-AGE-002-02 only a person or the system refreshes', async () => {
    for (const actor of [externalAgent('bot', 's'), agentRun('00000000-0000-7000-8000-000000000001')] satisfies Actor[]) {
      await expect(refreshCatalogs(deps, actor)).rejects.toMatchObject({ type: 'forbidden' });
    }
  });
});

describe('assignments', () => {
  it('AC-AGE-002-02 only a person assigns or removes an engine', async () => {
    const engine = { agent: 'onboarding', scope: 'global' as const, provider: 'codex', model: 'gpt-6-sol', effort: 'high' };
    for (const actor of [
      externalAgent('bot', 's'),
      agentRun('00000000-0000-7000-8000-000000000001'),
      system('x'),
    ] satisfies Actor[]) {
      await expectError(assignAgent(deps, actor, engine), 'forbidden');
      await expectError(unassignAgent(deps, actor, { agent: 'onboarding', scope: 'global' }), 'forbidden');
    }
    expect(await currentAssignments(deps.db)).toEqual([]);
  });

  it('AC-AGE-002-02 a model or effort outside the catalog, an unknown agent or a project scope without project are rejected', async () => {
    const base = { agent: 'onboarding', scope: 'global' as const, provider: 'codex', model: 'gpt-6-sol', effort: 'high' };
    expect((await expectError(assignAgent(deps, ana, { ...base, model: 'gpt-9' }), 'validation')).join(' ')).toMatch(
      /gpt-9 isn't offered by Codex.*gpt-6-sol, gpt-6-luna/,
    );
    expect((await expectError(assignAgent(deps, ana, { ...base, effort: 'ultra' }), 'validation')).join(' ')).toMatch(
      /ultra is not an effort of gpt-6-sol.*low, medium, high/,
    );
    await expectError(assignAgent(deps, ana, { ...base, effort: null }), 'validation');
    await expectError(assignAgent(deps, ana, { ...base, provider: 'opencode' }), 'validation');
    await expectError(assignAgent(deps, ana, { ...base, agent: 'nobody' }), 'validation');
    await expectError(assignAgent(deps, ana, { ...base, scope: 'project' }), 'validation');
    await expectError(
      assignAgent(deps, ana, { ...base, scope: 'project', projectId: '00000000-0000-7000-8000-000000000999' }),
      'not_found',
    );
    // A model without efforts takes none.
    await assignAgent(deps, ana, { agent: 'echo', scope: 'global', provider: 'simulated', model: 'simulated', effort: null });
    await expectError(
      assignAgent(deps, ana, { agent: 'echo', scope: 'global', provider: 'simulated', model: 'simulated', effort: 'high' }),
      'validation',
    );
  });

  it('AC-AGE-002-03 resolution: override, then project, then global; none names the agent', async () => {
    expect(await resolveEngine(deps.db, deps.providers, { projectId, agent: 'onboarding' })).toEqual({ status: 'unassigned' });
    expect(resolutionProblem('onboarding', { status: 'unassigned' })).toBe(
      'Choose a model for onboarding in Settings → Models & providers.',
    );

    await assignAgent(deps, ana, { agent: 'onboarding', scope: 'global', provider: 'codex', model: 'gpt-6-luna', effort: 'low' });
    expect(await resolveEngine(deps.db, deps.providers, { projectId, agent: 'onboarding' })).toEqual({
      status: 'ok',
      source: 'global',
      provider: 'codex',
      model: 'gpt-6-luna',
      effort: 'low',
    });
    await assignAgent(deps, ana, {
      agent: 'onboarding',
      scope: 'project',
      projectId,
      provider: 'codex',
      model: 'gpt-6-sol',
      effort: 'high',
    });
    expect(await resolveEngine(deps.db, deps.providers, { projectId, agent: 'onboarding' })).toMatchObject({
      source: 'project',
      model: 'gpt-6-sol',
    });
    expect(await resolveEngine(deps.db, deps.providers, { projectId: otherProjectId, agent: 'onboarding' })).toMatchObject({
      source: 'global',
    });
    const override = { provider: 'simulated', model: 'simulated', effort: null };
    expect(await resolveEngine(deps.db, deps.providers, { projectId, agent: 'onboarding', override })).toMatchObject({
      status: 'ok',
      source: 'override',
      provider: 'simulated',
    });
    expect(
      resolutionProblem('onboarding', await resolveEngine(deps.db, deps.providers, { projectId, agent: 'onboarding' })),
    ).toBeNull();

    await unassignAgent(deps, ana, { agent: 'onboarding', scope: 'project', projectId });
    expect(await resolveEngine(deps.db, deps.providers, { projectId, agent: 'onboarding' })).toMatchObject({ source: 'global' });
    const current = await currentAssignments(deps.db, projectId);
    expect(current.filter((a) => a.agent === 'onboarding')).toEqual([
      expect.objectContaining({
        scope: 'global',
        engine: { provider: 'codex', model: 'gpt-6-luna', effort: 'low' },
        assignedBy: 'human:ana',
      }),
    ]);
  });

  it('AC-AGE-002-08 a model that disappears from the catalog leaves the assignment unavailable, never switched', async () => {
    await assignAgent(deps, ana, { agent: 'designer', scope: 'global', provider: 'codex', model: 'gpt-6-sol', effort: 'medium' });
    const shrunk = createProviderRegistry([fakeProvider('codex', [LUNA]), createSimulatedProvider()]);
    await refreshCatalogs({ db: deps.db, providers: shrunk }, ana);
    const r = await resolveEngine(deps.db, shrunk, { projectId, agent: 'designer' });
    expect(r).toMatchObject({ status: 'unavailable', provider: 'codex', model: 'gpt-6-sol' });
    expect(resolutionProblem('designer', r)).toBe('gpt-6-sol is no longer offered by Codex. Choose another model for designer.');
    expect((await currentAssignments(deps.db)).find((a) => a.agent === 'designer')?.engine.model).toBe('gpt-6-sol');
    // Back in the catalog: available again.
    await refreshCatalogs(deps, ana);
    expect(await resolveEngine(deps.db, deps.providers, { projectId, agent: 'designer' })).toMatchObject({ status: 'ok' });
  });

  it('AC-AGE-002-08 a provider this process does not run is unavailable', async () => {
    await assignAgent(deps, ana, { agent: 'explorer', scope: 'global', provider: 'simulated', model: 'simulated', effort: null });
    const withoutSimulated = createProviderRegistry([fakeProvider('codex', [SOL])]);
    const r = await resolveEngine(deps.db, withoutSimulated, { projectId, agent: 'explorer' });
    expect(resolutionProblem('explorer', r)).toBe("Simulated isn't available here. Choose another model for explorer.");
  });
});

describe('provider calls', () => {
  it('AC-AGE-002-10 a call is recorded with its events in order and its outcome', async () => {
    const seen: ProviderEvent[] = [];
    const r = await callProvider(
      deps.db,
      createSimulatedProvider(),
      { projectId, runId: null, agent: 'echo', agentVersion: 'abc', promptHash: 'h' },
      {
        system: 's',
        input: 'hello',
        schema: {},
        model: 'simulated',
        effort: null,
        session: { mode: 'none' },
        timeMs: 5000,
        task: { action: 'echo', context: { hash: 'x', content: { input: { text: 'hi' } } } },
        onEvent: (e) => seen.push(e),
      },
    );
    expect(r.state).toBe('ok');
    const call = await deps.db
      .selectFrom('agent_calls')
      .selectAll()
      .where('project_id', '=', projectId)
      .executeTakeFirstOrThrow();
    expect(call).toMatchObject({
      state: 'ok',
      provider: 'simulated',
      requested_model: 'simulated',
      observed_model: 'simulated',
      session_mode: 'none',
      agent: 'echo',
    });
    expect(call.finished_at).not.toBeNull();
    expect(call.usage).toMatchObject({ inputTokens: 5 });
    const events = await deps.db
      .selectFrom('agent_call_events')
      .selectAll()
      .where('call_id', '=', call.id)
      .orderBy('seq')
      .execute();
    expect(events.map((e) => [e.seq, e.kind])).toEqual([
      [1, 'started'],
      [2, 'message'],
      [3, 'result'],
    ]);
    expect(events.every((e) => e.project_id === projectId)).toBe(true);
    expect(seen.map((e) => e.kind)).toEqual(['started', 'message', 'result']);
  });

  it('a provider that throws is recorded as an infra failure', async () => {
    const broken = { ...createSimulatedProvider(), run: async () => Promise.reject(new Error('boom')) } satisfies Provider;
    const r = await callProvider(
      deps.db,
      broken,
      { projectId, runId: null, agent: 'echo', agentVersion: 'abc', promptHash: 'h' },
      { system: 's', input: 'i', schema: {}, model: 'simulated', effort: null, session: { mode: 'none' }, timeMs: 5000 },
    );
    expect(r).toMatchObject({ state: 'error', failureKind: 'infra', message: expect.stringContaining('boom') });
    const call = await deps.db.selectFrom('agent_calls').selectAll().where('state', '=', 'error').executeTakeFirstOrThrow();
    expect(call.failure_kind).toBe('infra');
  });
});

describe('provider sessions', () => {
  it('AC-AGE-002-09 the conversation key joins scope, agent@version, provider and model; its folder is stable', () => {
    const k = sessionKey({
      scope: { type: 'exploration', id: 'e1' },
      agent: 'explorer',
      version: 'v1',
      provider: 'codex',
      model: 'gpt-6-sol',
    });
    expect(k).toBe(
      sessionKey({
        scope: { id: 'e1', type: 'exploration' },
        agent: 'explorer',
        version: 'v1',
        provider: 'codex',
        model: 'gpt-6-sol',
      }),
    );
    expect(k).not.toBe(
      sessionKey({
        scope: { type: 'exploration', id: 'e1' },
        agent: 'explorer',
        version: 'v2',
        provider: 'codex',
        model: 'gpt-6-sol',
      }),
    );
    expect(sessionDirectory('/base', 'codex', k)).toBe(sessionDirectory('/base', 'codex', k));
    expect(sessionDirectory('/base', 'codex', k)).toMatch(/codex[\\/][0-9a-f]{16}$/);
  });

  it('AC-AGE-002-09 saving a session replaces the previous one for its key', async () => {
    const s = environment().services;
    const run = await executeCommand(s, {
      command: 'run.request',
      actor: ana,
      projectId,
      data: { action: 'echo', scope: { type: 'echo' }, input: { text: 'x' } },
    });
    const key = 'k-1';
    expect(await previousSession(deps.db, key)).toBeNull();
    await deps.db
      .transaction()
      .execute((trx) =>
        saveSession(trx, { key, projectId, provider: 'simulated', providerSessionId: 'sim-1', runId: run.entityId }),
      );
    await deps.db
      .transaction()
      .execute((trx) =>
        saveSession(trx, { key, projectId, provider: 'simulated', providerSessionId: 'sim-2', runId: run.entityId }),
      );
    expect(await previousSession(deps.db, key)).toEqual({ providerSessionId: 'sim-2', lastRunId: run.entityId });
  });
});
