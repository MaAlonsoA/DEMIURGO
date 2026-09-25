// Workspace settings of models and providers (FDR-AGE-002): the discovered catalog, the engine of
// each group of agents and each agent's own as an exception, how a run resolves its engine, and the
// record of every provider call with its events.

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

function fakeProvider(id: ProviderId, models: ProviderCatalog['models'], fail = false, listed = true): Provider {
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
        ...(listed ? {} : { listed: false }),
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
  it('AC-AGE-002-02 only a person assigns or removes an engine, of a group or of an agent', async () => {
    const engine = { provider: 'codex', model: 'gpt-6-sol', effort: 'high' };
    for (const actor of [
      externalAgent('bot', 's'),
      agentRun('00000000-0000-7000-8000-000000000001'),
      system('x'),
    ] satisfies Actor[]) {
      await expectError(assignAgent(deps, actor, { agent: 'onboarding', ...engine }), 'forbidden');
      await expectError(assignAgent(deps, actor, { group: 'deep', ...engine }), 'forbidden');
      await expectError(unassignAgent(deps, actor, { agent: 'onboarding' }), 'forbidden');
      await expectError(unassignAgent(deps, actor, { group: 'deep' }), 'forbidden');
    }
    expect(await currentAssignments(deps.db)).toEqual({ agents: {}, groups: {} });
  });

  it('AC-AGE-002-02 a model or effort outside the catalog, an unknown agent or an unknown group are rejected', async () => {
    const base = { agent: 'onboarding', provider: 'codex', model: 'gpt-6-sol', effort: 'high' };
    expect((await expectError(assignAgent(deps, ana, { ...base, model: 'gpt-9' }), 'validation')).join(' ')).toMatch(
      /gpt-9 isn't offered by Codex.*gpt-6-sol, gpt-6-luna/,
    );
    expect((await expectError(assignAgent(deps, ana, { ...base, effort: 'ultra' }), 'validation')).join(' ')).toMatch(
      /ultra is not an effort of gpt-6-sol.*low, medium, high/,
    );
    await expectError(assignAgent(deps, ana, { ...base, effort: null }), 'validation');
    await expectError(assignAgent(deps, ana, { ...base, provider: 'opencode' }), 'validation');
    await expectError(assignAgent(deps, ana, { ...base, agent: 'nobody' }), 'validation');
    expect(
      (
        await expectError(
          assignAgent(deps, ana, { group: 'nobody', provider: 'codex', model: 'gpt-6-sol', effort: 'high' }),
          'validation',
        )
      ).join(' '),
    ).toMatch(/There is no group "nobody".*deep, quick/);
    // A model without efforts takes none.
    await assignAgent(deps, ana, { agent: 'echo', provider: 'simulated', model: 'simulated', effort: null });
    await expectError(
      assignAgent(deps, ana, { agent: 'echo', provider: 'simulated', model: 'simulated', effort: 'high' }),
      'validation',
    );
  });

  it("AC-AGE-002-03 resolution: override, then the agent's own engine, then its group's; none names the agent", async () => {
    expect(await resolveEngine(deps.db, deps.providers, { agent: 'onboarding' })).toEqual({ status: 'unassigned' });
    expect(resolutionProblem('onboarding', { status: 'unassigned' })).toBe(
      'Choose a model for onboarding in Models & providers.',
    );

    // The group's engine runs every agent of the group (onboarding and explorer are Deep thinking).
    await assignAgent(deps, ana, { group: 'deep', provider: 'codex', model: 'gpt-6-luna', effort: 'low' });
    for (const agent of ['onboarding', 'explorer']) {
      expect(await resolveEngine(deps.db, deps.providers, { agent })).toEqual({
        status: 'ok',
        source: 'group',
        provider: 'codex',
        model: 'gpt-6-luna',
        effort: 'low',
      });
    }
    // An agent of another group doesn't follow it.
    expect(await resolveEngine(deps.db, deps.providers, { agent: 'knowledge_classifier' })).toEqual({ status: 'unassigned' });

    // The agent's own engine is an exception to its group.
    await assignAgent(deps, ana, { agent: 'onboarding', provider: 'codex', model: 'gpt-6-sol', effort: 'high' });
    expect(await resolveEngine(deps.db, deps.providers, { agent: 'onboarding' })).toMatchObject({
      source: 'agent',
      model: 'gpt-6-sol',
    });
    expect(await resolveEngine(deps.db, deps.providers, { agent: 'explorer' })).toMatchObject({ source: 'group' });
    const override = { provider: 'simulated', model: 'simulated', effort: null };
    expect(await resolveEngine(deps.db, deps.providers, { agent: 'onboarding', override })).toMatchObject({
      status: 'ok',
      source: 'override',
      provider: 'simulated',
    });

    // Removing the exception, the agent follows its group again.
    await unassignAgent(deps, ana, { agent: 'onboarding' });
    expect(await resolveEngine(deps.db, deps.providers, { agent: 'onboarding' })).toMatchObject({ source: 'group' });
    const current = await currentAssignments(deps.db);
    expect(current.agents.onboarding).toBeUndefined();
    expect(current.groups.deep).toEqual(
      expect.objectContaining({ engine: { provider: 'codex', model: 'gpt-6-luna', effort: 'low' }, assignedBy: 'human:ana' }),
    );

    // Project assignments from before the groups are kept but no longer read.
    await sql`insert into agent_assignments (scope, project_id, agent, provider, model, effort, assigned_by)
      values ('project', ${projectId}::uuid, 'onboarding', 'simulated', 'simulated', null, 'human:ana')`.execute(deps.db);
    expect(await resolveEngine(deps.db, deps.providers, { agent: 'onboarding' })).toMatchObject({ source: 'group' });

    // Removing the group's engine leaves its agents without one.
    await unassignAgent(deps, ana, { group: 'deep' });
    expect(await resolveEngine(deps.db, deps.providers, { agent: 'explorer' })).toEqual({ status: 'unassigned' });
  });

  it('AC-AGE-002-08 a model that disappears from the catalog leaves the assignment unavailable, never switched', async () => {
    await assignAgent(deps, ana, { agent: 'designer', provider: 'codex', model: 'gpt-6-sol', effort: 'medium' });
    const shrunk = createProviderRegistry([fakeProvider('codex', [LUNA]), createSimulatedProvider()]);
    await refreshCatalogs({ db: deps.db, providers: shrunk }, ana);
    const r = await resolveEngine(deps.db, shrunk, { agent: 'designer' });
    expect(r).toMatchObject({ status: 'unavailable', provider: 'codex', model: 'gpt-6-sol' });
    expect(resolutionProblem('designer', r)).toBe('gpt-6-sol is no longer offered by Codex. Choose another model for designer.');
    expect((await currentAssignments(deps.db)).agents.designer?.engine.model).toBe('gpt-6-sol');
    // Back in the catalog: available again.
    await refreshCatalogs(deps, ana);
    expect(await resolveEngine(deps.db, deps.providers, { agent: 'designer' })).toMatchObject({ status: 'ok' });
  });

  it('AC-AGE-002-08 a discovery that could not list the models keeps the last ones found, so the assignment still runs', async () => {
    await assignAgent(deps, ana, { agent: 'designer', provider: 'codex', model: 'gpt-6-sol', effort: 'medium' });
    const unlisted = createProviderRegistry([fakeProvider('codex', [], false, false), createSimulatedProvider()]);
    await refreshCatalogs({ db: deps.db, providers: unlisted }, ana);
    expect((await currentCatalogs(deps.db)).find((c) => c.provider === 'codex')).toMatchObject({
      models: [SOL, LUNA],
      message: expect.stringContaining("Couldn't list its models"),
    });
    expect(await resolveEngine(deps.db, unlisted, { agent: 'designer' })).toMatchObject({ status: 'ok' });
    // A discovery that throws keeps them too.
    const broken = createProviderRegistry([fakeProvider('codex', [SOL], true), createSimulatedProvider()]);
    await refreshCatalogs({ db: deps.db, providers: broken }, ana);
    expect((await currentCatalogs(deps.db)).find((c) => c.provider === 'codex')?.models).toEqual([SOL, LUNA]);
    await refreshCatalogs(deps, ana);
  });

  it('AC-AGE-002-08 a provider this process does not run is unavailable', async () => {
    await assignAgent(deps, ana, { agent: 'explorer', provider: 'simulated', model: 'simulated', effort: null });
    const withoutSimulated = createProviderRegistry([fakeProvider('codex', [SOL])]);
    const r = await resolveEngine(deps.db, withoutSimulated, { agent: 'explorer' });
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
