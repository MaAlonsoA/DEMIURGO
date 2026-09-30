// The durable GitHub build of a task end to end, with GitHub, the builder container and time faked:
// builder → commit → push → PR → CI → evidence → reviewer agent (simulated) → required status →
// auto-merge → merged → done. A red CI ends the attempt with changes requested and the request stays
// in review, ready to be built again.

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalPrettyJson, human, sha256Hex } from '@demiurgo/domain';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createSimulatedProvider } from '../src/agents/simulated.ts';
import { executeCommand } from '../src/bus/bus.ts';
import { type BuildDeps, resetBuildDeps, setBuildDeps, waitForBuild } from '../src/build/orchestrator.ts';
import { waitForRun } from '../src/engine/engine.ts';
import { pushBranch } from '../src/github/client.ts';
import { waitForKnowledge } from '../src/knowledge/workflows.ts';
import { recordDetail } from '../src/queries/read.ts';
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

type Calls = { statuses: { state: string; sha: string; context: string }[]; autoMerge: string[]; reviews: number; opened: number; polls: { ci: number; merge: number }; prompts: string[] };
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

function fakes(opts: { ciConclusion: 'success' | 'failure'; design?: 'violating' | 'clean' }): Partial<BuildDeps> {
  calls = { statuses: [], autoMerge: [], reviews: 0, opened: 0, polls: { ci: 0, merge: 0 }, prompts: [] };
  const github = {
    ensureProjectRepo: async () => ({ owner: 'acme', repo: 'recipes', url: 'https://github.com/acme/recipes' }),
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
    mergePullRequest: async () => undefined,
    checkRunsFor: async () => {
      calls.polls.ci++;
      return calls.polls.ci < 2
        ? [{ name: 'ci', status: 'in_progress', conclusion: null, detailsUrl: null }]
        : [{ name: 'ci', status: 'completed', conclusion: opts.ciConclusion, detailsUrl: null }];
    },
    junitArtifactFor: async () => junit(opts.ciConclusion === 'failure'),
  } as unknown as BuildDeps['github'];
  return {
    github,
    config: () => ({ token: 'test-token', owner: 'acme', api: 'https://api.github.test' }),
    pollMs: 30,
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
  beforeEach(() => {
    resetBuildDeps();
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
    expect(rows.find((s) => s.stage === 'ci' && s.outcome === 'ok')?.detail).toMatchObject({ conclusion: 'failure' });

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
});
