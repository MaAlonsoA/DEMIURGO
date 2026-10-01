// pr_review action: a dedicated agent reviews the pull request of a build request against its task and
// the criteria the task covers. Its verdict is stored in `pr_reviews` and becomes DEMIURGO's required
// GitHub status `demiurgo/review` (GitHub does not let the author of a PR approve it). The checker
// gates the output before it is applied; publishing the status is not done here.

import { DomainError, system } from '@demiurgo/domain';
import { registerBuilder } from '../context/build.ts';
import { ManifestBuilder, inputSource } from '../context/manifest.ts';
import { registerApplier, registerChecker } from './appliers.ts';
import { packContentOf } from './drafting.ts';
import { taskCoversOf } from '../queries/sizes.ts';
import { jevAllowed } from '../classifier/aspect.ts';
import { loadRepoContext, projectRepoDir } from '../classifier/repo-context.ts';
import { existingSymbolsSample, readingOrder, triageReview } from '../classifier/review-triage.ts';
import type { TriageDeps } from '../classifier/review-triage.ts';
import { PREVIOUS_REVIEW_CHANGES_MAX, previousReviewInput, truncateChanges } from '../build/previous-review.ts';
import { loadTaskObject } from '../classifier/task-input.ts';

/** Tests replace Jev's client here; production leaves it unset. */
export const triageDeps: { current: TriageDeps } = { current: {} };

const BUILDER = 'pr_review@1';
export const PR_REVIEW_DIFF_MAX = 400_000;
const BUDGET = { brief: 20_000, task: 8_000, criteria: 12_000, diff: PR_REVIEW_DIFF_MAX };

type Ci = { conclusion: string | null; tests: { code: string; result: 'pass' | 'fail' }[]; flaky?: string[]; note?: string; parallel?: true };

const PARALLEL_NOTE = 'CI is running in parallel; its result is checked separately by DEMIURGO. Do not judge it.';

import { flakyNote } from '../build/flaky.ts';

function ciOf(value: unknown): Ci {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const tests = Array.isArray(v.tests) ? v.tests : [];
  if (v.parallel === true) return { conclusion: null, tests: [], parallel: true, note: PARALLEL_NOTE };
  const flaky = (Array.isArray(v.flaky) ? v.flaky : []).filter((c): c is string => typeof c === 'string');
  return {
    conclusion: typeof v.conclusion === 'string' ? v.conclusion : null,
    ...(flaky.length > 0 ? { flaky, note: flakyNote(flaky) } : {}),
    tests: tests
      .map((t) => (typeof t === 'object' && t !== null ? (t as Record<string, unknown>) : {}))
      .filter((t) => typeof t.code === 'string' && (t.result === 'pass' || t.result === 'fail'))
      .map((t) => ({ code: t.code as string, result: t.result as 'pass' | 'fail' })),
  };
}

export type TestCase = { name: string; file: string };
export type TestCounts = Record<string, { e2e: number; unit: number }>;

/** Playwright e2e by path: an `e2e/` folder (any depth). Everything else counts as unit/integration. */
export function isE2eFile(file: string): boolean {
  return /(^|\/)e2e\//i.test(file.replaceAll('\\', '/'));
}

/**
 * Per criterion code, how many tests start with that code, split by level. `ci.tests` only carries one
 * result per criterion (no names or files), so the orchestrator-built pack gets its tests from the diff
 * (see `testsInDiff`). Deterministic: a pointer for the reviewer, not a verdict.
 */
export function testCountsOf(criteria: { code: string }[], tests: TestCase[]): TestCounts {
  const out: TestCounts = {};
  for (const c of criteria) {
    const n = { e2e: 0, unit: 0 };
    out[c.code] = n;
    for (const t of tests) {
      if (!t.name.trimStart().startsWith(c.code)) continue;
      n[isE2eFile(t.file) ? 'e2e' : 'unit']++;
    }
  }
  return out;
}

/** The tests a unified diff adds: `test(`/`it(` titles on added lines, with the file they are in. */
export function testsInDiff(diff: string): TestCase[] {
  const out: TestCase[] = [];
  let file = '';
  for (const line of diff.split('\n')) {
    const f = /^\+\+\+ b\/(.+)$/.exec(line);
    if (f) {
      file = f[1] ?? '';
      continue;
    }
    if (!line.startsWith('+')) continue;
    const m = /\b(?:test|it)(?:\.\w+)*\(\s*(["'`])((?:\\.|(?!\1).)*)\1/.exec(line);
    if (m && file) out.push({ name: m[2] ?? '', file });
  }
  return out;
}

registerBuilder('pr_review', async ({ trx, projectId, scope, input, graphVersion }) => {
  const manifest = new ManifestBuilder(BUILDER, graphVersion, BUDGET);
  const request = await trx
    .selectFrom('build_requests')
    .select(['id', 'task_id', 'task_version_id', 'feature_version_id', 'brief'])
    .where('id', '=', scope.id ?? '')
    .where('project_id', '=', projectId)
    .executeTakeFirst();
  if (!request) throw new DomainError('not_found', 'The build request does not exist.');
  if (typeof input.diff !== 'string' || input.diff.length === 0) throw new DomainError('validation', 'A review needs the diff of the pull request.');
  if (typeof input.pr_url !== 'string' || input.pr_url.length === 0) throw new DomainError('validation', 'A review needs the URL of the pull request.');
  const task = await trx
    .selectFrom('record_versions')
    .innerJoin('records', 'records.id', 'record_versions.record_id')
    .select(['records.id as record_id', 'records.code', 'record_versions.id', 'record_versions.n', 'record_versions.title', 'record_versions.sections'])
    .where('record_versions.id', '=', request.task_version_id)
    .executeTakeFirstOrThrow();
  const sections = task.sections as { title: string; content: string }[];
  const taskContent = { code: task.code, version: task.n, title: task.title, sections };
  const codes = await taskCoversOf(trx, request.task_id);
  const criteria = request.feature_version_id && codes.length > 0
    ? await trx
        .selectFrom('criteria')
        .select(['code', 'title', 'given_text', 'when_text', 'then_text', 'statement', 'verification', 'check_text'])
        .where('record_version_id', '=', request.feature_version_id)
        .where('code', 'in', codes)
        .orderBy('position')
        .execute()
    : [];
  const criteriaContent = criteria.map((c) => ({
    code: c.code,
    title: c.title,
    given: c.given_text,
    when: c.when_text,
    then: c.then_text,
    ...(c.given_text ? {} : { statement: c.statement }),
    verification: c.verification,
    check: c.check_text,
  }));
  const diff = input.diff.length > PR_REVIEW_DIFF_MAX ? `${input.diff.slice(0, PR_REVIEW_DIFF_MAX)}\n[diff truncated: ${input.diff.length - PR_REVIEW_DIFF_MAX} more characters not shown]` : input.diff;
  const ci = ciOf(input.ci);
  // Incremental re-review: the earlier request_changes review and the changes since its head (ignored when malformed).
  const previousReview = previousReviewInput(input.previous_review);
  const sinceChanges = previousReview && typeof input.changes_since_previous_review === 'string' ? truncateChanges(input.changes_since_previous_review, PREVIOUS_REVIEW_CHANGES_MAX) : null;
  // What the builder was told about existing tests that already check something close (build step detail `test_reuse`).
  const reuseHints = await (async () => {
    try {
      const step = await trx
        .selectFrom('build_steps')
        .select('detail')
        .where('build_request_id', '=', request.id)
        .where('stage', '=', 'builder')
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .executeTakeFirst();
      const list = (step?.detail as { test_reuse?: { criterion: string; path: string; title: string; p: number }[] } | null | undefined)?.test_reuse;
      return Array.isArray(list) ? list.slice(0, 8) : [];
    } catch {
      return [];
    }
  })();
  const testCounts = testCountsOf(criteria, testsInDiff(input.diff));
  // Jev's triage: hints and a reading order, pointers only. Best effort: no key or any failure means none.
  let hints: string[] = [];
  let files: string[] = [];
  try {
    if (triageDeps.current.client || jevAllowed()) {
      const taskObject = await loadTaskObject(trx, task.record_id, task.id);
      if (taskObject) {
        const [dir, repo] = [await projectRepoDir(trx, projectId), await loadRepoContext(trx, projectId)];
        const sample = await existingSymbolsSample(dir, taskObject);
        const triaged = await triageReview({ task: taskObject, diff: input.diff, sample, projectStack: repo?.project_stack ?? null }, triageDeps.current);
        hints = triaged.hints.map((h) => h.text);
        files = readingOrder(triaged.files.map((f) => f.path), triaged.hints);
      }
    }
  } catch {
    hints = [];
    files = [];
  }
  manifest.entered({ section: 'brief', source: { type: 'build_request', id: request.id, version: null, eventSeq: null }, text: request.brief, reason: 'scope' });
  manifest.entered({
    section: 'task',
    source: { type: 'record_version', id: task.id, version: task.n, eventSeq: null },
    text: JSON.stringify(taskContent),
    reason: 'scope',
  });
  if (request.feature_version_id)
    manifest.entered({
      section: 'criteria',
      source: { type: 'record_version', id: request.feature_version_id, version: null, eventSeq: null },
      text: JSON.stringify(criteriaContent),
      reason: 'covered',
    });
  manifest.entered({
    section: 'diff',
    source: inputSource('diff'),
    text: diff,
    originalChars: input.diff.length,
    reason: input.diff.length > PR_REVIEW_DIFF_MAX ? `excerpt:${PR_REVIEW_DIFF_MAX}` : 'input',
  });
  if (hints.length > 0)
    manifest.entered({ section: 'hints', source: inputSource('hints'), text: JSON.stringify({ hints, files }), reason: 'triage' });
  if (criteria.length > 0)
    manifest.entered({ section: 'test_counts', source: inputSource('diff'), text: JSON.stringify(testCounts), reason: 'derived' });
  if (reuseHints.length > 0)
    manifest.entered({ section: 'reuse_hints', source: inputSource('build_steps'), text: JSON.stringify(reuseHints), reason: 'derived' });
  if (previousReview)
    manifest.entered({ section: 'previous_review', source: inputSource('previous_review'), text: JSON.stringify(previousReview), reason: 'input' });
  if (previousReview && sinceChanges !== null)
    manifest.entered({ section: 'changes_since_previous_review', source: inputSource('changes_since_previous_review'), text: sinceChanges, reason: 'input' });
  manifest.entered({ section: 'ci', source: inputSource('ci'), text: JSON.stringify(ci), reason: 'input' });
  return {
    pack: {
      role: 'review',
      constructor: BUILDER,
      budget: BUDGET,
      graph_version: graphVersion,
      dependencies: [{ type: 'record', id: request.task_id, version: task.n }],
      content: {
        build_request_id: request.id,
        pr_url: input.pr_url,
        brief: request.brief,
        task: taskContent,
        criteria: criteriaContent,
        ci,
        ...(criteria.length > 0 ? { test_counts: testCounts } : {}),
        ...(reuseHints.length > 0 ? { reuse_hints: reuseHints } : {}),
        ...(previousReview ? { previous_review: previousReview } : {}),
        ...(previousReview && sinceChanges !== null ? { changes_since_previous_review: sinceChanges } : {}),
        ...(hints.length > 0 ? { hints } : {}),
        ...(files.length > 0 && hints.length > 0 ? { files } : {}),
        diff,
      },
    },
    manifest: manifest.build(),
  };
});

type PackContent = {
  build_request_id: string;
  pr_url: string;
  criteria: { code: string; verification?: string }[];
  ci?: { parallel?: boolean; tests?: { code: string; result: string }[] };
};

registerChecker('pr_review', async ({ db, run, output }) => {
  const pack = await packContentOf<PackContent>(db, run);
  const codes = pack.criteria.map((c) => c.code);
  const notes: string[] = [];
  const listed = output.criteria.map((c) => c.code);
  const missing = codes.filter((c) => !listed.includes(c));
  const extra = listed.filter((c, i) => !codes.includes(c) || listed.indexOf(c) !== i);
  if (missing.length > 0) notes.push(`\`criteria\` must list ${missing.join(', ')}: it lists exactly the criteria the task covers.`);
  if (extra.length > 0) notes.push(`\`criteria\` lists ${extra.join(', ')}, which the task does not cover or which appear twice: exactly one entry per covered criterion.`);
  // `covered: true` on an automatic criterion needs a passing case for it in CI: a claim with no `pass` is not evidence.
  // With CI in parallel there is no result yet: the test existing is what the reviewer checks, and DEMIURGO gates on CI itself.
  const passing = new Set((pack.ci?.tests ?? []).filter((t) => t.result === 'pass').map((t) => t.code));
  const manual = new Set(pack.criteria.filter((c) => c.verification === 'manual' || c.verification === 'release').map((c) => c.code));
  for (const c of output.criteria)
    if (c.covered && codes.includes(c.code) && !manual.has(c.code) && !passing.has(c.code) && pack.ci?.parallel !== true)
      notes.push(`${c.code} is marked covered but CI has no passing test for it: mark it \`covered: false\` (not run) and say why.`);
  const blocking = output.comments.filter((c) => c.severity === 'blocking');
  if (output.verdict === 'approve') {
    if (blocking.length > 0) notes.push('An approval has no `blocking` comment: change the verdict to request_changes or downgrade the comment to `fix` (a minor change to make before merging, no new review) or a nit.');
    for (const c of output.criteria) {
      // A manual criterion is checked by a person after the merge, and a release one automatically against the
      // deployed candidate (its evidence is recorded on the feature): neither ever blocks an agent's pull request, covered or not.
      if (manual.has(c.code) && !c.covered) continue;
      if (!c.covered) notes.push(`${c.code} is not covered: an approval needs every automatic criterion covered.`);
      else if (!c.test_name || !c.test_name.startsWith(c.code))
        notes.push(`${c.code} is marked covered but its test title does not start with the code (our convention): \`test_name\` must start with ${c.code}.`);
    }
  } else if (blocking.length === 0) notes.push('request_changes needs at least one `blocking` comment that says what to change.');
  return notes;
});

registerApplier('pr_review', async ({ trx, execute, run, output }) => {
  const pack = await packContentOf<PackContent>(trx, run);
  await execute({
    projectId: run.project_id,
    command: 'pr_review.record',
    actor: system('pr-review', '1'),
    data: {
      build_request_id: pack.build_request_id,
      run_id: run.id,
      verdict: output.verdict,
      summary: output.summary,
      comments: output.comments,
      criteria: output.criteria,
    },
  });
});
