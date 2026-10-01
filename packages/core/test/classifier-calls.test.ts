// The cost of Jev (salud-del-harness §6.4): one append-only row per request, idempotent by call key, best effort.

import { human } from '@demiurgo/domain';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeCommand } from '../src/bus/bus.ts';
import { recordClassifierCall, recordedCall } from '../src/classifier/calls.ts';
import { classifyTaskSize } from '../src/classifier/size.ts';
import { useEnvironment } from './support/env.ts';

const environment = useEnvironment();
afterEach(() => vi.unstubAllEnvs());

async function project(name: string): Promise<string> {
  const { projectId } = await executeCommand(environment().services, { command: 'project.create', actor: human('ana'), data: { name } });
  return projectId;
}
const rows = (projectId: string) => environment().services.db.selectFrom('classifier_calls').selectAll().where('project_id', '=', projectId).orderBy('created_at').execute();

describe('classifier_calls', () => {
  it('writes one row per call and nothing for the same call key twice', async () => {
    const s = environment().services;
    const projectId = await project('Calls');
    const call = { projectId, question: 'test_reuse', callKey: 'test_reuse:r1:1', inputTokens: 1000, outputTokens: 3, durationMs: 120.4, outcome: 'ok' as const };
    expect(await recordClassifierCall(s.db, call)).toBe(true);
    expect(await recordClassifierCall(s.db, call)).toBe(false);
    // Without a key every call is its own row.
    expect(await recordClassifierCall(s.db, { ...call, callKey: null })).toBe(true);
    expect(await recordClassifierCall(s.db, { ...call, callKey: null })).toBe(true);
    const all = await rows(projectId);
    expect(all).toHaveLength(3);
    expect(all[0]).toMatchObject({ question: 'test_reuse', input_tokens: 1000, output_tokens: 3, duration_ms: 120, outcome: 'ok', model: 'jev-latest' });
    expect(Number(all[0]!.cost_usd)).toBeCloseTo(0.000042, 8);
  });

  it('is append-only', async () => {
    const s = environment().services;
    const projectId = await project('Append');
    await recordClassifierCall(s.db, { projectId, question: 'size', inputTokens: 1, durationMs: 1, outcome: 'ok' });
    await expect(s.db.updateTable('classifier_calls').set({ input_tokens: 9 }).where('project_id', '=', projectId).execute()).rejects.toThrow(/only admits INSERT/);
    await expect(s.db.deleteFrom('classifier_calls').where('project_id', '=', projectId).execute()).rejects.toThrow(/only admits INSERT/);
  });

  it('never fails the judgment: a write that cannot happen is swallowed', async () => {
    const s = environment().services;
    // A project that does not exist breaks the foreign key.
    expect(await recordClassifierCall(s.db, { projectId: '00000000-0000-4000-8000-000000000000', question: 'size', inputTokens: 1, durationMs: 1, outcome: 'ok' })).toBe(false);
    const value = await recordedCall(s.db, { projectId: '00000000-0000-4000-8000-000000000000', question: 'size' }, async (note) => {
      note(5);
      return 'judged';
    });
    expect(value).toBe('judged');
  });

  it('recordedCall records usage, records an error and rethrows, and records nothing when no request was made', async () => {
    const s = environment().services;
    const projectId = await project('Wrapped');
    await recordedCall(s.db, { projectId, question: 'layers' }, async (note) => note(40, 2));
    await recordedCall(s.db, { projectId, question: 'layers' }, async () => 'no key, nothing asked');
    await expect(
      recordedCall(s.db, { projectId, question: 'testability' }, async (note) => {
        note(7);
        throw new Error('Jev: no answer');
      }),
    ).rejects.toThrow('Jev: no answer');
    const all = await rows(projectId);
    expect(all.map((r) => [r.question, r.input_tokens, r.output_tokens, r.outcome])).toEqual([
      ['layers', 40, 2, 'ok'],
      ['testability', 7, 0, 'error'],
    ]);
  });

  it('classifyTaskSize leaves its call, with the question version, next to the opinion', async () => {
    const s = environment().services;
    const projectId = await project('Size');
    const made = await executeCommand(s, {
      command: 'record.create',
      actor: human('ana'),
      projectId,
      data: {
        type: 'fdr',
        domain: 'cls',
        title: 'Feature',
        sections: [
          { title: 'Goal', content: 'g' },
          { title: 'Scope', content: 's' },
          { title: 'Out of scope', content: 'o' },
          { title: 'Behavior', content: '1. b' },
        ],
        criteria: [{ carry: 'new', title: 'One', statement: 'Given a, when b, then c.', verification: 'automatic', check: 'A test.' }],
      },
    });
    vi.stubEnv('TYPESAFE_API_KEY', 'test-key');
    const client = { systemOne: async () => ({ model: 'jev-test', usage: { input_tokens: 2000, output_tokens: 1 }, answers: { size: { score: 1.2, confidence: 0.8, probabilities: { '0': 0.1, '1': 0.7, '2': 0.2 } } } }) };
    await classifyTaskSize(s, projectId, made.entityId, (made.result as { versionId: string }).versionId, {
      client: client as never,
      load: async () => ({ task: { code: 'TSK-X', title: 'T' } as never, repo: null }),
    });
    const all = await rows(projectId);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ question: 'size', judgment_table: 'task_size_opinions', input_tokens: 2000, outcome: 'ok' });
    expect(all[0]!.question_version).toMatch(/^[0-9a-f]{12}$/);
    expect(all[0]!.duration_ms).not.toBeNull();
  });
});
