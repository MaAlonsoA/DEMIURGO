import type { ProviderEvent, ProviderInvocation } from '@demiurgo/domain';
import { sql } from 'kysely';
import { describe, expect, it } from 'vitest';
import { createSimulatedProvider } from '../src/agents/simulated.ts';
import { createProviderRegistry } from '../src/providers/registry.ts';
import { lineSplitter } from '../src/providers/stream.ts';
import { useEnvironment } from './support/env.ts';

const invocation = (over: Partial<ProviderInvocation> = {}): ProviderInvocation => ({
  system: 'You echo.',
  input: 'Action: echo',
  schema: {},
  model: 'simulated',
  effort: null,
  session: { mode: 'none' },
  timeMs: 5000,
  task: { action: 'echo', context: { hash: 'h1', content: { input: { text: 'hello' } } } },
  ...over,
});

describe('simulated provider', () => {
  it('AC-AGE-002-01 discovers its single model without efforts', async () => {
    const catalog = await createSimulatedProvider().discover();
    expect(catalog).toMatchObject({
      provider: 'simulated',
      installed: true,
      ready: true,
      sessions: true,
      models: [{ id: 'simulated', efforts: [], defaultEffort: null }],
    });
  });

  it('AC-AGE-002-10 runs the task script and streams its events in order', async () => {
    const events: ProviderEvent[] = [];
    const r = await createSimulatedProvider().run(invocation({ onEvent: (e) => events.push(e) }));
    expect(r).toMatchObject({ state: 'ok', rawOutput: { reply: 'Echo: hello' }, provider: 'simulated', model: 'simulated' });
    expect(events.map((e) => e.kind)).toEqual(['started', 'message', 'result']);
  });

  it('AC-AGE-002-09 a fresh session gets an id and a resumed one keeps it', async () => {
    const p = createSimulatedProvider();
    const fresh = await p.run(invocation({ session: { mode: 'fresh', directory: 'x' } }));
    expect(fresh.sessionId).toMatch(/^sim-/);
    const resumed = await p.run(invocation({ session: { mode: 'resumed', directory: 'x', id: 'sim-abc' } }));
    expect(resumed.sessionId).toBe('sim-abc');
    expect((await p.run(invocation())).sessionId).toBeUndefined();
  });

  it('AC-AGE-002-07 a forced failure comes back as an error with its kind', async () => {
    const r = await createSimulatedProvider({ failure: { failureKind: 'infra', message: 'down' } }).run(invocation());
    expect(r).toMatchObject({ state: 'error', failureKind: 'infra', message: 'down' });
  });

  it('the registry finds providers by id', () => {
    const p = createSimulatedProvider();
    const registry = createProviderRegistry([p]);
    expect(registry.get('simulated')).toBe(p);
    expect(registry.get('codex')).toBeUndefined();
    expect(registry.list()).toEqual([p]);
  });
});

describe('line splitter', () => {
  it('AC-AGE-002-10 joins lines split across chunks and ignores empty lines', () => {
    const lines: string[] = [];
    const push = lineSplitter((l) => lines.push(l));
    push('{"a":');
    push('1}\r\n{"b"');
    push(':2}\n\n');
    push('{"c":3}');
    expect(lines).toEqual(['{"a":1}', '{"b":2}']);
    push('\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });
});

describe('agents migration', () => {
  const environment = useEnvironment();

  it('AC-AGE-002-02 assignments and catalogs are append-only', async () => {
    const { db } = environment().services;
    await sql`insert into agent_assignments (scope, agent, provider, model, effort, assigned_by)
      values ('global', 'echo', 'simulated', 'simulated', null, 'human:ana')`.execute(db);
    await expect(sql`update agent_assignments set model = 'x'`.execute(db)).rejects.toThrow(/append-only/);
    await expect(sql`delete from agent_assignments`.execute(db)).rejects.toThrow(/append-only/);
    await expect(
      sql`insert into agent_assignments (scope, agent, provider, model, assigned_by) values ('project', 'echo', 'simulated', 'simulated', 'human:ana')`.execute(
        db,
      ),
    ).rejects.toThrow(/check constraint/);
  });
});
