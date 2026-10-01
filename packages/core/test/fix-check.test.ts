// Jev's check of «LGTM with comments» fixes (classifier/fix-check.ts) with a fake client. No real call.

import { afterEach, describe, expect, it } from 'vitest';
import type { TypeSafeClient } from '@typesafe-ai/sdk';
import { FIX_MATCH_CONFIDENCE, FIX_MECHANICAL_THRESHOLD, buildFixCheckRequest, checkFixes, diffsByFile, fixCheckVerdict } from '../src/classifier/fix-check.ts';

const saved = process.env.TYPESAFE_API_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = saved;
});

const fixes = [
  { path: 'a.ts', line: 3, comment: 'Rename x to count', diff: 'diff --git a/a.ts b/a.ts\n-x\n+count' },
  { path: 'b.ts', line: null, comment: 'Remove the unused import', diff: 'diff --git a/b.ts b/b.ts\n-import z' },
];

type Answers = Record<string, { noul: number } | { choice: string; confidence: number }>;
const fake = (answers: Answers, seen: unknown[] = []) =>
  ({ systemOne: async (req: unknown) => (seen.push(req), { answers, model: 'jev-test', usage: { input_tokens: 1000, output_tokens: 0 } }) }) as unknown as Pick<TypeSafeClient, 'systemOne'>;

const good: Answers = {
  m0: { noul: 0.95 }, d0: { choice: 'exactly', confidence: 0.9 },
  m1: { noul: 0.9 }, d1: { choice: 'exactly', confidence: 0.85 },
};

describe('Jev fix check', () => {
  it('builds one shared state and a Noul and a Choice per fix', () => {
    const { state, questions } = buildFixCheckRequest(fixes);
    expect(Object.keys(state)).toEqual(['fixes']);
    expect(Object.keys(questions)).toEqual(['m0', 'd0', 'm1', 'd1']);
  });

  it('splits a diff by file', () => {
    const d = diffsByFile('diff --git a/a.ts b/a.ts\n+1\ndiff --git a/b.ts b/b.ts\n+2\n');
    expect(Object.keys(d)).toEqual(['a.ts', 'b.ts']);
    expect(d['b.ts']).toContain('+2');
  });

  it('waives when every fix is mechanical and exactly matched', async () => {
    const seen: unknown[] = [];
    const v = await checkFixes({ fixes, client: fake(good, seen) });
    expect(v).toMatchObject({ ok: true, failed: [], usage: { input_tokens: 1000 } });
    expect(seen).toHaveLength(1);
  });

  it('refuses when a diff does more than the comment asks', async () => {
    const v = await checkFixes({ fixes, client: fake({ ...good, d1: { choice: 'more', confidence: 0.95 } }) });
    expect(v?.ok).toBe(false);
    expect(v?.failed).toEqual(['fix_diff_mismatch:b.ts']);
  });

  it('refuses when the confidence is low', async () => {
    const v = await checkFixes({ fixes, client: fake({ ...good, d0: { choice: 'exactly', confidence: FIX_MATCH_CONFIDENCE - 0.01 } }) });
    expect(v?.failed).toEqual(['fix_diff_mismatch:a.ts']);
  });

  it('refuses when a comment is not clearly mechanical', async () => {
    const v = await checkFixes({ fixes, client: fake({ ...good, m0: { noul: FIX_MECHANICAL_THRESHOLD - 0.01 } }) });
    expect(v?.ok).toBe(false);
    expect(v?.failed).toEqual(['fix_not_mechanical:a.ts']);
  });

  it('treats a missing answer as not sure', () => {
    expect(fixCheckVerdict({ mechanical: [null], match: [null] }, ['a.ts']).failed).toEqual(['fix_not_mechanical:a.ts', 'fix_diff_mismatch:a.ts']);
  });

  it('returns null when the client throws', async () => {
    const client = { systemOne: async () => { throw new Error('boom'); } } as unknown as Pick<TypeSafeClient, 'systemOne'>;
    expect(await checkFixes({ fixes, client })).toBeNull();
  });

  it('returns null without a key', async () => {
    delete process.env.TYPESAFE_API_KEY;
    expect(await checkFixes({ fixes })).toBeNull();
  });
});
