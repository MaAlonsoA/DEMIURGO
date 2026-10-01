// Jev's reranking of the code map's candidates (classifier/code-rerank.ts) with a fake client: the request,
// the hybrid order, the opinions, and the deterministic fallback. No real call.

import { afterEach, describe, expect, it } from 'vitest';
import type { TypeSafeClient } from '@typesafe-ai/sdk';
import type { CodeFile, RankedFile } from '../src/build/code-map.ts';
import { DETERMINISTIC_ID, RERANK_CANDIDATES, buildRerankRequest, hybridOrder, rerankCodeMap } from '../src/classifier/code-rerank.ts';

const saved = process.env.TYPESAFE_API_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = saved;
});

const task = { title: 'Edit a meal', goal: 'Let people edit a meal', scope: '', acceptance_criteria: ['Given a meal, when saved, then it shows'] };
const ranked = (path: string, score: number): RankedFile => {
  const file: CodeFile = { path, kind: 'lib', modules: [], symbols: [], imports: [] };
  return { file, score, symbols: [{ name: 'f', kind: 'function', exported: true, signature: 'f(a: string)' }] };
};
const candidates = [ranked('a.ts', 1), ranked('b.ts', 0.8), ranked('c.ts', 0.2)];

const fake = (answers: Record<string, { noul: number }>, seen: unknown[] = []) =>
  ({ systemOne: async (req: unknown) => (seen.push(req), { answers, model: 'jev-test', usage: { input_tokens: 1000, output_tokens: 0 } }) }) as unknown as Pick<TypeSafeClient, 'systemOne'>;

describe('Jev code rerank', () => {
  it('asks one Noul per candidate with the task and the candidates as the state', () => {
    const { state, questions } = buildRerankRequest(candidates, task);
    expect(state.task).toBe(task);
    expect(state.candidates.map((c) => c.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
    expect(state.candidates[0]!.symbols).toEqual(['f(a: string)']);
    expect(Object.keys(questions)).toEqual(['c0', 'c1', 'c2']);
  });

  it('mixes the normalized deterministic score and Jev 0.1 / 0.9, keeping ties in the deterministic order', () => {
    expect(hybridOrder(candidates, null).map((r) => r.file.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
    const order = hybridOrder(candidates, new Map([['a.ts', 0.1], ['b.ts', 0.1], ['c.ts', 1]])).map((r) => r.file.path);
    // a: 0.1 + 0.09, b: 0.08 + 0.09, c: 0.02 + 0.9
    expect(order).toEqual(['c.ts', 'a.ts', 'b.ts']);
  });

  it('reorders by the hybrid and returns one opinion per candidate with its final rank', async () => {
    const seen: unknown[] = [];
    const out = await rerankCodeMap(candidates, task, { client: fake({ c0: { noul: 0.1 }, c1: { noul: 0.1 }, c2: { noul: 1 } }, seen) });
    expect(out.ranked.map((r) => r.file.path)).toEqual(['c.ts', 'a.ts', 'b.ts']);
    expect(out.opinions).toEqual([
      { path: 'c.ts', deterministic_score: 0.2, jev_p: 1, rank: 1 },
      { path: 'a.ts', deterministic_score: 1, jev_p: 0.1, rank: 2 },
      { path: 'b.ts', deterministic_score: 0.8, jev_p: 0.1, rank: 3 },
    ]);
    expect(out.classifier_id).toBe('jev@jev-latest');
    expect(out.input_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(seen).toHaveLength(1);
  });

  it('sends only the top candidates', async () => {
    const many = Array.from({ length: RERANK_CANDIDATES + 5 }, (_, i) => ranked(`f${i}.ts`, 1 - i / 100));
    const out = await rerankCodeMap(many, task, { client: fake({}) });
    expect(out.opinions).toHaveLength(RERANK_CANDIDATES);
  });

  it('keeps the deterministic order without a key, without a task, on an error and on an empty answer', async () => {
    delete process.env.TYPESAFE_API_KEY;
    for (const out of [
      await rerankCodeMap(candidates, task),
      await rerankCodeMap(candidates, null, { client: fake({ c0: { noul: 1 } }) }),
      await rerankCodeMap(candidates, task, { client: { systemOne: async () => Promise.reject(new Error('boom')) } as unknown as Pick<TypeSafeClient, 'systemOne'> }),
      await rerankCodeMap(candidates, task, { client: fake({}) }),
    ]) {
      expect(out.ranked.map((r) => r.file.path)).toEqual(['a.ts', 'b.ts', 'c.ts']);
      expect(out.classifier_id).toBe(DETERMINISTIC_ID);
      expect(out.opinions.map((o) => [o.rank, o.jev_p])).toEqual([[1, null], [2, null], [3, null]]);
      expect(out.input_hash).toBeNull();
    }
    expect((await rerankCodeMap([], task, { client: fake({}) })).opinions).toEqual([]);
  });
});
