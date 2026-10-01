// The durable GitHub build of a task end to end, with GitHub, the builder container and time faked:
// builder → commit → push → PR → CI → evidence → reviewer agent (simulated) → required status →
// auto-merge → merged → done. A red CI ends the attempt with changes requested and the request stays
// in review, ready to be built again.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalPrettyJson, human, sha256Hex, system } from '@demiurgo/domain';
import { sql } from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSimulatedProvider } from '../src/agents/simulated.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { buildQueue } from '../src/build/queue.ts';
import { advanceBuildQueue, autoStatus } from '../src/build/auto.ts';
import { type BuildDeps, resetBuildDeps, setBuildDeps, waitForBuild } from '../src/build/orchestrator.ts';
import { waitForRun } from '../src/engine/engine.ts';
import { pushBranch } from '../src/github/client.ts';
import { waitForKnowledge } from '../src/knowledge/workflows.ts';
import { recordDetail } from '../src/queries/read.ts';
import { taskCoversOf } from '../src/queries/sizes.ts';
import { taskViewOfRecord } from '../src/queries/task-view.ts';
import { useEnvironment } from './support/env.ts';

const projects = mkdtempSync(join(tmpdir(), 'dmg-build-'));
const remote = join(projects, '..', `${projects.split('/').at(-1)}-remote.git`);
const saved = { ...process.env };
process.env.DEMIURGO_PROJECTS_DIR = projects;
process.env.DEMIURGO_PROJECTS_HOST_DIR = projects;
process.env.DEMIURGO_GITHUB_TOKEN = 'test-token';
process.env.DEMIURGO_GITHUB_OWNER = 'acme';

const environment = useEnvironment({ durable: true, providers: () => [createSimulatedProvider()] });

const ana = human('ana');
let projectId = '';
let taskId = '';
let taskCode = '';
let taskTitle = '';
let versionId = '';
let featureVersionId = '';
let codes: string[] = [];
let repoDir = '';

type Cmd = Parameters<typeof executeCommand>[1]['command'];
const cmd = (command: Cmd, data: unknown, entityId?: string) =>
  executeCommand(environment().services, { command, actor: ana, projectId, data, ...(entityId ? { entityId } : {}) });
const db = () => environment().services.db;
const git = (dir: string, ...args: string[]) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' });

async function draftRun(action: string, scope: { type: string; id: string }) {
  await waitForKnowledge(environment().services, projectId, 15_000);
  const r = await cmd('run.request', { action, scope });
  await waitForRun(r.entityId);
  return db().selectFrom('ai_runs').selectAll().where('id', '=', r.entityId).executeTakeFirstOrThrow();
}

async function accepted(runId: string) {
  return db()
    .selectFrom('proposals')
    .innerJoin('proposal_batches', 'proposal_batches.id', 'proposals.batch_id')
    .select(['proposals.id', 'proposal_batches.id as batchId'])
    .where('proposal_batches.run_id', '=', runId)
    .orderBy('proposals.position')
    .execute();
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeAll(async () => {
  projectId = (await executeCommand(environment().services, { command: 'project.create', actor: ana, data: { name: 'Recipes' } })).projectId;
  const thread = (await cmd('exploration.open', { purpose: 'Share recipes with friends' })).entityId;
  await cmd('message.post', { exploration_id: thread, text: 'People should share recipes.', respond: false });
  const epicRun = await draftRun('epic_plan', { type: 'exploration', id: thread });
  const epic = (await cmd('proposal.accept', { approve: false }, (await accepted(epicRun.id))[0]?.id)).result as { versionId: string };
  await cmd('record_version.approve', {}, epic.versionId);
  const planned = await db().selectFrom('planned_features').select(['code', 'name']).where('project_id', '=', projectId).orderBy('position').executeTakeFirstOrThrow();
  const featureThread = (
    await cmd('exploration.open', {
      purpose: `Design "${planned.name}" (${planned.code}): Walk the whole thing`,
      parent_id: thread,
      origin: { type: 'record_version', id: epic.versionId },
    })
  ).entityId;
  const featureRun = await draftRun('feature_design', { type: 'exploration', id: featureThread });
  const feature = (await cmd('proposal.accept', { approve: false }, (await accepted(featureRun.id))[0]?.id)).result as { versionId: string };
  await cmd('record_version.approve', {}, feature.versionId);
  featureVersionId = feature.versionId;
  const taskRun = await draftRun('task_plan', { type: 'record_version', id: feature.versionId });
  // Task drafts are resolved one by one (batch_type agent, resolution item).
  for (const p of await accepted(taskRun.id)) await cmd('proposal.accept', { approve: true }, p.id);
  const task = (await recordDetail(db(), projectId, planned.code)).tasks?.[0];
  codes = task?.covers ?? [];
  taskCode = task?.code ?? '';
  taskTitle = task?.title ?? '';
  expect(codes.length).toBeGreaterThan(0);
  const taskRow = await db().selectFrom('records').select('id').where('project_id', '=', projectId).where('code', '=', taskCode).executeTakeFirstOrThrow();
  taskId = taskRow.id;
  versionId = (await db().selectFrom('record_versions').select('id').where('record_id', '=', taskId).where('state', '=', 'approved').executeTakeFirstOrThrow()).id;

  // The project's local repository (written by DEMIURGO after each authority event) and its remote.
  for (let i = 0; i < 100; i++) {
    const repo = await db().selectFrom('project_repos').select('dir').where('project_id', '=', projectId).executeTakeFirst();
    if (repo) {
      repoDir = join(projects, repo.dir);
      try {
        git(repoDir, 'rev-parse', 'main');
        break;
      } catch {
        // not committed yet
      }
    }
    await sleep(100);
  }
  await sleep(500);
  execFileSync('git', ['init', '--bare', '-q', '-b', 'main', remote]);
  git(repoDir, 'remote', 'add', 'origin', remote);
  git(repoDir, 'push', '-q', 'origin', 'main');
});

afterAll(() => {
  resetBuildDeps();
  rmSync(projects, { recursive: true, force: true });
  rmSync(remote, { recursive: true, force: true });
  process.env = saved;
});

const junit = (failing: boolean) =>
  `<?xml version="1.0"?><testsuite>${codes
    .map((c, i) => `<testcase name="${c} does what the criterion says"${failing && i === 0 ? '><failure message="boom"/></testcase>' : '/>'}`)
    .join('')}</testsuite>`;
const diffWith = () =>
  `diff --git a/tests/x.test.ts b/tests/x.test.ts\n+++ b/tests/x.test.ts\n${codes.map((c) => `+it('${c} does what the criterion says', () => {});`).join('\n')}\n`;

type Calls = { statuses: { state: string; sha: string; context: string }[]; autoMerge: string[]; merges: number; reviews: number; opened: number; polls: { ci: number; merge: number }; prompts: string[] };
let calls: Calls;
let builderRuns = 0;

const APPROVED_TOKENS = { color: { bg: { $value: { light: '#ffffff', dark: '#000000' }, $type: 'color' } } };

/** Writes an approved design system (as DEMIURGO's sync would) and an app file that breaks or keeps its rules. */
function writeDesign(dir: string, violating: boolean): void {
  mkdirSync(join(dir, 'design', 'design-system'), { recursive: true });
  const manifest = { version: 'DSY-001@1', paths: { system: 'src/design-system/' }, components: [], tokens_hash: sha256Hex(canonicalPrettyJson(APPROVED_TOKENS)), base: { kind: 'scratch' } };
  writeFileSync(join(dir, 'design', 'design-system', 'manifest.json'), canonicalPrettyJson(manifest));
  writeFileSync(join(dir, 'design', 'design-system', 'tokens.json'), canonicalPrettyJson(APPROVED_TOKENS));
  writeFileSync(
    join(dir, 'src', 'App.tsx'),
    violating ? "export const App = () => <button style={{ color: '#ff0000' }}>Share</button>;\n" : 'export const App = () => <main />;\n',
  );
}

function fakes(opts: { ciConclusion: 'success' | 'failure'; design?: 'violating' | 'clean'; protection?: 'demiurgo'; ciFlipsRed?: boolean; auto?: number; greenAfterRuns?: number; extraCiRun?: (poll: number) => { status: string; conclusion: string | null } }): Partial<BuildDeps> {
  const base = builderRuns;
  // With greenAfterRuns, CI is red until the builder has run that many times, then green.
  const conclusionNow = (): 'success' | 'failure' => (opts.greenAfterRuns !== undefined && builderRuns - base >= opts.greenAfterRuns ? 'success' : opts.ciConclusion);
  calls = { statuses: [], autoMerge: [], merges: 0, reviews: 0, opened: 0, polls: { ci: 0, merge: 0 }, prompts: [] };
  const github = {
    ensureProjectRepo: async () => ({ owner: 'acme', repo: 'recipes', url: 'https://github.com/acme/recipes', protection: opts.protection ?? 'github' }),
    // A real push, to the local bare remote.
    pushBranch,
    openPullRequest: async () => {
      calls.opened++;
      return { number: 7, url: 'https://github.com/acme/recipes/pull/7', nodeId: 'PR_node', headSha: 'x' };
    },
    pullRequest: async () => {
      calls.polls.merge++;
      const merged = calls.polls.merge >= 2;
      return { state: merged ? 'closed' : 'open', merged, mergedAt: merged ? '2026-09-30T10:00:00Z' : null, headSha: 'x', url: 'https://github.com/acme/recipes/pull/7' };
    },
    pullRequestDiff: async () => diffWith(),
    setCommitStatus: async (_c: unknown, _o: string, _r: string, sha: string, s: { context: string; state: string }) => {
      calls.statuses.push({ state: s.state, sha, context: s.context });
    },
    postReview: async () => {
      calls.reviews++;
    },
    enableAutoMerge: async (_c: unknown, id: string) => {
      calls.autoMerge.push(id);
    },
    mergePullRequest: async () => {
      calls.merges++;
    },
    checkRunsFor: async () => {
      calls.polls.ci++;
      // A second run named `ci` on the same SHA (the workflow runs on push and on pull_request).
      if (opts.extraCiRun) {
        const extra = opts.extraCiRun(calls.polls.ci);
        return [
          { name: 'ci', status: 'completed', conclusion: 'success', detailsUrl: null },
          { name: 'ci', ...extra, detailsUrl: null },
        ];
      }
      // With ciFlipsRed, CI is green while it is awaited and red when DEMIURGO re-checks it before merging.
      if (opts.ciFlipsRed && calls.polls.ci >= 3) return [{ name: 'ci', status: 'completed', conclusion: 'failure', detailsUrl: null }];
      return calls.polls.ci < 2
        ? [{ name: 'ci', status: 'in_progress', conclusion: null, detailsUrl: null }]
        : [{ name: 'ci', status: 'completed', conclusion: conclusionNow(), detailsUrl: null }];
    },
    junitArtifactFor: async () => {
      // The run that failed and the run that passed on the same commit: every test shows once failing, once passing.
      if (opts.extraCiRun?.(Number.MAX_SAFE_INTEGER).conclusion === 'failure') return junit(false) + junit(true);
      return junit(conclusionNow() === 'failure');
    },
  } as unknown as BuildDeps['github'];
  return {
    github,
    config: () => ({ token: 'test-token', owner: 'acme', api: 'https://api.github.test' }),
    pollMs: 30,
    // The tests of manual attempts turn the automatic follow-ups off; the ones below turn them on.
    autoFollowUps: opts.auto ?? 0,
    ciAppearMs: 10_000,
    ciTimeoutMs: 10_000,
    mergeTimeoutMs: 10_000,
    reviewTimeoutMs: 20_000,
    runBuilder: async (spec, options) => {
      calls.prompts.push(spec.prompt);
      const dir = options?.worktreePath ?? '';
      mkdirSync(join(dir, 'src'), { recursive: true });
      writeFileSync(join(dir, 'src', 'recipes.ts'), `export const share = () => ${++builderRuns};\n`);
      if (opts.design) writeDesign(dir, opts.design === 'violating');
      mkdirSync(join(dir, '.demiurgo'), { recursive: true });
      const report = {
        summary: 'Recipes can be shared.',
        tests: codes.map((c) => ({ name: `${c} does what the criterion says`, file: 'tests/x.test.ts', criterion: c })),
        notes: '',
      };
      writeFileSync(join(dir, '.demiurgo', 'build-report.json'), JSON.stringify(report));
      return { state: 'ok', exitCode: 0, durationMs: 5, transcriptTail: 'done', report, container: 'fake' };
    },
  };
}

async function newRequest(): Promise<string> {
  return (
    await db()
      .insertInto('build_requests')
      .values({
        // Not a uuidv7: the branch name uses the first 8 characters of the id, which two requests within a minute would share.
        id: randomUUID(),
        project_id: projectId,
        task_id: taskId,
        task_version_id: versionId,
        feature_version_id: featureVersionId,
        brief: `Build ${taskCode} "${taskTitle}".`,
        requested_by: 'human:ana',
      })
      .returning('id')
      .executeTakeFirstOrThrow()
  ).id;
}

async function finished(requestId: string, attempt: number): Promise<string> {
  for (let i = 0; i < 200; i++) {
    try {
      return await waitForBuild(requestId, attempt);
    } catch {
      await sleep(50);
    }
  }
  throw new Error('The build workflow never started.');
}

const steps = (requestId: string) =>
  db().selectFrom('build_steps').selectAll().where('build_request_id', '=', requestId).orderBy('created_at').orderBy('id').execute();

describe('build.start', () => {
  beforeEach(async () => {
    resetBuildDeps();
    // The tests share one task: a merged build (done) would refuse the next one, as it should.
    await db().updateTable('build_requests').set({ state: 'withdrawn', withdrawn_by: 'human:ana', withdrawn_at: new Date() }).where('task_id', '=', taskId).where('state', '=', 'done').execute();
  });

  it('refuses without an open request or without GitHub', async () => {
    await db().deleteFrom('build_steps').execute().catch(() => undefined);
    await expect(cmd('build.start', { task: taskCode })).rejects.toThrow(/conditions/);
    const requestId = await newRequest();
    const token = process.env.DEMIURGO_GITHUB_TOKEN;
    delete process.env.DEMIURGO_GITHUB_TOKEN;
    try {
      await expect(cmd('build.start', { task: taskCode })).rejects.toMatchObject({ reasons: [expect.stringContaining('Connect GitHub first')] });
    } finally {
      process.env.DEMIURGO_GITHUB_TOKEN = token;
    }
    await db().updateTable('build_requests').set({ state: 'withdrawn', withdrawn_by: 'human:ana', withdrawn_at: new Date() }).where('id', '=', requestId).execute();
  });

  it('builds, opens the PR, waits for CI, records evidence, reviews, sets the status and merges: done', async () => {
    setBuildDeps(fakes({ ciConclusion: 'success' }));
    const requestId = await newRequest();
    const started = await cmd('build.start', { task: taskCode });
    expect(started.result).toMatchObject({ task: taskCode, attempt: 1 });
    expect(await finished(requestId, 1)).toBe('done');

    const request = await db().selectFrom('build_requests').selectAll().where('id', '=', requestId).executeTakeFirstOrThrow();
    expect(request).toMatchObject({ state: 'done', pr_url: 'https://github.com/acme/recipes/pull/7', pr_number: 7, done_by: 'system:build@1' });
    expect(request.branch).toMatch(/^task\//);
    expect(request.head_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(git(remote, 'branch', '--list', 'task/*')).toContain(request.branch as string);
    // The builder's report never enters the commit.
    expect(git(remote, 'ls-tree', '-r', '--name-only', request.branch as string)).not.toContain('.demiurgo');
    expect(git(remote, 'log', '-1', '--format=%s', request.branch as string).trim()).toBe(`${taskCode}: ${taskTitle}`);

    const rows = await steps(requestId);
    const ok = new Set(rows.filter((s) => s.outcome === 'ok').map((s) => s.stage));
    for (const stage of ['repo', 'worktree', 'builder', 'commit', 'design', 'push', 'pr', 'status', 'ci', 'evidence', 'review', 'publish', 'merge']) {
      expect(ok.has(stage), `${stage} is ok`).toBe(true);
    }
    expect(rows.some((s) => s.outcome === 'failed')).toBe(false);
    expect(rows.filter((s) => s.stage === 'ci' && s.outcome === 'waiting')).toHaveLength(1);
    expect(calls.prompts[0]).toContain(`# Brief\nBuild ${taskCode}`);

    const evidence = await db().selectFrom('evidence').selectAll().where('project_id', '=', projectId).where('pr_url', '=', 'https://github.com/acme/recipes/pull/7').execute();
    expect(evidence.length).toBeGreaterThanOrEqual(codes.length);

    expect(calls.statuses.map((s) => `${s.context}:${s.state}`)).toEqual(['demiurgo/review:pending', 'demiurgo/design:success', 'demiurgo/review:success']);
    expect(calls.statuses.every((s) => s.sha === request.head_sha)).toBe(true);
    // No approved design system in this project: the stage passes with its note.
    expect(rows.find((s) => s.stage === 'design' && s.outcome === 'ok')?.detail).toMatchObject({ note: 'no design system yet', violations: [] });
    expect(calls.autoMerge).toEqual(['PR_node']);
    expect(calls.reviews).toBe(1);
    const review = await db().selectFrom('pr_reviews').selectAll().where('build_request_id', '=', requestId).executeTakeFirstOrThrow();
    expect(review.verdict).toBe('approve');
    expect(review.published_at).not.toBeNull();

    const detail = await recordDetail(db(), projectId, taskCode);
    expect(detail.build?.github).toBe(true);
    expect(detail.build?.steps?.at(-1)).toMatchObject({ attempt: 1, stage: 'merge', outcome: 'ok' });
    expect(detail.build?.review).toMatchObject({ verdict: 'approve' });
    expect(detail.build?.pr_url).toBe('https://github.com/acme/recipes/pull/7');
  });

  it('a red CI: the status is failure, nothing merges and the request stays in review', async () => {
    setBuildDeps(fakes({ ciConclusion: 'failure' }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('changes_requested:merge');

    const request = await db().selectFrom('build_requests').selectAll().where('id', '=', requestId).executeTakeFirstOrThrow();
    expect(request.state).toBe('in_review');
    expect(calls.statuses.filter((s) => s.context === 'demiurgo/review').map((s) => s.state)).toEqual(['pending', 'failure']);
    expect(calls.autoMerge).toEqual([]);
    const rows = await steps(requestId);
    expect(rows.at(-1)).toMatchObject({ stage: 'merge', outcome: 'changes_requested' });
    // The steps tell the truth: a red CI is `failed` (with its conclusion), and the flow goes on to the review.
    expect(rows.find((s) => s.stage === 'ci' && s.outcome === 'ok')).toBeUndefined();
    expect(rows.find((s) => s.stage === 'ci' && s.outcome === 'failed')?.detail).toMatchObject({ conclusion: 'failure' });
    expect(rows.filter((s) => s.stage === 'review').map((s) => s.outcome)).toEqual(['started', 'waiting', 'changes_requested']);
    // The reviewer's comments reach the task page (path, line, text), with the real verdict.
    const failedDetail = await recordDetail(db(), projectId, taskCode);
    expect(failedDetail.build?.review).toMatchObject({ verdict: 'request_changes' });
    expect(failedDetail.build?.review?.comments?.some((c) => c.severity === 'blocking' && c.body.length > 0)).toBe(true);

    // The task page tells the truth too: red CI and a review that asks for changes are failures, never «Passed».
    const taskRecord = await db().selectFrom('records').select('id').where('project_id', '=', projectId).where('code', '=', taskCode).executeTakeFirstOrThrow();
    const view = await taskViewOfRecord(db(), projectId, taskRecord.id);
    const checkOf = (name: string) => view?.development?.checks.find((c) => c.name === name)?.state;
    expect(checkOf('ci')).toBe('failure');
    expect(checkOf('demiurgo/review')).toBe('failure');
    expect(view?.dod.filter((x) => /^(ci|demiurgo\/review) check green/.test(x.item)).every((x) => !x.met)).toBe(true);
    expect(view?.development?.review?.comments.length).toBeGreaterThan(0);
    // Build counts the criteria the task covers.
    const queued = [...(await buildQueue(db(), projectId)).ready, ...(await buildQueue(db(), projectId)).waiting].find((t) => t.code === taskCode);
    expect(queued?.checks).toBe(codes.length);

    // Not running any more: the person can build again (attempt 2, same branch and pull request).
    setBuildDeps(fakes({ ciConclusion: 'success' }));
    const again = await cmd('build.start', { task: taskCode });
    expect(again.result).toMatchObject({ attempt: 2 });
    expect(await finished(requestId, 2)).toBe('done');
    expect(calls.opened).toBe(0);
    expect(calls.prompts[0]).toContain('attempt 2');
    const after = await db().selectFrom('build_requests').selectAll().where('id', '=', requestId).executeTakeFirstOrThrow();
    expect(after.state).toBe('done');
    expect(after.branch).toBe(request.branch);
  });

  it('the design guard fails the attempt before the push, and the next attempt gets the violations and the manifest', async () => {
    setBuildDeps(fakes({ ciConclusion: 'success', design: 'violating' }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('failed:design');

    const rows = await steps(requestId);
    const failed = rows.find((s) => s.stage === 'design' && s.outcome === 'failed');
    const detail = failed?.detail as { violations: { rule: number; path: string; line: number }[]; error: string };
    expect(detail.violations.map((v) => `${v.rule}:${v.path}:${v.line}`)).toEqual(expect.arrayContaining(['1:src/App.tsx:1', '2:src/App.tsx:1']));
    expect(rows.some((s) => s.stage === 'push')).toBe(false);
    expect(calls.statuses).toEqual([]);

    setBuildDeps(fakes({ ciConclusion: 'success', design: 'clean' }));
    expect((await cmd('build.start', { task: taskCode })).result).toMatchObject({ attempt: 2 });
    expect(await finished(requestId, 2)).toBe('done');
    expect(calls.prompts[0]).toContain('# Design system (DSY-001@1)');
    expect(calls.prompts[0]).toContain('"tokens_hash"');
    expect(calls.prompts[0]).toContain('The design-system check (demiurgo/design) failed');
    expect(calls.prompts[0]).toContain('src/App.tsx:1 (rule 2)');
    expect(calls.statuses.map((s) => `${s.context}:${s.state}`)).toContain('demiurgo/design:success');
    const design = (await steps(requestId)).filter((s) => s.stage === 'design' && s.outcome === 'ok').at(-1);
    expect(design?.detail).toMatchObject({ version: 'DSY-001@1', violations: [] });
  });

  it('a failed commit after a good builder: «Build again» resumes at the commit, reusing the worktree, without running the builder', async () => {
    const base = fakes({ ciConclusion: 'success' });
    let unreadable = '';
    setBuildDeps({
      ...base,
      runBuilder: async (spec, options) => {
        const result = await (base.runBuilder as NonNullable<BuildDeps['runBuilder']>)(spec, options);
        // A directory git cannot read and DEMIURGO does not ignore: `git add -A` fails.
        unreadable = join(options?.worktreePath ?? '', 'locked');
        mkdirSync(join(unreadable, 'inner'), { recursive: true });
        writeFileSync(join(unreadable, 'inner', 'f.txt'), 'x\n');
        chmodSync(join(unreadable, 'inner'), 0o444);
        return result;
      },
    });
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('failed:commit');
    const runsBefore = builderRuns;

    chmodSync(join(unreadable, 'inner'), 0o700);
    setBuildDeps({ ...fakes({ ciConclusion: 'success' }), runBuilder: async () => { throw new Error('the builder must not run again'); } });
    expect((await cmd('build.start', { task: taskCode })).result).toMatchObject({ attempt: 2 });
    expect(await finished(requestId, 2)).toBe('done');
    expect(builderRuns).toBe(runsBefore);
    const second = (await steps(requestId)).filter((x) => x.attempt === 2 && x.stage === 'builder' && x.outcome === 'ok');
    expect(second[0]?.detail).toMatchObject({ resumed: true, resumed_from_attempt: 1 });
  });

  it('GitHub plan without protection: DEMIURGO merges itself (squash) when ci, review and design are green, without auto-merge', async () => {
    setBuildDeps(fakes({ ciConclusion: 'success', protection: 'demiurgo' }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('done');
    expect(calls.autoMerge).toEqual([]);
    expect(calls.merges).toBe(1);
    const merge = (await steps(requestId)).find((s) => s.stage === 'merge' && s.outcome === 'waiting');
    expect(merge?.detail).toMatchObject({ via: 'merge', protection: 'demiurgo' });
  });

  it('GitHub plan without protection: a red check on the head SHA at merge time means no merge and a failed attempt with the reason', async () => {
    setBuildDeps(fakes({ ciConclusion: 'success', protection: 'demiurgo', ciFlipsRed: true }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('failed:merge');
    expect(calls.merges).toBe(0);
    expect(calls.autoMerge).toEqual([]);
    const failed = (await steps(requestId)).find((s) => s.stage === 'merge' && s.outcome === 'failed');
    expect(JSON.stringify(failed?.detail)).toContain('required checks are not green: ci (failure)');
  });

  it('two ci runs on the same SHA, one failed: not mergeable, and the flaky test is reported', async () => {
    await db().updateTable('build_requests').set({ state: 'withdrawn', withdrawn_by: 'human:ana', withdrawn_at: new Date() }).where('project_id', '=', projectId).where('state', '=', 'in_review').execute();
    setBuildDeps(fakes({ ciConclusion: 'success', protection: 'demiurgo', extraCiRun: () => ({ status: 'completed', conclusion: 'failure' }) }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('changes_requested:merge');
    expect(calls.merges).toBe(0);
    const rows = await steps(requestId);
    expect(rows.find((s) => s.stage === 'ci' && s.outcome === 'failed')?.detail).toMatchObject({ conclusion: 'failure' });
    expect(rows.find((s) => s.stage === 'evidence' && s.outcome === 'ok')?.detail).toMatchObject({ flaky: expect.arrayContaining([codes[0]]) });
  });

  it('two ci runs on the same SHA, both passing: mergeable', async () => {
    await db().updateTable('build_requests').set({ state: 'withdrawn', withdrawn_by: 'human:ana', withdrawn_at: new Date() }).where('project_id', '=', projectId).where('state', '=', 'in_review').execute();
    setBuildDeps(fakes({ ciConclusion: 'success', protection: 'demiurgo', extraCiRun: () => ({ status: 'completed', conclusion: 'success' }) }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('done');
    expect(calls.merges).toBe(1);
  });

  it('two ci runs on the same SHA, one still running: it waits for it', async () => {
    await db().updateTable('build_requests').set({ state: 'withdrawn', withdrawn_by: 'human:ana', withdrawn_at: new Date() }).where('project_id', '=', projectId).where('state', '=', 'in_review').execute();
    setBuildDeps(fakes({ ciConclusion: 'success', protection: 'demiurgo', extraCiRun: (poll) => (poll < 5 ? { status: 'in_progress', conclusion: null } : { status: 'completed', conclusion: 'success' }) }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('done');
    expect(calls.polls.ci).toBeGreaterThanOrEqual(5);
    expect(calls.merges).toBe(1);
  });

  it('GitHub plan without protection: a reviewer that asked for changes never reaches the merge', async () => {
    // The previous test left its request open (the merge failed): withdraw it so a new one can start.
    await db().updateTable('build_requests').set({ state: 'withdrawn', withdrawn_by: 'human:ana', withdrawn_at: new Date() }).where('project_id', '=', projectId).where('state', '=', 'in_review').execute();
    setBuildDeps(fakes({ ciConclusion: 'failure', protection: 'demiurgo' }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('changes_requested:merge');
    expect(calls.merges).toBe(0);
    expect(calls.statuses.filter((s) => s.context === 'demiurgo/review').map((s) => s.state)).toEqual(['pending', 'failure']);
  });

  it('red CI: DEMIURGO starts attempt 2 by itself with the reviewer comments, and it merges when the fix works', async () => {
    await db().updateTable('build_requests').set({ state: 'withdrawn', withdrawn_by: 'human:ana', withdrawn_at: new Date() }).where('project_id', '=', projectId).where('state', '=', 'in_review').execute();
    setBuildDeps(fakes({ ciConclusion: 'failure', auto: 2, greenAfterRuns: 2 }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('changes_requested:merge');
    // Nobody pressed anything: attempt 2 exists, started by the system, on the same branch and pull request.
    expect(await finished(requestId, 2)).toBe('done');
    expect(calls.opened).toBe(1);
    expect(calls.prompts[1]).toContain('attempt 2');
    expect(calls.prompts[1]).toContain('The reviewer asked for these changes');
    const rows = await steps(requestId);
    const second = rows.find((x) => x.attempt === 2 && x.stage === 'repo' && x.outcome === 'started');
    expect(second?.detail).toMatchObject({ started_by: 'system:build@1', automatic: true });
    expect(rows.find((x) => x.attempt === 1 && x.stage === 'merge')?.detail).toMatchObject({ next_attempt: 2 });
    expect(rows.some((x) => x.attempt === 3)).toBe(false);
    expect((await db().selectFrom('build_requests').select('state').where('id', '=', requestId).executeTakeFirstOrThrow()).state).toBe('done');
  });

  it('after 2 automatic follow-ups it stops: «DEMIURGO tried 3 times; it needs you» and the person can still address the review', async () => {
    setBuildDeps(fakes({ ciConclusion: 'failure', auto: 2 }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('changes_requested:merge');
    expect(await finished(requestId, 2)).toBe('changes_requested:merge');
    expect(await finished(requestId, 3)).toBe('changes_requested:merge');
    await sleep(300);
    let rows = await steps(requestId);
    expect(Math.max(...rows.map((x) => x.attempt))).toBe(3);
    expect(rows.find((x) => x.attempt === 3 && x.stage === 'merge')?.detail).toMatchObject({ needs_you: true, tried: 3 });
    expect(rows.find((x) => x.attempt === 2 && x.stage === 'merge')?.detail).not.toHaveProperty('needs_you');

    // The person's button still works (attempt 4, started by them) and does not count as automatic.
    const again = await cmd('build.start', { task: taskCode });
    expect(again.result).toMatchObject({ attempt: 4 });
    expect(await finished(requestId, 4)).toBe('changes_requested:merge');
    // With the limit already used by the earlier chain, the person's attempt gets its own 2 follow-ups.
    expect(await finished(requestId, 5)).toBe('changes_requested:merge');
    expect(await finished(requestId, 6)).toBe('changes_requested:merge');
    await sleep(300);
    rows = await steps(requestId);
    expect(Math.max(...rows.map((x) => x.attempt))).toBe(6);
    expect(rows.find((x) => x.attempt === 4 && x.stage === 'repo')?.detail).toMatchObject({ started_by: 'human:ana' });
  });
});

describe('a merged task and a withdrawn build', () => {
  beforeEach(async () => {
    resetBuildDeps();
    await db().updateTable('build_requests').set({ state: 'withdrawn', withdrawn_by: 'human:ana', withdrawn_at: new Date() }).where('task_id', '=', taskId).where('state', 'in', ['done', 'requested', 'in_review']).execute();
  });

  it('a task with a merged pull request is built: out of the queue, listed as built, and no new build is accepted', async () => {
    const requestId = await newRequest();
    await db().updateTable('build_requests').set({ state: 'in_review', in_review_by: 'human:ana', in_review_at: new Date(), pr_url: 'https://github.com/acme/recipes/pull/9' }).where('id', '=', requestId).execute();
    await db().updateTable('build_requests').set({ state: 'done', done_by: 'system:build@1', done_at: new Date() }).where('id', '=', requestId).execute();

    const queue = await buildQueue(db(), projectId);
    expect(queue.ready.map((t) => t.code)).not.toContain(taskCode);
    expect(queue.waiting.map((t) => t.code)).not.toContain(taskCode);
    expect(queue.built.find((t) => t.code === taskCode)).toMatchObject({ pr_url: 'https://github.com/acme/recipes/pull/9' });
    expect((await recordDetail(db(), projectId, taskCode)).implementation).toBe('implemented');

    await expect(cmd('build_request.request', { task: taskCode })).rejects.toThrow(/already built/);
    await expect(cmd('build.start', { task: taskCode })).rejects.toMatchObject({ reasons: [expect.stringContaining('already built')] });
    expect(await db().selectFrom('build_requests').select('id').where('task_id', '=', taskId).where('state', 'in', ['requested', 'in_review']).execute()).toEqual([]);
  });

  it('withdrawing a request whose pull request is open closes it on GitHub with a comment and deletes its branch', async () => {
    const closed: { number: number; comment: string }[] = [];
    const deleted: string[] = [];
    const fake = fakes({ ciConclusion: 'success' });
    setBuildDeps({
      ...fake,
      github: {
        ...(fake.github as object),
        pullRequest: async () => ({ state: 'open', merged: false, mergedAt: null, headSha: 'x', url: 'https://github.com/acme/recipes/pull/9' }),
        closePullRequest: async (_c: unknown, _o: string, _r: string, number: number, comment: string) => {
          closed.push({ number, comment });
        },
        deleteBranch: async (_c: unknown, _o: string, _r: string, branch: string) => {
          deleted.push(branch);
        },
      } as unknown as BuildDeps['github'],
    });
    await db().insertInto('project_github').values({ project_id: projectId, owner: 'acme', repo: 'recipes' }).onConflict((oc) => oc.doNothing()).execute();
    const requestId = await newRequest();
    await db()
      .updateTable('build_requests')
      .set({ state: 'in_review', in_review_by: 'human:ana', in_review_at: new Date(), pr_url: 'https://github.com/acme/recipes/pull/9', pr_number: 9, branch: 'tsk-held-slug' })
      .where('id', '=', requestId)
      .execute();
    await cmd('build_request.withdraw', { reason: 'Needs the real deployment' }, requestId);
    for (let i = 0; i < 100 && deleted.length === 0; i++) await sleep(50);
    expect(closed).toEqual([{ number: 9, comment: 'Withdrawn in DEMIURGO: Needs the real deployment' }]);
    expect(deleted).toEqual(['tsk-held-slug']);
  });

  it('withdrawing a running build cancels it: the builder is aborted, the workflow cancelled and the journal says why', async () => {
    const cancelled: string[] = [];
    const engine = environment().services.engine;
    const original = engine.cancelBuild;
    engine.cancelBuild = async (id, attempt) => {
      cancelled.push(`${id}:${attempt}`);
      return original.call(engine, id, attempt);
    };
    let aborted = false;
    let release: () => void = () => undefined;
    const running = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      setBuildDeps({
        ...fakes({ ciConclusion: 'success' }),
        runBuilder: async (_spec, options) => {
          options?.signal?.addEventListener('abort', () => {
            aborted = true;
            release();
          });
          await running;
          return { state: 'failure', exitCode: null, durationMs: 1, failureKind: 'cancelled', transcriptTail: '', report: null, container: 'fake' };
        },
      });
      const requestId = await newRequest();
      await cmd('build.start', { task: taskCode });
      for (let i = 0; i < 100 && !(await steps(requestId)).some((s) => s.stage === 'builder'); i++) await sleep(50);
      await cmd('build_request.withdraw', {}, requestId);
      for (let i = 0; i < 100 && !aborted; i++) await sleep(50);
      expect(aborted).toBe(true);
      expect(cancelled).toEqual([`${requestId}:1`]);
      const rows = await steps(requestId);
      expect(rows.find((s) => s.outcome === 'cancelled')).toMatchObject({ stage: 'withdraw', attempt: 1, detail: expect.objectContaining({ reason: expect.stringContaining('withdrawn') }) });
      expect((await db().selectFrom('build_requests').select('state').where('id', '=', requestId).executeTakeFirstOrThrow()).state).toBe('withdrawn');
    } finally {
      release();
      engine.cancelBuild = original;
    }
  });
});

describe('Build the queue (opt-in per project)', () => {
  const coversOf = new Map<string, string[]>();
  let firstCodes: string[] = [];

  /** The fakes, with the test report following the task that is being built. */
  function queueFakes(opts: Parameters<typeof fakes>[0]): Partial<BuildDeps> {
    const base = fakes(opts);
    return {
      ...base,
      runBuilder: async (spec, options) => {
        const code = /# Brief\nBuild (\S+)/.exec(spec.prompt)?.[1] ?? '';
        codes = coversOf.get(code) ?? codes;
        return (base.runBuilder as NonNullable<BuildDeps['runBuilder']>)(spec, options);
      },
    };
  }

  const requestsOf = (code: string) =>
    db()
      .selectFrom('build_requests')
      .innerJoin('records', 'records.id', 'build_requests.task_id')
      .select(['build_requests.id', 'build_requests.requested_by', 'build_requests.state'])
      .where('build_requests.project_id', '=', projectId)
      .where('records.code', '=', code)
      .orderBy('build_requests.requested_at')
      .execute();
  const allRequests = () => db().selectFrom('build_requests').select('id').where('project_id', '=', projectId).where('state', 'in', ['requested', 'in_review', 'done']).execute();
  async function until<T>(read: () => Promise<T | undefined>): Promise<T> {
    for (let i = 0; i < 300; i++) {
      const found = await read();
      if (found !== undefined) return found;
      await sleep(50);
    }
    throw new Error('Nothing happened.');
  }
  const requestFor = (code: string) => until(async () => (await requestsOf(code)).find((r) => r.state !== 'withdrawn'));
  const readyCodes = async () => (await buildQueue(db(), projectId)).ready.map((t) => t.code);

  beforeAll(async () => {
    firstCodes = codes;
    // The architecture and security stages passed: the tasks are ready to build (the second one after the first is built).
    const thread = await db().selectFrom('explorations').select('id').where('project_id', '=', projectId).orderBy('created_at').executeTakeFirstOrThrow();
    for (const [position, stage] of [[4, 'architecture'], [5, 'security']] as const) {
      const exists = await db().selectFrom('stages').select('id').where('project_id', '=', projectId).where('stage', '=', stage).executeTakeFirst();
      if (!exists) await db().insertInto('stages').values({ project_id: projectId, stage, position, exploration_id: thread.id, state: 'passed', opened_by: 'human:ana', passed_by: 'human:ana', passed_at: new Date() }).execute();
    }
    const tasks = await db().selectFrom('records').select(['id', 'code']).where('project_id', '=', projectId).where('type', '=', 'task').execute();
    for (const t of tasks) coversOf.set(t.code, await taskCoversOf(db(), t.id));
  });

  beforeEach(async () => {
    resetBuildDeps();
    await cmd('build.queue_auto', { on: false }, projectId);
    await db().updateTable('build_requests').set({ state: 'withdrawn', withdrawn_by: 'human:ana', withdrawn_at: new Date() }).where('project_id', '=', projectId).where('state', 'in', ['requested', 'in_review', 'done']).execute();
  });

  afterAll(() => {
    codes = firstCodes;
  });

  it('flag off: nothing starts, not even after a merge', async () => {
    setBuildDeps(queueFakes({ ciConclusion: 'success' }));
    const [first, second] = await readyCodes();
    expect(first).toBeDefined();
    expect(await advanceBuildQueue(environment().services, projectId)).toBeNull();
    expect(await allRequests()).toEqual([]);

    // A build the person started merges: with the flag off the next ready task is left alone.
    await cmd('build_request.request', { task: first });
    await cmd('build.start', { task: first });
    const request = (await requestsOf(first as string)).find((r) => r.state !== 'withdrawn');
    expect(await finished(request?.id as string, 1)).toBe('done');
    await sleep(400);
    expect(await readyCodes()).toContain(second);
    expect(await allRequests()).toHaveLength(1);
    expect(await autoStatus(db(), projectId, await buildQueue(db(), projectId))).toEqual({ on: false, building: null, next: null, stopped: null });
  });

  it('flag on: the first ready task starts by itself, and when it merges the next one starts', async () => {
    setBuildDeps(queueFakes({ ciConclusion: 'success' }));
    const [first, second] = await readyCodes();
    expect(second, 'two ready tasks').toBeDefined();
    const next = second as string;

    const on = await cmd('build.queue_auto', { on: true }, projectId);
    expect(on.result).toEqual({ on: true });
    const one = await requestFor(first as string);
    expect(one.requested_by).toBe('system:build@1');
    expect(await finished(one.id, 1)).toBe('done');
    const rows = await steps(one.id);
    expect(rows.find((x) => x.stage === 'repo' && x.outcome === 'started')?.detail).toMatchObject({ started_by: 'system:build@1' });

    const two = await requestFor(next);
    expect(two.requested_by).toBe('system:build@1');
    expect(await finished(two.id, 1)).toBe('done');
    // Nothing is left: the queue idles.
    await sleep(300);
    expect(await allRequests()).toHaveLength(2);
    expect(await autoStatus(db(), projectId, await buildQueue(db(), projectId))).toEqual({ on: true, building: null, next: null, stopped: null });
    // Turning it on twice never starts the same task twice.
    expect(await advanceBuildQueue(environment().services, projectId)).toBeNull();

    const events = await db().selectFrom('events').select(['actor', 'after']).where('project_id', '=', projectId).where('command', '=', 'build.queue_auto').orderBy('seq').execute();
    expect(events.at(-1)).toMatchObject({ actor: 'human:ana', after: { auto: true } });
  });

  it('flag on: a build that needs the person stops the queue, which never skips ahead', async () => {
    setBuildDeps(queueFakes({ ciConclusion: 'failure', auto: 0 }));
    const [first] = await readyCodes();
    await cmd('build.queue_auto', { on: true }, projectId);
    const one = await requestFor(first as string);
    expect(await finished(one.id, 1)).toBe('changes_requested:merge');
    await sleep(500);
    const status = await autoStatus(db(), projectId, await buildQueue(db(), projectId));
    expect(status).toMatchObject({ on: true, building: null, next: null, stopped: { code: first, kind: 'needs_you', tried: 1 } });
    expect(await advanceBuildQueue(environment().services, projectId)).toBeNull();
    // Turning the flag off and on again does not skip it either.
    await cmd('build.queue_auto', { on: true }, projectId);
    await sleep(300);
    expect(await allRequests()).toHaveLength(1);
    expect(Math.max(...(await steps(one.id)).map((x) => x.attempt))).toBe(1);
  });

  it('on hold: a held task is not ready and the queue skips it and builds the next one; releasing it brings it back', async () => {
    setBuildDeps(queueFakes({ ciConclusion: 'success' }));
    const [first, second] = await readyCodes();
    expect(second, 'two ready tasks').toBeDefined();
    await expect(cmd('task.hold', { task: first, reason: '   ' }, projectId)).rejects.toMatchObject({ type: 'validation' });
    await expect(
      executeCommand(environment().services, { command: 'task.hold', actor: system('build', '1'), projectId, entityId: projectId, data: { task: first, reason: 'x' } }),
    ).rejects.toMatchObject({ type: 'forbidden' });

    const held = await cmd('task.hold', { task: first, reason: 'Needs the real Vercel and Neon deployment' }, projectId);
    expect(held.result).toEqual({ task: first });
    await expect(cmd('task.hold', { task: first, reason: 'again' }, projectId)).rejects.toMatchObject({ type: 'conflict' });
    const queue = await buildQueue(db(), projectId);
    expect(queue.ready.map((t) => t.code)).not.toContain(first);
    expect(queue.waiting.map((t) => t.code)).not.toContain(first);
    expect(queue.held).toHaveLength(1);
    expect(queue.held[0]).toMatchObject({ code: first, hold: { reason: 'Needs the real Vercel and Neon deployment', held_by: 'human:ana' } });
    await expect(cmd('build_request.request', { task: first })).rejects.toThrow(/on hold/);

    // The queue skips it: the next ready task is built, and the held one never gets a request.
    await cmd('build.queue_auto', { on: true }, projectId);
    const one = await requestFor(second as string);
    expect(await finished(one.id, 1)).toBe('done');
    await sleep(300);
    expect((await requestsOf(first as string)).filter((r) => r.state !== 'withdrawn')).toEqual([]);
    expect(await autoStatus(db(), projectId, await buildQueue(db(), projectId))).toEqual({ on: true, building: null, next: null, stopped: null });
    await cmd('build.queue_auto', { on: false }, projectId);

    const events = await db().selectFrom('events').select(['actor', 'command', 'after']).where('project_id', '=', projectId).where('command', 'in', ['task.hold']).execute();
    expect(events.at(-1)).toMatchObject({ actor: 'human:ana', after: { task: first, reason: 'Needs the real Vercel and Neon deployment' } });

    await cmd('task.release', { task: first }, projectId);
    await expect(cmd('task.release', { task: first }, projectId)).rejects.toMatchObject({ type: 'conflict' });
    const after = await buildQueue(db(), projectId);
    expect(after.held).toEqual([]);
    expect(after.ready.map((t) => t.code)).toContain(first);
    const rows = await db().selectFrom('task_holds').select(['released_by', 'released_at']).execute();
    expect(rows.filter((r) => r.released_at !== null).every((r) => r.released_by === 'human:ana')).toBe(true);
  });

  it('turning it on needs GitHub, and only a person can run it', async () => {
    const token = process.env.DEMIURGO_GITHUB_TOKEN;
    delete process.env.DEMIURGO_GITHUB_TOKEN;
    try {
      await expect(cmd('build.queue_auto', { on: true }, projectId)).rejects.toThrow(/Connect GitHub first/);
    } finally {
      process.env.DEMIURGO_GITHUB_TOKEN = token;
    }
    await expect(
      executeCommand(environment().services, { command: 'build.queue_auto', actor: system('build', '1'), projectId, entityId: projectId, data: { on: true } }),
    ).rejects.toMatchObject({ type: 'forbidden' });
  });
});

// Kept last: it adds a new approved version to the shared task.
describe('a task changed after its merge', () => {
  it('is to build again, not merged: the done request belongs to an older version', async () => {
    await db().updateTable('build_requests').set({ state: 'withdrawn', withdrawn_by: 'human:ana', withdrawn_at: new Date() }).where('task_id', '=', taskId).where('state', 'in', ['done', 'requested', 'in_review']).execute();
    const requestId = await newRequest();
    await db().updateTable('build_requests').set({ state: 'in_review', in_review_by: 'human:ana', in_review_at: new Date(), pr_url: 'https://github.com/acme/recipes/pull/11' }).where('id', '=', requestId).execute();
    await db().updateTable('build_requests').set({ state: 'done', done_by: 'system:build@1', done_at: new Date() }).where('id', '=', requestId).execute();
    expect((await recordDetail(db(), projectId, taskCode)).build).toMatchObject({ rebuild_from: null });

    const v1 = { n: (await db().selectFrom('record_versions').select('n').where('id', '=', versionId).executeTakeFirstOrThrow()).n };
    await sql`insert into record_versions (project_id, record_id, n, title, sections, author, content_hash, state, change_note)
      select project_id, record_id, n + 1, title, sections, author, ${randomUUID()}, 'approved', 'After a review'
      from record_versions where id = ${versionId}::uuid`.execute(db());

    const detail = await recordDetail(db(), projectId, taskCode);
    expect(detail.build).toMatchObject({ state: 'to_do', rebuild_from: v1.n });
    expect(detail.implementation).not.toBe('implemented');
  });
});
