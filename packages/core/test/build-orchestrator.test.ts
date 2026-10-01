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
import { CODE_SECTION_TITLE, buildQueue, composeBrief, deliveryLine, reportLine } from '../src/build/queue.ts';
import { advanceBuildQueue, autoStatus, dependsOnBusy } from '../src/build/auto.ts';
import type { TaskDependencyIndex } from '../src/queries/task-deps.ts';
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
// No real Jev call from the tests: the code ranking stays deterministic.
delete process.env.TYPESAFE_API_KEY;

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
  // The project's CI: the orchestrator prepares its environment before the builder (faked below, no docker).
  mkdirSync(join(repoDir, '.github', 'workflows'), { recursive: true });
  writeFileSync(
    join(repoDir, '.github', 'workflows', 'ci.yml'),
    'jobs:\n  ci:\n    services:\n      postgres:\n        image: postgres:17\n        ports: [\'5432:5432\']\n    env:\n      DATABASE_URL: postgres://postgres@localhost:5432/t\n    steps:\n      - run: pnpm install --frozen-lockfile\n      - run: pnpm db:migrate\n',
  );
  git(repoDir, 'add', '.github');
  git(repoDir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'ci');
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

type Calls = { updateCalls: number; updated: boolean; statuses: { state: string; sha: string; context: string }[]; autoMerge: string[]; merges: number; reviews: number; opened: number; polls: { ci: number; merge: number }; prompts: string[]; teardowns: number; prepared: { slug: string; id: string; keep: string[]; install: string | undefined; env: Record<string, string> }[]; builderSpecs: { network?: string; storeVolume?: string; env?: Record<string, string> }[] };
let calls: Calls;
let builderRuns = 0;

const UPDATED_SHA = 'u'.repeat(40);
const MAIN_SHA = 'm'.repeat(40);
const FLAKY_OUTSIDE = 'checkout totals are rounded';
/** A JUnit run where every criterion of the task passes and a test of no criterion fails (or passes). */
const withOutside = (outsideFails: boolean) =>
  `<?xml version="1.0"?><testsuite>${codes.map((c) => `<testcase name="${c} does what the criterion says"/>`).join('')}<testcase name="${FLAKY_OUTSIDE}">${outsideFails ? '<failure message="boom"/>' : ''}</testcase></testsuite>`;

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

function fakes(opts: { environment?: 'failing'; ciConclusion: 'success' | 'failure'; design?: 'violating' | 'clean'; protection?: 'demiurgo'; ciFlipsRed?: boolean; auto?: number; greenAfterRuns?: number; behind?: boolean; updateConflict?: boolean; updatedCi?: 'failure'; mainConclusion?: 'success' | 'failure'; flaky?: 'outside'; progress?: string; extraCiRun?: (poll: number) => { status: string; conclusion: string | null } }): Partial<BuildDeps> {
  const base = builderRuns;
  // With greenAfterRuns, CI is red until the builder has run that many times, then green.
  const conclusionNow = (): 'success' | 'failure' => (opts.greenAfterRuns !== undefined && builderRuns - base >= opts.greenAfterRuns ? 'success' : opts.ciConclusion);
  calls = { updateCalls: 0, updated: false, statuses: [], autoMerge: [], merges: 0, reviews: 0, opened: 0, polls: { ci: 0, merge: 0 }, prompts: [], teardowns: 0, prepared: [], builderSpecs: [] };
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
      return { state: merged ? 'closed' : 'open', merged, mergedAt: merged ? '2026-09-30T10:00:00Z' : null, mergeCommitSha: opts.mainConclusion ? MAIN_SHA : null, headSha: calls.updated ? UPDATED_SHA : 'x', url: 'https://github.com/acme/recipes/pull/7' };
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
    behindBy: async () => (opts.behind && !calls.updated ? 2 : 0),
    updateBranch: async () => {
      calls.updateCalls++;
      if (opts.updateConflict) return { result: 'conflict', message: 'merge conflict between base and head' };
      calls.updated = true;
      return { result: 'updated' };
    },
    checkRunsFor: async (_c: unknown, _o: string, _r: string, sha: string) => {
      // The merge commit on main and the head GitHub made when it updated the branch from main.
      if (sha === MAIN_SHA) return [{ name: 'ci', status: 'completed', conclusion: opts.mainConclusion ?? 'success', detailsUrl: null }];
      if (sha === UPDATED_SHA) return [{ name: 'ci', status: 'completed', conclusion: opts.updatedCi ?? 'success', detailsUrl: null }];
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
    junitArtifactFor: async (_c: unknown, _o: string, _r: string, sha: string) => {
      if (sha === UPDATED_SHA) return junit(opts.updatedCi === 'failure');
      // A test outside the task's criteria that failed in one run and passed in the other.
      if (opts.flaky === 'outside') return withOutside(true) + withOutside(false);
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
    prepareEnvironment: async (input) => {
      calls.prepared.push({ slug: input.slug, id: input.id, keep: input.keepDatabases ?? [], install: input.ci.install, env: input.ci.env });
      if (opts.environment === 'failing') return { ok: false, reason: 'Postgres did not become ready in 60 s: boom', failedStep: 'ready postgres' };
      return { ok: true, network: `demiurgo-env-${input.slug}`, storeVolume: `demiurgo-env-${input.slug}-pnpm-store`, env: { DATABASE_URL: 'postgres://postgres@postgres:5432/b_x' }, services: [{ name: 'postgres', image: 'postgres:17', container: 'c', action: 'running' }], databases: ['b_x'], steps: [] };
    },
    teardownEnvironment: async () => {
      calls.teardowns++;
    },
    runBuilder: async (spec, options) => {
      calls.builderSpecs.push({ network: spec.network, storeVolume: spec.storeVolume, env: spec.env });
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
      if (opts.progress) writeFileSync(join(dir, '.demiurgo', 'progress.md'), opts.progress);
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

describe('the build brief', () => {
  it('for the agent, DEMIURGO commits and opens the pull request; the human brief keeps asking for one', () => {
    const person = [deliveryLine(false, 'TSK-X-001', 'Title', 'main'), reportLine(false)].join('\n');
    const agent = [deliveryLine(true, 'TSK-X-001', 'Title', 'main'), reportLine(true)].join('\n');
    expect(person).toContain('Work on a branch named tsk-x-001-<short-slug-of-the-title>, not on main. Open a pull request titled "TSK-X-001: Title"');
    expect(person).toContain('report the pull request URL');
    expect(person).not.toContain('DEMIURGO commits');
    expect(agent).not.toContain('Open a pull request');
    expect(agent).not.toContain('Work on a branch named');
    expect(agent).not.toContain('pull request URL');
    expect(agent).toContain('DEMIURGO commits, pushes and opens the pull request after you exit; do not use git to commit or push.');
  });
});

describe('the build brief code map', () => {
  it('lists the most relevant existing symbols of the repository at main, and nothing without a repository', async () => {
    mkdirSync(join(repoDir, 'src', 'lib'), { recursive: true });
    const word = taskTitle.split(/\s+/).find((w) => w.length > 3) ?? 'recipe';
    writeFileSync(join(repoDir, 'src', 'lib', 'shared.ts'), `export function ${word.toLowerCase().replace(/[^a-z]/g, '')}Helper(input: string) {\n  return input;\n}\n`);
    git(repoDir, 'add', 'src');
    git(repoDir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'shared helper');
    git(repoDir, 'push', '-q', 'origin', 'main');
    // The architecture and security stages passed: the task is ready, so it has a brief.
    const thread = await db().selectFrom('explorations').select('id').where('project_id', '=', projectId).orderBy('created_at').executeTakeFirstOrThrow();
    for (const [position, stage] of [[4, 'architecture'], [5, 'security']] as const) {
      const exists = await db().selectFrom('stages').select('id').where('project_id', '=', projectId).where('stage', '=', stage).executeTakeFirst();
      if (!exists) await db().insertInto('stages').values({ project_id: projectId, stage, position, exploration_id: thread.id, state: 'passed', opened_by: 'human:ana', passed_by: 'human:ana', passed_at: new Date() }).execute();
    }
    const brief = await composeBrief(db(), projectId, taskCode);
    expect(brief).toContain(CODE_SECTION_TITLE);
    expect(brief).not.toContain('Code map (');
    expect(brief).not.toContain('Existing code to reuse');
    expect(brief).toContain('src/lib/shared.ts');
    expect(brief).toContain('Helper(input: string)');
    const saved = process.env.DEMIURGO_PROJECTS_DIR;
    delete process.env.DEMIURGO_PROJECTS_DIR;
    try {
      expect(await composeBrief(db(), projectId, taskCode)).not.toContain(CODE_SECTION_TITLE);
    } finally {
      process.env.DEMIURGO_PROJECTS_DIR = saved;
    }
  });
});

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
    // «Code to extend» is computed by the builder stage on the branch it works on, kept in the step and per file.
    expect(calls.prompts[0]).toContain(CODE_SECTION_TITLE);
    const builderStep = rows.find((x) => x.stage === 'builder' && x.outcome === 'ok');
    expect(builderStep?.detail).toMatchObject({ code_to_extend: { classifier_id: 'deterministic@code-map', files: expect.arrayContaining(['src/lib/shared.ts']) } });
    const opinions = await db().selectFrom('task_code_opinions').selectAll().where('build_request_id', '=', requestId).orderBy('rank').execute();
    expect(opinions.length).toBeGreaterThan(0);
    expect(opinions[0]).toMatchObject({ attempt: 1, rank: 1, jev_p: null, classifier_id: 'deterministic@code-map' });
    expect(opinions.map((o) => o.path)).toContain('src/lib/shared.ts');
    expect(opinions.every((o, i) => o.rank === i + 1)).toBe(true);
    // The queue's stored brief leaves the section out: it is computed again at each attempt.
    expect(request.brief).not.toContain(CODE_SECTION_TITLE);

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

  it('prepares the CI environment before the builder, hands it to the builder and tears it down', async () => {
    setBuildDeps(fakes({ ciConclusion: 'success' }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('done');
    const rows = await steps(requestId);
    expect(rows.findIndex((s) => s.stage === 'environment' && s.outcome === 'ok')).toBeLessThan(rows.findIndex((s) => s.stage === 'builder' && s.outcome === 'started'));
    expect(rows.find((s) => s.stage === 'environment' && s.outcome === 'ok')?.detail).toMatchObject({ services: [{ name: 'postgres', image: 'postgres:17', action: 'running' }], databases: ['b_x'], variables: ['DATABASE_URL'] });
    const slug = calls.prepared[0]!.slug;
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(calls.prepared).toEqual([{ slug, id: requestId, keep: expect.arrayContaining([expect.stringMatching(/^b_[0-9a-f]{12}$/)]), install: 'pnpm install --frozen-lockfile', env: { DATABASE_URL: 'postgres://postgres@localhost:5432/t' } }]);
    expect(calls.builderSpecs).toEqual([{ network: `demiurgo-env-${slug}`, storeVolume: `demiurgo-env-${slug}-pnpm-store`, env: { DATABASE_URL: 'postgres://postgres@postgres:5432/b_x' } }]);
    expect(calls.teardowns).toBeGreaterThan(0);
  });

  it('an environment that cannot be prepared fails the attempt with its reason before the builder runs', async () => {
    setBuildDeps(fakes({ ciConclusion: 'success', environment: 'failing' }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('failed:environment');
    const rows = await steps(requestId);
    expect(rows.find((s) => s.stage === 'environment' && s.outcome === 'failed')?.detail).toMatchObject({ error: 'Postgres did not become ready in 60 s: boom', failed_step: 'ready postgres' });
    expect(rows.some((s) => s.stage === 'builder')).toBe(false);
    expect(calls.builderSpecs).toEqual([]);
    expect(calls.prompts).toEqual([]);
    expect(calls.teardowns).toBe(1);
    // The failed request stays open; this one is not built again.
    await db().updateTable('build_requests').set({ state: 'withdrawn', withdrawn_by: 'human:ana', withdrawn_at: new Date() }).where('id', '=', requestId).execute();
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

  /** The builder runs out of time on the given attempts; it leaves its files unless `leaves` is false. */
  function timingOut(timeouts: number[], leaves = true): Partial<BuildDeps> {
    const base = fakes({ ciConclusion: 'success' });
    let attempt = 0;
    return {
      ...base,
      runBuilder: async (spec, options) => {
        attempt++;
        if (!timeouts.includes(attempt)) return (base.runBuilder as NonNullable<BuildDeps['runBuilder']>)(spec, options);
        calls.prompts.push(spec.prompt);
        if (leaves) {
          mkdirSync(join(options?.worktreePath ?? '', 'src'), { recursive: true });
          writeFileSync(join(options?.worktreePath ?? '', 'src', 'half-done.ts'), `export const half = ${attempt};\n`);
        }
        return { state: 'failure', exitCode: null, durationMs: 1, failureKind: 'timeout', transcriptTail: '', report: null, container: 'fake' };
      },
    };
  }

  it('a builder that runs out of time with changes: they are committed as WIP and pushed, no pull request, and attempt 2 starts by itself and continues from them', async () => {
    setBuildDeps(timingOut([1]));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('failed:builder');
    const first = await steps(requestId);
    const failed = first.find((x) => x.attempt === 1 && x.stage === 'builder' && x.outcome === 'failed');
    const detail = failed?.detail as { failure_kind: string; wip_commit: string; wip_files: string[] };
    expect(detail).toMatchObject({ failure_kind: 'timeout', wip_files: ['src/half-done.ts'] });
    expect(first.some((x) => x.attempt === 1 && ['commit', 'push', 'pr'].includes(x.stage))).toBe(false);
    const branch = (first.find((x) => x.stage === 'worktree' && x.outcome === 'ok')?.detail as { branch: string }).branch;
    // The WIP commit is on the pushed branch (attempt 2 may already have added to it).
    expect(execFileSync('git', ['--git-dir', remote, 'log', '--format=%s', `${detail.wip_commit}^!`], { encoding: 'utf8' }).trim()).toBe(`WIP: ${taskCode} (builder ran out of time)`);
    execFileSync('git', ['--git-dir', remote, 'merge-base', '--is-ancestor', detail.wip_commit, branch]);
    expect(first.find((x) => x.attempt === 2 && x.stage === 'repo' && x.outcome === 'started')?.detail).toMatchObject({ automatic: true });

    expect(await finished(requestId, 2)).toBe('done');
    expect(calls.prompts).toHaveLength(2);
    expect(calls.prompts[1]).toContain('The previous attempt ran out of time');
    expect(calls.prompts[1]).toContain('- src/half-done.ts');
    expect(calls.prompts[1]).toContain('continue from it');
    expect(calls.opened).toBe(1);
  });

  it('the progress notes are stored in the builder step, never committed (not even as WIP), and handed to the next attempt', async () => {
    const base = fakes({ ciConclusion: 'success', progress: '- done: the share button\n- left: the e2e test\n- failed: the migration, wrong column' });
    let attempt = 0;
    setBuildDeps({
      ...base,
      runBuilder: async (spec, options) => {
        attempt++;
        if (attempt > 1) return (base.runBuilder as NonNullable<BuildDeps['runBuilder']>)(spec, options);
        calls.prompts.push(spec.prompt);
        const dir = options?.worktreePath ?? '';
        mkdirSync(join(dir, 'src'), { recursive: true });
        mkdirSync(join(dir, '.demiurgo'), { recursive: true });
        writeFileSync(join(dir, 'src', 'half-done.ts'), 'export const half = 1;\n');
        writeFileSync(join(dir, '.demiurgo', 'progress.md'), '- done: the share button\n- left: the e2e test\n- failed: the migration, wrong column');
        return { state: 'failure', exitCode: null, durationMs: 1, failureKind: 'timeout', transcriptTail: '', report: null, container: 'fake' };
      },
    });
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('failed:builder');
    const first = (await steps(requestId)).find((x) => x.attempt === 1 && x.stage === 'builder' && x.outcome === 'failed');
    const detail = first?.detail as { progress: string; wip_commit: string; wip_files: string[] };
    expect(detail.progress).toContain('left: the e2e test');
    expect(detail.wip_files).toEqual(['src/half-done.ts']);
    expect(await finished(requestId, 2)).toBe('done');
    expect(calls.prompts[1]).toContain('Progress notes from the previous attempt:\n- done: the share button');
    expect(calls.prompts[0]).not.toContain('Progress notes from the previous attempt');
    const branch = (await db().selectFrom('build_requests').select('branch').where('id', '=', requestId).executeTakeFirstOrThrow()).branch as string;
    expect(git(remote, 'ls-tree', '-r', '--name-only', branch)).not.toContain('progress.md');
    const second = (await steps(requestId)).find((x) => x.attempt === 2 && x.stage === 'builder' && x.outcome === 'ok');
    expect((second?.detail as { progress: string }).progress).toContain('failed: the migration');
  });

  it('the prompt lists the tests that depend on the code to extend', async () => {
    mkdirSync(join(repoDir, 'src', 'lib'), { recursive: true });
    mkdirSync(join(repoDir, 'test'), { recursive: true });
    const word = taskTitle.split(/\s+/).find((w) => w.length > 3) ?? 'recipe';
    writeFileSync(join(repoDir, 'src', 'lib', 'shared.ts'), `export function ${word.toLowerCase().replace(/[^a-z]/g, '')}Helper(input: string) {\n  return input;\n}\n`);
    writeFileSync(join(repoDir, 'test', 'shared.test.ts'), "import { x } from '../src/lib/shared';\nexport const y = x;\n");
    git(repoDir, 'add', 'src', 'test');
    git(repoDir, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'shared helper and its test');
    git(repoDir, 'push', '-q', 'origin', 'main');
    setBuildDeps(fakes({ ciConclusion: 'success' }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('done');
    expect(calls.prompts[0]).toContain('Before finishing, run the tests that depend on what you change: test/shared.test.ts');
  });

  it('a second timeout stops: no third attempt, and the step says the work is on the branch', async () => {
    setBuildDeps(timingOut([1, 2]));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('failed:builder');
    expect(await finished(requestId, 2)).toBe('failed:builder');
    await sleep(300);
    const rows = await steps(requestId);
    const branch = (rows.find((x) => x.stage === 'worktree' && x.outcome === 'ok')?.detail as { branch: string }).branch;
    expect(rows.find((x) => x.attempt === 2 && x.stage === 'builder' && x.outcome === 'failed')?.detail).toMatchObject({ failure_kind: 'timeout', timed_out_twice: true, branch });
    expect(rows.some((x) => x.attempt === 3)).toBe(false);
    await db().updateTable('build_requests').set({ state: 'withdrawn', withdrawn_by: 'human:ana', withdrawn_at: new Date() }).where('id', '=', requestId).execute();
  });

  it('a timeout without changes: nothing to keep and no automatic retry', async () => {
    setBuildDeps(timingOut([1], false));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('failed:builder');
    await sleep(300);
    const rows = await steps(requestId);
    const failed = rows.find((x) => x.stage === 'builder' && x.outcome === 'failed')?.detail as Record<string, unknown>;
    expect(failed).toMatchObject({ failure_kind: 'timeout' });
    expect(failed.wip_commit).toBeUndefined();
    expect(rows.some((x) => x.attempt === 2)).toBe(false);
    await db().updateTable('build_requests').set({ state: 'withdrawn', withdrawn_by: 'human:ana', withdrawn_at: new Date() }).where('id', '=', requestId).execute();
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
          // Like the real runner: a withdrawal during the code map (before the builder starts) is seen too.
          const onAbort = () => {
            aborted = true;
            release();
          };
          if (options?.signal?.aborted) onAbort();
          else options?.signal?.addEventListener('abort', onAbort);
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
  /** The task that waits for `code` to be merged (the planner makes a feature's second task depend on its first). */
  const waitingFor = async (code: string) =>
    (await buildQueue(db(), projectId)).waiting.find((t) => t.reasons.some((r) => r.startsWith(`Waits for ${code} `)))?.code;
  /** A task of the same feature that depends on nothing: ready as soon as the first one is. */
  async function independentTask(sibling: string): Promise<string> {
    const queue = await buildQueue(db(), projectId);
    const like = [...queue.ready, ...queue.waiting].find((t) => t.code === sibling);
    const feature = like?.feature?.code ?? '';
    const created = await cmd('record.create', {
      type: 'task',
      domain: feature.slice(4, 7).toLowerCase(),
      title: 'An independent task',
      sections: [
        { title: 'Goal', content: 'Build another slice.' },
        { title: 'Scope', content: 'Nothing else depends on it.' },
      ],
      size: 'S',
      covers: coversOf.get(sibling) ?? [],
      criteria: [],
      links: [{ type: 'based_on', target: { code: feature, version: 1 } }],
    });
    const made = created.result as { versionId: string; code: string };
    await cmd('record_version.approve', {}, made.versionId);
    coversOf.set(made.code, coversOf.get(sibling) ?? []);
    return made.code;
  }

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
    const [first] = await readyCodes();
    expect(first).toBeDefined();
    const second = await waitingFor(first as string);
    expect(await advanceBuildQueue(environment().services, projectId)).toEqual([]);
    expect(await allRequests()).toEqual([]);

    // A build the person started merges: with the flag off the next ready task is left alone.
    await cmd('build_request.request', { task: first });
    await cmd('build.start', { task: first });
    const request = (await requestsOf(first as string)).find((r) => r.state !== 'withdrawn');
    expect(await finished(request?.id as string, 1)).toBe('done');
    await sleep(400);
    expect(await readyCodes()).toContain(second);
    expect(await allRequests()).toHaveLength(1);
    expect(await autoStatus(db(), projectId, await buildQueue(db(), projectId))).toEqual({ on: false, parallel: 1, building: null, builds: [], next: null, stopped: null });
  });

  it('flag on: the first ready task starts by itself, and when it merges the next one starts', async () => {
    setBuildDeps(queueFakes({ ciConclusion: 'success' }));
    const [first] = await readyCodes();
    const second = await waitingFor(first as string);
    expect(second, 'a task waits for the first').toBeDefined();
    const next = second as string;

    const on = await cmd('build.queue_auto', { on: true }, projectId);
    expect(on.result).toEqual({ on: true, parallel: 1 });
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
    expect(await autoStatus(db(), projectId, await buildQueue(db(), projectId))).toEqual({ on: true, parallel: 1, building: null, builds: [], next: null, stopped: null });
    // Turning it on twice never starts the same task twice.
    expect(await advanceBuildQueue(environment().services, projectId)).toEqual([]);

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
    expect(await advanceBuildQueue(environment().services, projectId)).toEqual([]);
    // Turning the flag off and on again does not skip it either.
    await cmd('build.queue_auto', { on: true }, projectId);
    await sleep(300);
    expect(await allRequests()).toHaveLength(1);
    expect(Math.max(...(await steps(one.id)).map((x) => x.attempt))).toBe(1);
  });

  it('on hold: a held task is not ready and the queue skips it and builds the next one; releasing it brings it back', async () => {
    setBuildDeps(queueFakes({ ciConclusion: 'success' }));
    const [first] = await readyCodes();
    const second = await independentTask(first as string);
    expect(await readyCodes()).toContain(second);
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
    expect(await autoStatus(db(), projectId, await buildQueue(db(), projectId))).toEqual({ on: true, parallel: 1, building: null, builds: [], next: null, stopped: null });
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

  describe('several builds at once', () => {
    /** A builder that waits for `open()`: builds started now stay running until then. */
    function gated(): () => void {
      let open: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        open = resolve;
      });
      const base = queueFakes({ ciConclusion: 'success' });
      setBuildDeps({
        ...base,
        runBuilder: async (spec, options) => {
          await gate;
          return (base.runBuilder as NonNullable<BuildDeps['runBuilder']>)(spec, options);
        },
      });
      return open;
    }
    const requested = async () => (await db().selectFrom('build_requests').innerJoin('records', 'records.id', 'build_requests.task_id').select('records.code').where('build_requests.project_id', '=', projectId).where('build_requests.state', 'in', ['requested', 'in_review', 'done']).execute()).map((r) => r.code).sort();
    const advance = () => advanceBuildQueue(environment().services, projectId);

    /** A ready task of another feature (a new approved feature of the same epic), independent of everything. */
    async function otherFeatureTask(like: string, link?: { type: 'depends_on'; target: { code: string; version: number } }): Promise<{ task: string; feature: string }> {
      const queue = await buildQueue(db(), projectId);
      const featureCode = [...queue.ready, ...queue.waiting].find((t) => t.code === like)?.feature?.code ?? '';
      const own = await db().selectFrom('record_versions').innerJoin('records', 'records.id', 'record_versions.record_id').select(['record_versions.sections']).where('records.project_id', '=', projectId).where('records.code', '=', featureCode).where('record_versions.state', '=', 'approved').executeTakeFirstOrThrow();
      const epic = await db().selectFrom('records').select('code').where('project_id', '=', projectId).where('type', '=', 'epic').executeTakeFirstOrThrow();
      const fdr = (
        await cmd('record.create', {
          type: 'fdr',
          domain: 'other',
          title: 'Another feature',
          sections: own.sections,
          criteria: [{ carry: 'new', title: 'other', statement: 'Given a member, when it submits the form, then it sees the confirmation.', verification: 'automatic', check: 'End to end.' }],
          links: [{ type: 'based_on', target: { code: epic.code, version: 1 } }],
        })
      ).result as { versionId: string; code: string };
      await cmd('record_version.approve', {}, fdr.versionId);
      const ac = await db().selectFrom('criteria').select('code').where('record_version_id', '=', fdr.versionId).execute();
      const created = await cmd('record.create', {
        type: 'task',
        domain: 'other',
        title: 'A task of another feature',
        sections: [
          { title: 'Goal', content: 'Build the other feature.' },
          { title: 'Scope', content: 'Nothing else depends on it.' },
        ],
        size: 'S',
        covers: ac.map((c) => c.code),
        criteria: [],
        links: [{ type: 'based_on', target: { code: fdr.code, version: 1 } }, ...(link ? [link] : [])],
      });
      const made = created.result as { versionId: string; code: string };
      await cmd('record_version.approve', {}, made.versionId);
      coversOf.set(made.code, ac.map((c) => c.code));
      return { task: made.code, feature: fdr.code };
    }

    it('limit 1 (the default) builds one task at a time, as before', async () => {
      const release = gated();
      const [first] = await readyCodes();
      const other = await otherFeatureTask(first as string);
      expect(await readyCodes()).toContain(other.task);
      expect((await cmd('build.queue_auto', { on: true }, projectId)).result).toEqual({ on: true, parallel: 1 });
      await requestFor(first as string);
      await sleep(400);
      expect(await requested()).toEqual([first]);
      expect(await advance()).toEqual([]);
      const status = await autoStatus(db(), projectId, await buildQueue(db(), projectId));
      expect(status).toMatchObject({ parallel: 1, building: first, builds: [first] });
      await cmd('build.queue_auto', { on: false }, projectId);
      release();
      expect(await finished((await requestFor(first as string)).id, 1)).not.toBe('cancelled');
    });

    it('limit 2 starts two independent ready tasks of different features, never two of one feature', async () => {
      const release = gated();
      const [first] = await readyCodes();
      const sibling = await independentTask(first as string);
      const other = await otherFeatureTask(first as string);
      const ready = await readyCodes();
      expect(ready).toEqual(expect.arrayContaining([first, sibling, other.task]));
      expect(ready.indexOf(sibling), 'the sibling comes before the other feature in queue order').toBeLessThan(ready.indexOf(other.task));

      await cmd('build.queue_auto', { parallel: 2 }, projectId);
      await cmd('build.queue_auto', { on: true }, projectId);
      // Earlier tests leave other ready tasks of other features: which of them takes the second place is queue order.
      await until(async () => ((await requested()).length >= 2 ? true : undefined));
      await sleep(400);
      // The sibling is skipped (same feature as the one building); a task of another feature takes the second place.
      const running = await requested();
      expect(running).toHaveLength(2);
      expect(running).toContain(first);
      expect(running).not.toContain(sibling);
      const queue = await buildQueue(db(), projectId);
      const featureOf = (code: string) => queue.ready.find((t) => t.code === code)?.feature?.code;
      expect(new Set(running.map(featureOf)).size).toBe(2);
      expect(await advance()).toEqual([]);
      const status = await autoStatus(db(), projectId, queue);
      expect(status).toMatchObject({ on: true, parallel: 2, stopped: null });
      expect([...status.builds].sort()).toEqual(running);

      // Turning the limit down does not stop what runs.
      const down = await cmd('build.queue_auto', { parallel: 1 }, projectId);
      expect(down.result).toEqual({ on: true, parallel: 1 });
      await sleep(300);
      expect(await requested()).toEqual(running);
      expect((await autoStatus(db(), projectId, await buildQueue(db(), projectId))).builds).toHaveLength(2);
      await cmd('build.queue_auto', { on: false }, projectId);
      release();
      for (const code of running) expect(await finished((await requestFor(code)).id, 1)).not.toBe('cancelled');
    });

    it('a task that depends, directly or through others, on a task being built is never taken', () => {
      const index = {
        tasks: new Map([['C', ['B']], ['B', ['A']], ['F', []]]),
        features: new Map([['D', ['FX']]]),
        featureTasks: new Map([['FX', ['A']]]),
        taskFeature: new Map(),
        titles: new Map(),
        merged: new Map(),
      } as TaskDependencyIndex;
      expect(dependsOnBusy(index, 'C', new Set(['A']))).toBe(true);
      expect(dependsOnBusy(index, 'B', new Set(['A']))).toBe(true);
      expect(dependsOnBusy(index, 'D', new Set(['A']))).toBe(true);
      expect(dependsOnBusy(index, 'C', new Set(['F']))).toBe(false);
      expect(dependsOnBusy(index, 'A', new Set(['A']))).toBe(false);
    });

    it('limit 3 does not start a task that waits for a task of the queue', async () => {
      const release = gated();
      const [first] = await readyCodes();
      const other = await otherFeatureTask(first as string);
      const dependent = await otherFeatureTask(first as string, { type: 'depends_on', target: { code: other.task, version: 1 } });
      expect(await readyCodes()).not.toContain(dependent.task);
      await cmd('build.queue_auto', { parallel: 3 }, projectId);
      await cmd('build.queue_auto', { on: true }, projectId);
      await until(async () => ((await requested()).length >= 3 ? true : undefined));
      await sleep(400);
      expect(await requested()).not.toContain(dependent.task);
      await cmd('build.queue_auto', { on: false }, projectId);
      release();
      for (const code of await requested()) await finished((await requestFor(code)).id, 1);
      await cmd('build.queue_auto', { parallel: 1 }, projectId);
    });

    it('the limit is 1 to 3, only a person sets it, and the journal keeps it', async () => {
      await expect(cmd('build.queue_auto', { parallel: 4 }, projectId)).rejects.toMatchObject({ type: 'validation' });
      await expect(cmd('build.queue_auto', { parallel: 0 }, projectId)).rejects.toMatchObject({ type: 'validation' });
      await expect(cmd('build.queue_auto', {}, projectId)).rejects.toMatchObject({ type: 'validation' });
      await expect(
        executeCommand(environment().services, { command: 'build.queue_auto', actor: system('build', '1'), projectId, entityId: projectId, data: { parallel: 2 } }),
      ).rejects.toMatchObject({ type: 'forbidden' });
      await cmd('build.queue_auto', { parallel: 3 }, projectId);
      const events = await db().selectFrom('events').select(['actor', 'before', 'after']).where('project_id', '=', projectId).where('command', '=', 'build.queue_auto').orderBy('seq').execute();
      expect(events.at(-1)).toMatchObject({ actor: 'human:ana', after: { parallel: 3 } });
      await cmd('build.queue_auto', { parallel: 1 }, projectId);
    });
  });
});

describe('integrate with main before merging, stop the line when main breaks, quarantine flaky tests', () => {
  beforeEach(async () => {
    resetBuildDeps();
    await db().updateTable('build_requests').set({ state: 'withdrawn', withdrawn_by: 'human:ana', withdrawn_at: new Date() }).where('task_id', '=', taskId).where('state', 'in', ['done', 'requested', 'in_review']).execute();
  });

  it('a branch behind main is updated with it, CI runs again on the new head and only then it merges', async () => {
    setBuildDeps(fakes({ ciConclusion: 'success', protection: 'demiurgo', behind: true }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('done');
    expect(calls.updateCalls).toBe(1);
    expect(calls.merges).toBe(1);
    const rows = await steps(requestId);
    expect(rows.find((x) => x.stage === 'merge' && x.outcome === 'waiting' && (x.detail as { updated_from_base?: boolean } | null)?.updated_from_base)?.detail).toMatchObject({ updated_from_base: true, head_sha: UPDATED_SHA });
    expect(rows.filter((x) => x.stage === 'ci' && x.outcome === 'ok').at(-1)?.detail).toMatchObject({ head_sha: UPDATED_SHA, updated_from_base: true });
    // The required statuses are republished on the head that merges.
    expect(calls.statuses.filter((x) => x.sha === UPDATED_SHA).map((x) => `${x.context}:${x.state}`).sort()).toEqual(['demiurgo/design:success', 'demiurgo/review:success']);
    expect((await db().selectFrom('build_requests').select('head_sha').where('id', '=', requestId).executeTakeFirstOrThrow()).head_sha).toBe(UPDATED_SHA);
  });

  it('a branch that is already up to date is not updated', async () => {
    setBuildDeps(fakes({ ciConclusion: 'success', protection: 'demiurgo' }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('done');
    expect(calls.updateCalls).toBe(0);
  });

  it('a conflict with main stops the attempt with the reason and no merge; the next attempt is DEMIURGO\'s own', async () => {
    setBuildDeps(fakes({ ciConclusion: 'success', protection: 'demiurgo', behind: true, updateConflict: true, auto: 0 }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('changes_requested:merge');
    expect(calls.merges).toBe(0);
    const merge = (await steps(requestId)).find((x) => x.stage === 'merge' && x.outcome === 'changes_requested');
    expect(merge?.detail).toMatchObject({ conflict: true, needs_you: true });
    expect(JSON.stringify(merge?.detail)).toContain('The branch conflicts with main: merge conflict between base and head');
  });

  it('with automatic follow-ups, a conflict starts attempt 2 by itself', async () => {
    setBuildDeps(fakes({ ciConclusion: 'success', protection: 'demiurgo', behind: true, updateConflict: true, auto: 1 }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('changes_requested:merge');
    expect(await finished(requestId, 2)).toBe('changes_requested:merge');
    const rows = await steps(requestId);
    expect(rows.find((x) => x.attempt === 1 && x.stage === 'merge')?.detail).toMatchObject({ next_attempt: 2 });
    expect(rows.find((x) => x.attempt === 2 && x.stage === 'repo' && x.outcome === 'started')?.detail).toMatchObject({ automatic: true });
  });

  it('red CI on the head updated from main: no merge, stage ci failed, and its failing tests go to the next attempt', async () => {
    setBuildDeps(fakes({ ciConclusion: 'success', protection: 'demiurgo', behind: true, updatedCi: 'failure', auto: 0 }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('failed:ci');
    expect(calls.merges).toBe(0);
    const rows = await steps(requestId);
    expect(rows.filter((x) => x.stage === 'ci' && x.outcome === 'failed').at(-1)?.detail).toMatchObject({ conclusion: 'failure', head_sha: UPDATED_SHA, updated_from_base: true });
    expect(rows.filter((x) => x.stage === 'evidence' && x.outcome === 'ok').at(-1)?.detail).toMatchObject({ recorded: expect.arrayContaining([expect.objectContaining({ code: codes[0], result: 'fail' })]) });
  });

  it('main red after the merge: the request is done, the main step records the failure and «Build the queue» stops until the person touches it', async () => {
    setBuildDeps(fakes({ ciConclusion: 'success', protection: 'demiurgo', mainConclusion: 'failure' }));
    const set = (at: Date) =>
      sql`insert into build_queue_settings (project_id, auto, parallel, set_by, set_at) values (${projectId}::uuid, true, 1, 'human:ana', ${at.toISOString()}::timestamptz) on conflict (project_id) do update set auto = true, set_at = excluded.set_at`.execute(db());
    await set(new Date(Date.now() - 60_000));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('done');
    const main = (await steps(requestId)).find((x) => x.stage === 'main');
    expect(main).toMatchObject({ outcome: 'failed', detail: { on: 'main', sha: MAIN_SHA, conclusion: 'failure' } });
    expect(JSON.stringify(main?.detail)).toContain(`CI on main is red after merging ${taskCode}`);
    const status = async () => autoStatus(db(), projectId, await buildQueue(db(), projectId));
    expect(await status()).toMatchObject({ on: true, stopped: { code: taskCode, kind: 'main_red' } });
    // The person fixed main and touched the switch afterwards: the line moves again.
    await set(new Date(Date.now() + 1_000));
    expect((await status()).stopped).toBeNull();
    await db().deleteFrom('build_queue_settings').where('project_id', '=', projectId).execute();
  });

  it('main green after the merge: the main step is ok and nothing stops', async () => {
    setBuildDeps(fakes({ ciConclusion: 'success', protection: 'demiurgo', mainConclusion: 'success' }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('done');
    expect((await steps(requestId)).find((x) => x.stage === 'main')).toMatchObject({ outcome: 'ok', detail: { on: 'main', sha: MAIN_SHA } });
  });

  it('a flaky test outside the task\'s criteria is quarantined: it merges, and the Build screen lists it', async () => {
    setBuildDeps(fakes({ ciConclusion: 'success', protection: 'demiurgo', flaky: 'outside', extraCiRun: () => ({ status: 'completed', conclusion: 'failure' }) }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('done');
    expect(calls.merges).toBe(1);
    const rows = await steps(requestId);
    expect(rows.find((x) => x.stage === 'evidence' && x.outcome === 'ok')?.detail).toMatchObject({ flaky: [FLAKY_OUTSIDE], quarantined: [FLAKY_OUTSIDE] });
    expect(rows.filter((x) => x.stage === 'ci' && x.outcome === 'ok').at(-1)?.detail).toMatchObject({ raw_conclusion: 'failure', quarantined: [FLAKY_OUTSIDE] });
    expect(await autoStatus(db(), projectId, await buildQueue(db(), projectId))).toMatchObject({ quarantined: [FLAKY_OUTSIDE] });
  });

  it('a flaky test that covers one of the task\'s own criteria still blocks: the builder must fix it', async () => {
    setBuildDeps(fakes({ ciConclusion: 'success', protection: 'demiurgo', extraCiRun: () => ({ status: 'completed', conclusion: 'failure' }) }));
    const requestId = await newRequest();
    await cmd('build.start', { task: taskCode });
    expect(await finished(requestId, 1)).toBe('changes_requested:merge');
    expect(calls.merges).toBe(0);
    const evidence = (await steps(requestId)).find((x) => x.stage === 'evidence' && x.outcome === 'ok');
    expect(evidence?.detail).toMatchObject({ flaky: expect.arrayContaining([codes[0]]) });
    expect(evidence?.detail).not.toHaveProperty('quarantined');
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
