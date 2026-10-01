// Jev's judgement of existing tests to reuse (classifier/test-reuse.ts) with a fake client. No real call.

import { afterEach, describe, expect, it } from 'vitest';
import type { TypeSafeClient } from '@typesafe-ai/sdk';
import { REUSE_MIN_P, REUSE_PER_CRITERION, buildReuseRequest, judgeTestReuse, preselect, reuseLines } from '../src/classifier/test-reuse.ts';

const saved = process.env.TYPESAFE_API_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = saved;
});

const tests = [
  { path: 'e2e/meals.spec.ts', title: 'AC-MEA-001-01 a meal can be edited and saved', level: 'e2e' },
  { path: 'e2e/shopping.spec.ts', title: 'AC-SHO-001-01 shopping list groups items by aisle', level: 'e2e' },
  { path: 'src/login.test.ts', title: 'AC-LOG-001-01 login rejects a wrong password', level: 'unit' },
];
const criteria = [{ code: 'AC-MEA-002-01', statement: 'Given a saved meal, when the person edits its name, then the new name shows' }];

const fake = (answers: Record<string, { noul: number }>, seen: unknown[] = []) =>
  ({ systemOne: async (req: unknown) => (seen.push(req), { answers, model: 'jev-test', usage: { input_tokens: 1000, output_tokens: 0 } }) }) as unknown as Pick<TypeSafeClient, 'systemOne'>;

describe('Jev test reuse', () => {
  it('preselects by word overlap and drops tests with no shared word', () => {
    expect(preselect(criteria[0]!.statement, tests, 10).map((t) => t.path)).toEqual(['e2e/meals.spec.ts']);
  });

  it('asks one Noul per (criterion, candidate) pair, at most the cap per criterion', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ path: `t${i}.test.ts`, title: `AC-X-001-0${i % 9} meal edit ${i}`, level: 'unit' }));
    const { questions, pairs } = buildReuseRequest(criteria, many);
    expect(pairs).toHaveLength(REUSE_PER_CRITERION);
    expect(Object.keys(questions)).toHaveLength(REUSE_PER_CRITERION);
  });

  it('returns the pairs at or above the threshold, best first, in one request', async () => {
    const seen: unknown[] = [];
    const { pairs } = buildReuseRequest(criteria, tests);
    const out = await judgeTestReuse(fake({ [pairs[0]!.qid]: { noul: 0.82 } }, seen), { criteria, candidates: tests });
    expect(out).toEqual([{ criterion: 'AC-MEA-002-01', path: 'e2e/meals.spec.ts', title: tests[0]!.title, level: 'e2e', p: 0.82 }]);
    expect(seen).toHaveLength(1);
    const low = await judgeTestReuse(fake({ [pairs[0]!.qid]: { noul: REUSE_MIN_P - 0.01 } }), { criteria, candidates: tests });
    expect(low).toEqual([]);
  });

  it('returns nothing without a key and never throws', async () => {
    delete process.env.TYPESAFE_API_KEY;
    expect(await judgeTestReuse(null, { criteria, candidates: tests })).toEqual([]);
    const boom = { systemOne: async () => { throw new Error('down'); } } as unknown as Pick<TypeSafeClient, 'systemOne'>;
    expect(await judgeTestReuse(boom, { criteria, candidates: tests })).toEqual([]);
  });

  it('writes the brief section with at most 8 lines', () => {
    expect(reuseLines([])).toEqual([]);
    const pairs = Array.from({ length: 10 }, (_, i) => ({ criterion: 'AC-A-001-01', path: 'p.ts', title: `t${i}`, level: 'unit', p: 0.8 }));
    const lines = reuseLines(pairs);
    expect(lines).toHaveLength(9);
    expect(lines[1]).toBe('- AC-A-001-01 ↔ p.ts › t0 (p 0.80)');
  });
});
