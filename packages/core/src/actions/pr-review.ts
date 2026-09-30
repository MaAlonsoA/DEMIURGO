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

const BUILDER = 'pr_review@1';
export const PR_REVIEW_DIFF_MAX = 400_000;
const BUDGET = { brief: 20_000, task: 8_000, criteria: 12_000, diff: PR_REVIEW_DIFF_MAX };

type Ci = { conclusion: string | null; tests: { code: string; result: 'pass' | 'fail' }[] };

function ciOf(value: unknown): Ci {
  const v = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const tests = Array.isArray(v.tests) ? v.tests : [];
  return {
    conclusion: typeof v.conclusion === 'string' ? v.conclusion : null,
    tests: tests
      .map((t) => (typeof t === 'object' && t !== null ? (t as Record<string, unknown>) : {}))
      .filter((t) => typeof t.code === 'string' && (t.result === 'pass' || t.result === 'fail'))
      .map((t) => ({ code: t.code as string, result: t.result as 'pass' | 'fail' })),
  };
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
    .select(['records.code', 'record_versions.id', 'record_versions.n', 'record_versions.title', 'record_versions.sections'])
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
        diff,
      },
    },
    manifest: manifest.build(),
  };
});

type PackContent = { build_request_id: string; pr_url: string; criteria: { code: string }[] };

registerChecker('pr_review', async ({ db, run, output }) => {
  const pack = await packContentOf<PackContent>(db, run);
  const codes = pack.criteria.map((c) => c.code);
  const notes: string[] = [];
  const listed = output.criteria.map((c) => c.code);
  const missing = codes.filter((c) => !listed.includes(c));
  const extra = listed.filter((c, i) => !codes.includes(c) || listed.indexOf(c) !== i);
  if (missing.length > 0) notes.push(`\`criteria\` must list ${missing.join(', ')}: it lists exactly the criteria the task covers.`);
  if (extra.length > 0) notes.push(`\`criteria\` lists ${extra.join(', ')}, which the task does not cover or which appear twice: exactly one entry per covered criterion.`);
  const blocking = output.comments.filter((c) => c.severity === 'blocking');
  if (output.verdict === 'approve') {
    if (blocking.length > 0) notes.push('An approval has no `blocking` comment: change the verdict to request_changes or downgrade the comment to a nit.');
    for (const c of output.criteria) {
      if (!c.covered) notes.push(`${c.code} is not covered: an approval needs every criterion covered.`);
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
