// Jev's triage of a pull request (classifier/review-triage.ts) with a fake client: the state shape, the
// threshold, the reading order and the no-key path. No real call.

import { afterEach, describe, expect, it } from 'vitest';
import type { TypeSafeClient } from '@typesafe-ai/sdk';
import { HINT_THRESHOLD, MAX_TRIAGE_FILES, buildTriageRequest, filesOfDiff, readingOrder, triageReview } from '../src/classifier/review-triage.ts';

const saved = process.env.TYPESAFE_API_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = saved;
});

const task = { title: 'Edit a meal', goal: 'Let people edit a meal', scope: '', acceptance_criteria: ['Given a meal, when saved, then it shows', 'Given a bad value, when saved, then it is rejected'] };
const diff = [
  'diff --git a/src/meals.ts b/src/meals.ts',
  'new file mode 100644',
  '--- /dev/null',
  '+++ b/src/meals.ts',
  '+export function saveMeal(m: Meal) {}',
  '+export const MealForm = () => null;',
  '+const hidden = 1;',
  'diff --git a/migrations/001.sql b/migrations/001.sql',
  'new file mode 100644',
  '+++ b/migrations/001.sql',
  '+CREATE TABLE workouts (id int);',
  'diff --git a/tests/meals.test.ts b/tests/meals.test.ts',
  '--- a/tests/meals.test.ts',
  '+++ b/tests/meals.test.ts',
  "+it('x', () => {});",
  "-it('y', () => {});",
  '',
].join('\n');

const fake = (answers: Record<string, { noul: number }>, seen: unknown[] = []) =>
  ({ systemOne: async (req: unknown) => (seen.push(req), { answers, model: 'jev-test', usage: { input_tokens: 1000, output_tokens: 0 } }) }) as unknown as Pick<TypeSafeClient, 'systemOne'>;

describe('Jev review triage', () => {
  it('reads files, status, added symbols and lines changed from the diff', () => {
    expect(filesOfDiff(diff)).toEqual([
      { path: 'src/meals.ts', status: 'added', added_symbols: ['saveMeal', 'MealForm'], lines_changed: 3 },
      { path: 'migrations/001.sql', status: 'added', added_symbols: ['workouts'], lines_changed: 1 },
      { path: 'tests/meals.test.ts', status: 'modified', added_symbols: [], lines_changed: 2 },
    ]);
  });

  it('builds the shared state and one Noul per file question and per criterion', () => {
    const files = filesOfDiff(diff);
    const { state, questions } = buildTriageRequest({ task, files, sample: ['lib/a.ts: f(x)'], projectStack: { ci: 'GitHub Actions' } });
    expect(Object.keys(state)).toEqual(['task', 'files', 'existing_symbols_sample', 'project_stack']);
    expect(Object.keys(questions)).toEqual(['f0_other', 'f0_dup', 'f0_auth', 'f1_other', 'f1_dup', 'f1_auth', 'f2_auth', 't0', 't1']);
  });

  it('caps the files sent to Jev', () => {
    const many = Array.from({ length: 60 }, (_, i) => `diff --git a/f${i}.ts b/f${i}.ts\n+x\n`).join('');
    const { state } = buildTriageRequest({ task, files: filesOfDiff(many), sample: [] });
    expect((state.files as unknown[]).length).toBe(MAX_TRIAGE_FILES);
  });

  it('keeps only answers at the threshold, inverts the tests question and sorts by probability', async () => {
    process.env.TYPESAFE_API_KEY = 'k';
    expect(HINT_THRESHOLD).toBe(0.5);
    const { hints, files } = await triageReview(
      { task, diff, sample: [] },
      { client: fake({ f1_other: { noul: 0.83 }, f0_dup: { noul: 0.49 }, f0_auth: { noul: 0.5 }, t0: { noul: 0.9 }, t1: { noul: 0.2 } }) },
    );
    expect(files).toHaveLength(3);
    expect(hints.map((h) => h.text)).toEqual([
      'Check: migrations/001.sql may create a piece (table, migration, endpoint or screen) of another feature (Jev 0.83)',
      'Check: the tests in the diff may not exercise criterion 2 (Given a bad value, when saved, then it is rejected) through its behavior (Jev 0.80)',
      'Check: src/meals.ts may touch authentication, sessions, secrets or access control (Jev 0.50)',
    ]);
    expect(readingOrder(files.map((f) => f.path), hints)).toEqual(['migrations/001.sql', 'src/meals.ts', 'tests/meals.test.ts']);
  });

  it('gives no hints without a key or on error, and never throws', async () => {
    delete process.env.TYPESAFE_API_KEY;
    const seen: unknown[] = [];
    expect((await triageReview({ task, diff, sample: [] })).hints).toEqual([]);
    expect(seen).toHaveLength(0);
    const failing = { systemOne: async () => Promise.reject(new Error('down')) } as unknown as Pick<TypeSafeClient, 'systemOne'>;
    expect((await triageReview({ task, diff, sample: [] }, { client: failing })).hints).toEqual([]);
  });
});
