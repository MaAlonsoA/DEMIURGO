// The durable GitHub build of a task (FDR-BUI-002 and the person's decisions: a private repository
// per project, code written only in an isolated container, an agent as the approver, merge only when
// CI is green). One DBOS workflow per attempt, one step per stage; every stage leaves its build_step
// (started, ok, failed, waiting or changes_requested) through the `build_step.record` command:
//
//   repo → worktree → environment → builder → commit → design → push → pr → status → (ci ∥ review, evidence when CI ends) → publish → merge
//
// CI and the reviewer run in parallel (build/gate.ts): the first rejection ends the attempt, and a review that rejects while CI
// still runs cancels CI.
//
// `environment` prepares the task's environment like the project's CI does (dependencies from the lockfile,
// a database of the project's long-lived CI server, isolated for this build, with its migrations, browsers; see environment.ts) before the agent starts,
// so the agent only does the task. If it fails, the attempt fails with its reason and the agent never runs.
//
// `design` is the deterministic design-system guard (packages/domain/src/design-guard.ts): with an
// approved design system in the worktree's design/design-system/, violations fail the attempt before
// anything is pushed and come back to the next attempt as feedback. Its commit status
// `demiurgo/design` is published in `status`, on the pushed head, next to the pending review status.
//
// `merge` first integrates with the base (Fowler, "Continuous Integration"): a pull request behind main is updated with it
// (GitHub's update-branch), CI runs again on the new head and only a green one merges; a conflict sends the next attempt
// to resolve it. After the merge, CI on main's merge commit is watched (stage `main`): red stops «Build the queue».
// A flaky test outside the task's criteria is quarantined, not blocking (flaky.ts).
//
// A stage that fails stops the attempt. Changes requested (the reviewer's verdict or a red CI) ends it
// too, and the person can press Build again: the next attempt continues on the same branch and pull
// request. When CI is red or the reviewer left a blocking comment, DEMIURGO itself starts the next
// attempts first (up to `autoFollowUps`), and only then leaves it to the person. Waiting (CI, the reviewer, the merge) polls with durable sleeps; the time spent is counted,
// not read from a clock, so a replay decides the same way. The workflow never accepts or ratifies
// anything: it only builds, records evidence and lets GitHub merge once its required checks pass.

import { sql } from 'kysely';
import { DBOS } from '@dbos-inc/dbos-sdk';
import {
  DESIGN_MANIFEST_PATH,
  DESIGN_TOKENS_PATH,
  type DesignManifest,
  type DesignViolation,
  DomainError,
  designGuard,
  formatActor,
  isDomainError,
  system,
} from '@demiurgo/domain';
import { loadAgentCatalog } from '../agents/catalog.ts';
import { resolutionProblem, resolveEngine } from '../assignments/assignments.ts';
import { executeCommand } from '../bus/bus.ts';
import { systemInteraction } from '../engine/observe.ts';
import { engineServices, registerReconciler } from '../engine/registry.ts';
import { buildRunning } from '../commands/build-steps.ts';
import { effectiveBasis } from './basis.ts';
import * as github from '../github/client.ts';
import { ciStatusOf, redactConfigured } from '../github/client.ts';
import { parseJunit } from '../commands/evidence.ts';
import { PASSED_ELSEWHERE_DAYS, ciFeedbackText, type CiFailureDetail } from './ci-feedback.ts';
import { builderContextOf, type BuilderContext } from './context-data.ts';
import { flakyNote, quarantineNote, quarantineOf } from './flaky.ts';
import { classifyBuilderFailure, failureExcerpt } from './failure.ts';
import { automaticCriteriaOf, taskCoversOf } from '../queries/sizes.ts';
import { projectsDir } from '../repo/repo.ts';
import { BUILDER_MAX_TIME_MS, type BuildReport, runBuilder } from '../runner/builder.ts';
import { databaseName, prepareEnvironment, projectSlug, teardownEnvironment } from '../runner/environment.ts';
import { PLAYWRIGHT_CONFIGS, environmentFromCi, startCommandOf, startLine } from './environment.ts';
import { pullRequestFootprint } from './footprint.ts';
import { type OwnershipViolation, checkOwnership, ownershipLine } from './ownership.ts';
import { storeCodeOpinions } from '../classifier/code-rerank.ts';
import { buildEngineMark, cliVersionOf } from '../harness/engine.ts';
import { recordClassifierCall, recordedCall } from '../classifier/calls.ts';
import { type ReusePair, judgeTestReuse, reuseLines, sameFeatureTests } from '../classifier/test-reuse.ts';
import { codeToExtend } from './queue.ts';
import { loadAffectedCriteria, withAffectedTrailer } from './affected-criteria.ts';
import { checkTestGuard, existingTestsLines, readRepoTests, testGuardFeedback } from './test-guard.ts';
import { affectedTests, affectedTestsLine, buildCodeMap } from './code-map.ts';
import { decideRecheck } from './recheck.ts';
import { decideGate } from './gate.ts';
import { approvingReviewOf, previousReviewOf, truncateChanges } from './previous-review.ts';
import { approvedWithFixes, countFixes, countTestMarkers, fixCommentsOf, isTestFile, minorChange, parseHunks, parseNameStatus, parseNumstat } from './lgtm.ts';
import { isTransientRunError, REVIEW_MAX_RETRIES, REVIEW_RETRY_BACKOFF_MS } from './review-retry.ts';
import type { Services } from '../services.ts';
import { checkFixes, diffsByFile } from '../classifier/fix-check.ts';
import { commitAll, headWithWork, commitFiles, unresolvedConflicts, hostPathOf, prepareWorktree, ensureManagedFiles, MANAGED_SELECT_E2E, changedOnBranch, changedWithPending, addedOnBranch, deletedOnBranch, numstatBetween, nameStatusBetween, unifiedZeroBetween, showAt, diffBetween, readWorktreeFile, readWorktreeFiles, removeWorktree } from './workspace.ts';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { accumulateProgress, commitMessageOf, ownProgress, SCREEN_MAX_BYTES, SCREENS_DIR, sameFileList, screensOf } from './progress.ts';
import { type InsistedJev, insistedSignalBefore, insistedTwice, reviewerRepeatedAny } from './insisted.ts';
import { type BuilderSession, builderSessionPlan, sessionFilesExist } from './session.ts';
import { basename, dirname, join } from 'node:path';
import type { DockerExec } from '../runner/environment.ts';
import { type SmokeDetail, type TddDetail, loopRunsOf, mergeBuilderResults, runSmoke, tddFeedbackLines, tddSummary, verifyTdd } from './tdd.ts';

const BUILD = system('build', '1');
const REVIEW_STATUS = 'demiurgo/review';
const DESIGN_STATUS = 'demiurgo/design';
const RETRIES = { retriesAllowed: true, maxAttempts: 3, intervalSeconds: 1 } as const;

export type GithubApi = Pick<
  typeof github,
  | 'ensureProjectRepo'
  | 'pushBranch'
  | 'openPullRequest'
  | 'pullRequest'
  | 'pullRequestFiles'
  | 'pullRequestDiff'
  | 'setCommitStatus'
  | 'postReview'
  | 'enableAutoMerge'
  | 'mergePullRequest'
  | 'checkRunsFor'
  | 'cancelWorkflowRuns'
  | 'rerunCancelledRuns'
  | 'junitArtifactFor'
  | 'closePullRequest'
  | 'deleteBranch'
  | 'behindBy'
  | 'updateBranch'
>;

/** What the flow talks to; the tests replace it (GitHub, the builder container and time). */
export type BuildDeps = {
  github: GithubApi;
  config: () => github.GithubConfig | null;
  runBuilder: typeof runBuilder;
  /** Prepares the CI-like environment before the builder and removes it afterwards (the tests replace both). */
  prepareEnvironment: typeof prepareEnvironment;
  teardownEnvironment: typeof teardownEnvironment;
  /** Runs the containers of the test-driven gate (tdd.ts); the tests replace it. */
  tddExec?: DockerExec;
  /** Durable sleep between polls. */
  sleep: (ms: number) => Promise<void>;
  /** Pause between polls of CI, the reviewer and the merge (5 s: our convention, so a result shows within seconds). */
  pollMs: number;
  /** CI that never completes fails the attempt after this long (2 h). */
  ciTimeoutMs: number;
  /** A pull request with no check named `ci` after this long fails the attempt (15 min). */
  ciAppearMs: number;
  /** A merge that does not happen after this long fails the attempt (24 h). */
  mergeTimeoutMs: number;
  /** A reviewer run that does not finish after this long fails the attempt (1 h). */
  reviewTimeoutMs: number;
  /**
   * How many attempts DEMIURGO starts by itself after the person's one, when CI is red or the reviewer
   * asks for changes with a blocking comment. 15 is the person's decision (01-10): no practical limit on
   * DEMIURGO's own attempts, only a safety cap; the reviewer's needs_person and the escalation rules still
   * stop earlier.
   */
  autoFollowUps: number;
  /** Pause before an automatic retry of a transient builder failure, times the automatic attempts so far (30 s: our convention). */
  transientBackoffMs: number;
};

const defaults = (): BuildDeps => ({
  github,
  config: () => github.githubConfig(),
  runBuilder,
  prepareEnvironment,
  teardownEnvironment,
  sleep: (ms) => DBOS.sleepms(ms),
  pollMs: 5_000,
  ciTimeoutMs: 2 * 3_600_000,
  ciAppearMs: 15 * 60_000,
  mergeTimeoutMs: 24 * 3_600_000,
  reviewTimeoutMs: 3_600_000,
  autoFollowUps: 15,
  transientBackoffMs: 30_000,
});

let deps: BuildDeps = defaults();

/** Only for tests: replaces parts of the dependencies. */
export function setBuildDeps(patch: Partial<BuildDeps>): void {
  deps = { ...deps, ...patch };
}

export function resetBuildDeps(): void {
  deps = defaults();
}

/** The abort controller of each running builder, by build request (a request has one build at a time). */
const builders = new Map<string, AbortController>();
/** The project slug of each build with a prepared environment, so a withdrawal can drop its database. */
const environments = new Map<string, string>();

export const buildWorkflowId = (buildRequestId: string, attempt: number): string => `build:${buildRequestId}:${attempt}`;

/** Automatic retries after a plain builder failure (our convention: one, like a flaky CLI start). */
const BUILDER_AUTO_RETRIES = 1;

type Stage = 'repo' | 'worktree' | 'environment' | 'builder' | 'commit' | 'design' | 'push' | 'pr' | 'status' | 'ci' | 'evidence' | 'review' | 'publish' | 'merge' | 'main';
type Outcome = 'started' | 'ok' | 'failed' | 'waiting' | 'changes_requested' | 'cancelled';

type Run = { projectId: string; requestId: string; attempt: number };
type Extra = { branch?: string; pr_number?: number; head_sha?: string; published_review?: string };

async function record(r: Run, stage: Stage, outcome: Outcome, detail?: Record<string, unknown>, extra: Extra = {}): Promise<void> {
  await executeCommand(engineServices(), {
    command: 'build_step.record',
    actor: BUILD,
    projectId: r.projectId,
    data: { build_request_id: r.requestId, attempt: r.attempt, stage, outcome, ...(detail ? { detail } : {}), ...extra },
  });
}

const messageOf = (e: unknown): string =>
  redactConfigured(isDomainError(e) ? [e.message, ...(e.reasons)].join(' ') : e instanceof Error ? e.message : String(e));

type StageResult<T> = { value?: T; outcome?: 'ok' | 'waiting' | 'failed' | 'changes_requested'; detail?: Record<string, unknown>; extra?: Extra };
type Done<T> = { ok: true; value: T } | { ok: false; outcome: 'failed' | 'changes_requested' };

/**
 * One durable step: records `started`, does the work and records how it ended. An error, or a work
 * that says `failed`, leaves the stage failed and stops the attempt.
 */
async function stage<T>(r: Run, name: Stage, work: () => Promise<StageResult<T>>, opts: { announce?: boolean } = {}): Promise<Done<T>> {
  return DBOS.runStep(
    () =>
      systemInteraction(engineServices(), 'build', async (): Promise<Done<T>> => {
        if (opts.announce !== false) await record(r, name, 'started');
        try {
          const done = await work();
          const outcome = done.outcome ?? 'ok';
          await record(r, name, outcome, done.detail, done.extra);
          return outcome === 'ok' || outcome === 'waiting' ? { ok: true, value: done.value as T } : { ok: false, outcome };
        } catch (e) {
          await record(r, name, 'failed', { error: messageOf(e) });
          return { ok: false, outcome: 'failed' };
        }
      }),
    { name, ...RETRIES },
  );
}

/** A plain step with no stage of its own (polls, small reads). */
function plain<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return DBOS.runStep(() => systemInteraction(engineServices(), 'build', fn), { name, ...RETRIES });
}

type Loaded = {
  requestId: string;
  taskCode: string;
  taskTitle: string;
  brief: string;
  taskVersionId: string;
  branch: string | null;
  prNumber: number | null;
  prUrl: string | null;
  headSha: string | null;
  repoDir: string;
};

async function load(s: Services, r: Run): Promise<Loaded> {
  const q = await s.db
    .selectFrom('build_requests')
    .innerJoin('records', 'records.id', 'build_requests.task_id')
    .select([
      'build_requests.branch',
      'build_requests.pr_number',
      'build_requests.pr_url',
      'build_requests.head_sha',
      'records.code',
    ])
    .where('build_requests.id', '=', r.requestId)
    .executeTakeFirstOrThrow();
  const basis = await effectiveBasis(s.db, r.requestId);
  const version = await s.db.selectFrom('record_versions').select('title').where('id', '=', basis.task_version_id).executeTakeFirstOrThrow();
  const repo = await s.db.selectFrom('project_repos').select('dir').where('project_id', '=', r.projectId).executeTakeFirst();
  const root = projectsDir();
  if (!repo || !root) throw new DomainError('not_found', 'The project has no local repository yet.');
  return {
    requestId: r.requestId,
    taskCode: q.code,
    taskTitle: version.title,
    brief: basis.brief,
    taskVersionId: basis.task_version_id,
    branch: q.branch,
    prNumber: q.pr_number,
    prUrl: q.pr_url,
    headSha: q.head_sha,
    repoDir: join(root, repo.dir),
  };
}

type Feedback = { tdd?: string[]; blocking: string[]; fixes: string[]; failing: string[]; failures: CiFailureDetail[]; design: string[]; ownership: string[]; flaky: string[]; conflicts: string[]; wip?: { sha: string; files: string[] }; progress?: string; history?: string[] };

const NO_FEEDBACK: Feedback = { blocking: [], fixes: [], failing: [], failures: [], design: [], ownership: [], flaky: [], conflicts: [] };

type BuilderStepDetail = { provider?: string; model?: string; session?: { mode: 'fresh' | 'resumed'; id?: string; reason?: string; reason_code?: string; insisted_signal?: string; jev?: InsistedJev }; failure_kind?: string; exit_code?: number | null; wip_commit?: string; wip_files?: string[]; timed_out_twice?: boolean; progress?: string; tdd?: TddDetail };

/** Characters of the builder's progress notes kept and handed to the next attempt (our convention). */
const PROGRESS_MAX_CHARS = 4000;
const PROGRESS_PATH = '.demiurgo/progress.md';

/** The latest failed builder step of an attempt. */
async function failedBuilderStep(s: Services, requestId: string, attempt: number): Promise<BuilderStepDetail | null> {
  const row = await s.db
    .selectFrom('build_steps')
    .select('detail')
    .where('build_request_id', '=', requestId)
    .where('attempt', '=', attempt)
    .where('stage', '=', 'builder')
    .where('outcome', '=', 'failed')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  return (row?.detail as BuilderStepDetail | null | undefined) ?? null;
}

/** The session plan of an attempt from the builder steps (ok or failed) of the earlier attempts of the request. */
async function previousSessionPlan(s: Services, requestId: string, attempt: number, sessionDir: string, engine: { provider: string; model: string }): Promise<BuilderSession & { insisted_signal?: string; jev?: InsistedJev }> {
  if (attempt < 2) return builderSessionPlan([], engine);
  const rows = await s.db
    .selectFrom('build_steps')
    .select('detail')
    .where('build_request_id', '=', requestId)
    .where('attempt', '<', attempt)
    .where('stage', '=', 'builder')
    .where('outcome', 'in', ['ok', 'failed'])
    .orderBy('attempt')
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  // Steps that reused an earlier builder (only the commit had failed) ran no agent: they carry no provider.
  const ran = rows.map((x) => x.detail as BuilderStepDetail | null).filter((x): x is BuilderStepDetail & { provider: string; model: string } => Boolean(x?.provider && x.model));
  const exists = await Promise.all(ran.map((x) => (x.session?.id ? sessionFilesExist(sessionDir, x.session.id) : Promise.resolve(false))));
  // A builder that crashed before writing its session (failure_kind other, seconds after starting) left nothing to
  // continue: the plan continues the latest earlier attempt whose session is still on disk (convención nuestra).
  let end = ran.length;
  while (end > 1 && !exists[end - 1] && exists.slice(0, end - 1).some(Boolean)) end--;
  // An attempt that went round in circles (a commit that changed nothing, the same blocking finding twice) does not continue its session.
  const decision = await insistedSignalBefore(s, requestId, attempt).catch(() => ({ signal: null }) as { signal: null; jev?: InsistedJev });
  const plan = builderSessionPlan(
    ran.slice(0, end).map((x, i) => ({ provider: x.provider, model: x.model, session: x.session, filesExist: i === end - 1 && exists[i] === true })),
    engine,
    decision.signal !== null,
  );
  // What decided it goes to the step detail (the B20 rule splits the forced fresh sessions by signal).
  return { ...plan, ...(plan.reason_code === 'insisted' && decision.signal ? { insisted_signal: decision.signal } : {}), ...(decision.jev ? { jev: decision.jev } : {}) };
}

/** The notes of every earlier attempt of the request (the latest builder step of each, ok or failed), restored into the worktree as `.demiurgo/progress.md`. */
async function restoredProgress(s: Services, requestId: string, attempt: number): Promise<string> {
  if (attempt < 2) return '';
  const rows = await s.db
    .selectFrom('build_steps')
    .select(['attempt', 'detail'])
    .where('build_request_id', '=', requestId)
    .where('attempt', '<', attempt)
    .where('stage', '=', 'builder')
    .where('outcome', 'in', ['ok', 'failed'])
    .orderBy('attempt')
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const byAttempt = new Map<number, string>();
  for (const row of rows) {
    const text = (row.detail as BuilderStepDetail | null)?.progress;
    if (typeof text === 'string' && text.trim()) byAttempt.set(Number(row.attempt), text);
  }
  return accumulateProgress([...byAttempt].map(([n, text]) => ({ attempt: n, text })));
}

/** The files «Code to extend» showed in the latest earlier builder step that recorded it, or null. */
async function previousCodeFiles(s: Services, requestId: string, attempt: number): Promise<string[] | null> {
  if (attempt < 2) return null;
  const rows = await s.db
    .selectFrom('build_steps')
    .select('detail')
    .where('build_request_id', '=', requestId)
    .where('attempt', '<', attempt)
    .where('stage', '=', 'builder')
    .where('outcome', 'in', ['ok', 'failed'])
    .orderBy('attempt', 'desc')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .execute();
  for (const row of rows) {
    const files = (row.detail as { code_to_extend?: { files?: unknown } } | null)?.code_to_extend?.files;
    if (Array.isArray(files)) return files.filter((f): f is string => typeof f === 'string');
  }
  return null;
}

/** Copies the screenshots of the screens folder out of the worktree (it is cleared before the commit) and lists them. */
async function keepScreens(worktree: string, requestId: string, attempt: number): Promise<{ criterion: string; path: string }[]> {
  try {
    const found = screensOf(await readdir(join(worktree, SCREENS_DIR)));
    const root = projectsDir();
    const out: { criterion: string; path: string }[] = [];
    for (const { criterion, file } of found) {
      const from = join(worktree, SCREENS_DIR, file);
      if ((await stat(from)).size > SCREEN_MAX_BYTES) continue;
      const relative = join('.screens', requestId, String(attempt), file);
      if (root) {
        await mkdir(join(root, dirname(relative)), { recursive: true });
        await copyFile(from, join(root, relative));
      }
      out.push({ criterion, path: relative });
    }
    return out;
  } catch {
    return [];
  }
}

/** The Playwright config and package.json of the worktree, for the start command (environment.ts). */
async function startFilesOf(worktree: string): Promise<{ playwrightConfig: string | null; packageJson: string | null }> {
  let playwrightConfig: string | null = null;
  for (const name of PLAYWRIGHT_CONFIGS) {
    playwrightConfig = await readWorktreeFile(worktree, name);
    if (playwrightConfig !== null) break;
  }
  return { playwrightConfig, packageJson: await readWorktreeFile(worktree, 'package.json') };
}

/** The automatic criteria of the project's latest finished task other than this request's (the walking skeleton when it is the first), or []. */
async function previousMergedCriteria(s: Services, projectId: string, requestId: string): Promise<string[]> {
  const row = await s.db
    .selectFrom('build_requests')
    .select('task_id')
    .where('project_id', '=', projectId)
    .where('state', '=', 'done')
    .where('id', '<>', requestId)
    .orderBy('done_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  if (!row) return [];
  return (await automaticCriteriaOf(s.db, projectId, await taskCoversOf(s.db, row.task_id))).automatic;
}

/** The progress notes the builder of an attempt left (ok or failed), or undefined. */
/** The sha of the latest ok commit step of an earlier attempt of the request, or null. */
async function previousCommitSha(s: Services, requestId: string, attempt: number): Promise<string | null> {
  const row = await s.db
    .selectFrom('build_steps')
    .select('detail')
    .where('build_request_id', '=', requestId)
    .where('attempt', '<', attempt)
    .where('stage', '=', 'commit')
    .where('outcome', '=', 'ok')
    .orderBy('attempt', 'desc')
    .orderBy('created_at', 'desc')
    .executeTakeFirst();
  const sha = (row?.detail as { sha?: unknown } | null | undefined)?.sha;
  return typeof sha === 'string' && sha ? sha : null;
}

/** The files changed between two commits of the worktree, or null when git cannot tell (a rewritten branch). */
async function filesBetween(path: string, from: string, to: string): Promise<string[] | null> {
  try {
    const { stdout } = await promisify(execFile)('git', ['-c', 'safe.directory=*', '-C', path, 'diff', '--name-only', from, to], { maxBuffer: 16 * 1024 * 1024 });
    return stdout.split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

async function previousProgress(s: Services, requestId: string, attempt: number): Promise<string | undefined> {
  const row = await s.db
    .selectFrom('build_steps')
    .select('detail')
    .where('build_request_id', '=', requestId)
    .where('attempt', '=', attempt)
    .where('stage', '=', 'builder')
    .where('outcome', 'in', ['ok', 'failed'])
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  const text = (row?.detail as BuilderStepDetail | null | undefined)?.progress;
  return text && text.trim() ? text : undefined;
}

/**
 * The line that lists the tests depending on what this attempt will change: from the top files of «Code to extend»
 * (the predicted touch) and, when the previous attempt's CI had failing tests, from the files the branch changes
 * instead. Best effort: any error gives no line.
 */
async function affectedLine(worktreePath: string, predicted: readonly string[], useBranch: boolean): Promise<string | null> {
  try {
    const branch = useBranch ? await changedOnBranch(worktreePath) : [];
    const files = branch.length > 0 ? branch : predicted.slice(0, 5);
    if (files.length === 0) return null;
    return affectedTestsLine(affectedTests(await buildCodeMap(worktreePath, 'HEAD'), files));
  } catch {
    return null;
  }
}

/** What the previous attempt got wrong: the reviewer's blocking comments and the tests that failed. */
async function feedbackOf(s: Services, r: Run): Promise<Feedback> {
  const review = await s.db
    .selectFrom('pr_reviews')
    .select(['summary', 'comments'])
    .where('build_request_id', '=', r.requestId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  const comments = (review?.comments ?? []) as { path: string; line: number | null; severity: string; body: string; needs_person?: boolean }[];
  const blocking = comments
    .filter((c) => c.severity === 'blocking')
    .map((c) => `${c.needs_person === true ? '[needs the person] ' : ''}${c.path}${c.line ? `:${c.line}` : ''}: ${c.body}`);
  const fixes = fixCommentsOf(comments).map((c) => `${c.path}${c.line ? `:${c.line}` : ''}: ${c.body}`);
  const evidence = await s.db
    .selectFrom('build_steps')
    .select('detail')
    .where('build_request_id', '=', r.requestId)
    .where('stage', '=', 'evidence')
    .where('outcome', '=', 'ok')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  const evidenceDetail = evidence?.detail as { recorded?: { code: string; result: string }[]; failures?: CiFailureDetail[]; flaky?: string[]; quarantined?: string[] } | null;
  const recorded = (evidenceDetail?.recorded ?? []).filter((t) => t.result === 'fail');
  const design = await s.db
    .selectFrom('build_steps')
    .select(['outcome', 'detail'])
    .where('build_request_id', '=', r.requestId)
    .where('stage', '=', 'design')
    .where('outcome', 'in', ['ok', 'failed'])
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  const designDetail = design?.outcome === 'failed' ? (design.detail as { violations?: DesignViolation[]; ownership?: OwnershipViolation[] } | null) : null;
  const violations = designDetail?.violations ?? [];
  const ownership = (designDetail?.ownership ?? []).map(ownershipLine);
  const previous = r.attempt > 1 ? await failedBuilderStep(s, r.requestId, r.attempt - 1) : null;
  const wip = previous?.failure_kind === 'timeout' && previous.wip_commit ? { sha: previous.wip_commit, files: previous.wip_files ?? [] } : undefined;
  // A test-driven check still red when the previous builder stopped (tdd.ts): the failing tests, as the builder was told in its loops.
  const tdd = previous?.failure_kind === 'tdd_red' && previous.tdd ? tddFeedbackLines(previous.tdd) : [];
  const progress = r.attempt > 1 ? await previousProgress(s, r.requestId, r.attempt - 1) : undefined;
  return { blocking, fixes, failing: recorded.map((t) => t.code), failures: evidenceDetail?.failures ?? [], design: violations.map(violationLine), ownership, flaky: (evidenceDetail?.flaky ?? []).filter((c) => !(evidenceDetail?.quarantined ?? []).includes(c)), conflicts: [], ...(wip ? { wip } : {}), ...(progress ? { progress } : {}), ...(tdd.length > 0 ? { tdd } : {}) };
}

const violationLine = (v: DesignViolation): string => `${v.path}${v.line ? `:${v.line}` : ''} (rule ${v.rule}): ${v.message}`;

/** The approved design system as the worktree has it (written by DEMIURGO's sync), or null. */
async function designSystemOf(worktree: string): Promise<{ manifest: DesignManifest; manifestText: string; tokens: unknown; tokensText: string } | null> {
  const manifestText = await readWorktreeFile(worktree, DESIGN_MANIFEST_PATH);
  if (manifestText === null) return null;
  const tokensText = (await readWorktreeFile(worktree, DESIGN_TOKENS_PATH)) ?? '{}';
  return { manifest: JSON.parse(manifestText) as DesignManifest, manifestText, tokens: JSON.parse(tokensText), tokensText };
}

/** Tokens longer than this go into the brief as a path only. */
const TOKENS_INLINE_MAX = 8000;

function designSection(d: { manifest: DesignManifest; manifestText: string; tokensText: string } | null): string[] {
  if (!d) return [];
  return [
    '',
    `# Design system (${d.manifest.version})`,
    `The project has an approved design system: follow the "Design system" rules. Its code lives in ${d.manifest.paths.system}. Do not edit ${DESIGN_MANIFEST_PATH} or ${DESIGN_TOKENS_PATH}.`,
    `## ${DESIGN_MANIFEST_PATH}`,
    d.manifestText.trim(),
    `## ${DESIGN_TOKENS_PATH}`,
    d.tokensText.length <= TOKENS_INLINE_MAX ? d.tokensText.trim() : `(too long to inline: read ${DESIGN_TOKENS_PATH})`,
  ];
}

type PromptParts = { head: string[]; before: string[]; design: string[]; feedback: string[] };

/** The prompt in the order it is sent: head (agent body and brief, or the continuation header), then the sections after the brief. */
function promptParts(
  body: string,
  brief: string,
  attempt: number,
  f: Feedback,
  design: { manifest: DesignManifest; manifestText: string; tokensText: string } | null = null,
  code: string[] = [],
  resumed = false,
  earlier: string[] = [],
): PromptParts {
  // A continued session already has the brief, the design system and its own notes: it only gets what is new.
  const head = resumed
    ? [`# Continue (attempt ${attempt} on the same branch)`, 'You are continuing your previous session on this task: the brief and your earlier work are in this conversation. Read the new feedback below, fix what it names and keep to the same rules and report format.']
    : [body, '', '# Brief', brief];
  const before = [...(code.length > 0 ? ['', ...code] : []), ...(!resumed && earlier.length > 0 ? ['', ...earlier] : [])];
  const lines: string[] = [];
  const progress = resumed ? undefined : f.progress;
  const history = resumed ? [] : (f.history ?? []);
  if (attempt > 1 && (f.wip || f.conflicts.length > 0 || f.blocking.length > 0 || f.fixes.length > 0 || f.failing.length > 0 || f.failures.length > 0 || f.design.length > 0 || f.ownership.length > 0 || f.flaky.length > 0 || progress || history.length > 0 || (f.tdd?.length ?? 0) > 0)) {
    lines.push('', `# Feedback on the previous attempt (this is attempt ${attempt} on the same branch)`);
    if (f.wip) {
      lines.push(
        `The previous attempt ran out of time. Its work is committed on this branch (commit ${f.wip.sha.slice(0, 8)}, "WIP"): continue from it instead of starting over.`,
        ...(f.wip.files.length > 0 ? ['Files in that commit:', ...f.wip.files.map((p) => `- ${p}`)] : []),
        "Finish within the time limit by keeping to the task's scope: do only what its criteria ask.",
      );
    }
    if (progress) lines.push('Progress notes from the previous attempt:', progress.trim(), `(${PROGRESS_PATH} holds the notes of every earlier attempt under "## Attempt N"; add yours under "## Attempt ${attempt}".)`);
    if (f.tdd && f.tdd.length > 0) lines.push(...f.tdd);
    if (history.length > 0) lines.push(...history);
    if (f.conflicts.length > 0) {
      lines.push(
        `The branch conflicts with main: the merge of origin/main into this branch is in progress and these files have conflict markers: ${f.conflicts.join(', ')}.`,
        'Resolve every conflict (keep what both sides intend), remove all markers, and do not abort or redo the merge. Your changes then conclude it.',
        'Dependencies, browsers and migrations were not prepared because the conflicted tree cannot be installed: after resolving, run the install and migrate commands of the CI yourself before running tests.',
      );
    }
    if (f.blocking.length > 0) lines.push('The reviewer asked for these changes:', ...f.blocking.map((b) => `- ${b}`));
    if (f.fixes.length > 0)
      lines.push(
        f.blocking.length > 0
          ? 'The reviewer also left these fixes to make before merging:'
          : 'The reviewer approved with these fixes to make before merging (apply exactly these, nothing else):',
        ...f.fixes.map((b) => `- ${b}`),
      );
    if (f.failures.length > 0) lines.push(...ciFeedbackText(f.failures));
    else if (f.failing.length > 0) lines.push(`The tests of these criteria failed in CI: ${f.failing.join(', ')}.`);
    if (f.flaky.length > 0) lines.push(flakyNote(f.flaky));
    if (f.ownership.length > 0) lines.push('The ownership check failed, fix these:', ...f.ownership.map((v) => `- ${v}`));
    if (f.design.length > 0) lines.push('The design-system check (demiurgo/design) failed, fix these:', ...f.design.map((v) => `- ${v}`));
  } else if (attempt > 1) {
    lines.push('', `# Feedback on the previous attempt (this is attempt ${attempt} on the same branch)`, 'The previous attempt did not merge; check the tests and the review comments on the pull request.');
  }
  return { head, before, design: resumed ? [] : designSection(design), feedback: lines };
}

/** The section headings present in the text the builder was told (`# …` to `### …`), in order: which parts of the context were there. */
export function toldSections(told: string): string[] {
  const headings: string[] = [];
  for (const line of told.split('\n')) {
    const m = /^#{1,3}\s+(.+?)\s*$/.exec(line);
    if (m?.[1] && !headings.includes(m[1])) headings.push(m[1]);
  }
  return headings;
}

/** What the LGTM waiver check decided, for the harness health post-mortem: the rules that failed and Jev's second look. */
function waiverDetail(w: { waive: boolean; failed?: string[]; jev?: string } | null): { rules_failed: string[]; jev: string } {
  return { rules_failed: w?.failed ?? [], jev: w?.jev ?? 'unavailable' };
}

function promptOf(...args: Parameters<typeof promptParts>): string {
  const p = promptParts(...args);
  return [...p.head, ...p.before, ...p.design, ...p.feedback].join('\n');
}

/**
 * What the builder was told beyond the brief (code to extend, earlier context, feedback), as stored for the person to read.
 * A continued session has no brief: its whole prompt is returned. The design system section is replaced by a line (it is
 * the same every attempt and would push the feedback out of the stored text).
 */
export function promptExtras(...args: Parameters<typeof promptParts>): string {
  const p = promptParts(...args);
  if (args[6]) return [...p.head, ...p.before, ...p.feedback].join('\n');
  return [...p.before, ...(p.design.length > 0 ? ['', '# Design system (section omitted here: the project design system, unchanged)'] : []), ...p.feedback].join('\n').replace(/^\n+/, '');
}

const TOLD_MAX = 12000;
const TDD_TOLD_MAX = 4000;
const capTold = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}\n… (truncated)` : text);

const summaryOf = (report: BuildReport | null): string => report?.summary?.trim() || 'No report from the builder.';

function bodyOf(report: BuildReport | null, criteria: string[]): string {
  const tests = report?.tests ?? [];
  const covered = criteria.length > 0 ? criteria : [...new Set(tests.map((t) => t.criterion))];
  return [
    summaryOf(report),
    '',
    '## Criteria covered',
    ...(covered.length > 0 ? covered.map((c) => `- ${c}`) : ['- (the builder reported none)']),
    '',
    "Built by DEMIURGO's builder agent; reviewed by its reviewer agent.",
  ].join('\n');
}

type CiResult = { conclusion: string | null };
type CiWait = { ci: CiResult | null; failure: string | null; kind: 'done' | 'missing' | 'timeout' };

/**
 * Waits (durable polls) for every `ci` check run of a commit to complete: the one wait the `ci` stage, the merge
 * stage after an update from the base and the watch of the base branch after a merge all use. `label` names its
 * steps; `onWaiting` runs once, the first time CI is still pending.
 */
async function waitForCi(
  d: BuildDeps,
  cfg: github.GithubConfig,
  owner: string,
  repoName: string,
  sha: string,
  label: string,
  onWaiting?: () => Promise<void>,
): Promise<CiWait> {
  let waited = 0;
  let announced = false;
  for (;;) {
    const poll = await plain(`${label}-poll`, async () => {
      const checks = await d.github.checkRunsFor(cfg, owner, repoName, sha);
      // Every run named `ci` on this SHA counts (push and pull_request each yield one): all must complete, none may fail.
      const { state, conclusion } = ciStatusOf(checks);
      return { state, conclusion };
    });
    if (poll.state === 'done') return { ci: { conclusion: poll.conclusion }, failure: null, kind: 'done' };
    if (poll.state === 'missing' && waited >= d.ciAppearMs) {
      return { ci: null, failure: 'The project has no CI check named "ci": the walking skeleton task adds it.', kind: 'missing' };
    }
    if (waited >= d.ciTimeoutMs) {
      return { ci: null, failure: `CI did not finish after ${Math.round(d.ciTimeoutMs / 60_000)} minutes.`, kind: 'timeout' };
    }
    if (!announced) {
      announced = true;
      if (onWaiting) await onWaiting();
    }
    await d.sleep(d.pollMs);
    waited += d.pollMs;
  }
}

/** How many attempts in a row DEMIURGO started by itself since the person's last one. */
async function automaticAttempts(s: Services, requestId: string): Promise<number> {
  const started = await s.db
    .selectFrom('build_steps')
    .select(['attempt', 'detail'])
    .where('build_request_id', '=', requestId)
    .where('stage', '=', 'repo')
    .where('outcome', '=', 'started')
    .orderBy('attempt', 'desc')
    .execute();
  let automatic = 0;
  for (const row of started) {
    const detail = row.detail as { automatic?: boolean; lgtm_fixes?: boolean } | null;
    if (detail?.automatic !== true) break;
    // The cheap round of an approval with fixes (no new review) does not use up the automatic follow-ups.
    if (detail.lgtm_fixes === true) continue;
    automatic++;
  }
  return automatic;
}

/** After a failed design stage (design system or ownership): records the automatic next attempt and returns its number, or null. */
async function retryDesign(s: Services, r: Run, limit: number): Promise<number | null> {
  const latest = await s.db
    .selectFrom('build_steps')
    .select((eb) => eb.fn.max('attempt').as('attempt'))
    .where('build_request_id', '=', r.requestId)
    .executeTakeFirst();
  if (Number(latest?.attempt ?? r.attempt) !== r.attempt) return null;
  if ((await automaticAttempts(s, r.requestId)) >= limit) return null;
  const reason = 'The change broke the design-system or ownership guard; a new attempt fixes the violations it was told.';
  await record({ ...r, attempt: r.attempt + 1 }, 'repo', 'started', { started_by: formatActor(BUILD), automatic: true, reason });
  return r.attempt + 1;
}

/** Transient builder failures (the provider's server error, our own container plumbing) are retried more than a plain failure and after a pause (convención nuestra: a start-up flake needs one retry, an outage a few spaced ones). */
const TRANSIENT_BUILDER_RETRIES = 3;
const TRANSIENT_BUILDER_KINDS: readonly string[] = ['provider_error', 'infra'];

/** After a failed builder: records the automatic next attempt and returns its number, or null (no retry). */
async function retryBuilder(s: Services, r: Run, backoffMs = 0): Promise<number | null> {
  const step = (await s.db
    .selectFrom('build_steps')
    .select('detail')
    .where('build_request_id', '=', r.requestId)
    .where('attempt', '=', r.attempt)
    .where('stage', '=', 'builder')
    .where('outcome', '=', 'failed')
    .orderBy('created_at', 'desc')
    .executeTakeFirst()) as { detail: BuilderStepDetail | null } | undefined;
  // A timeout is retried once, and only when its work was kept on the branch (our convention).
  const transient = TRANSIENT_BUILDER_KINDS.includes(step?.detail?.failure_kind ?? '');
  const retryable = transient || step?.detail?.failure_kind === 'other' || step?.detail?.failure_kind === 'tdd_red' || (step?.detail?.failure_kind === 'timeout' && Boolean(step.detail.wip_commit) && !step.detail.timed_out_twice);
  if (!step || !retryable) return null;
  const latest = await s.db
    .selectFrom('build_steps')
    .select((eb) => eb.fn.max('attempt').as('attempt'))
    .where('build_request_id', '=', r.requestId)
    .executeTakeFirst();
  if (Number(latest?.attempt ?? r.attempt) !== r.attempt) return null;
  const automatic = await automaticAttempts(s, r.requestId);
  if (automatic >= (transient ? TRANSIENT_BUILDER_RETRIES : BUILDER_AUTO_RETRIES)) return null;
  // A pause inside the step (not a workflow sleep: that would add an operation to the durable flow), longer with each automatic attempt in a row.
  if (transient && backoffMs > 0) await new Promise((resolve) => setTimeout(resolve, backoffMs * (1 + automatic)));
  const reason =
    transient
      ? `The builder failed for a transient reason (${step.detail?.failure_kind}); trying again after a pause.`
      : step.detail?.failure_kind === 'timeout'
      ? 'The builder ran out of time; its work is committed on the branch and a new attempt continues from it.'
      : step.detail?.failure_kind === 'tdd_red'
        ? 'The tests were still red after the builder was sent back (RED or GREEN); nothing was pushed. A new attempt continues from the work on the branch.'
        : `The builder ended with exit code ${step.detail?.exit_code ?? 'unknown'}; trying once more.`;
  await record({ ...r, attempt: r.attempt + 1 }, 'repo', 'started', { started_by: formatActor(BUILD), automatic: true, reason });
  return r.attempt + 1;
}

/**
 * Resume from the commit stage: the latest earlier attempt ended with the builder ok and a failed
 * commit (nothing else after it), and its worktree is still on disk. Returns the builder's report
 * to reuse, or null (then the attempt runs in full).
 */
async function resumableBuilder(s: Services, r: Run, hasBranch: boolean): Promise<{ report: BuildReport | null; from: number } | null> {
  if (!hasBranch || r.attempt < 2) return null;
  const root = projectsDir();
  if (!root || !existsSync(join(root, '.worktrees', r.requestId))) return null;
  const prior = await s.db
    .selectFrom('build_steps')
    .select((eb) => eb.fn.max('attempt').as('attempt'))
    .where('build_request_id', '=', r.requestId)
    .where('attempt', '<', r.attempt)
    .executeTakeFirst();
  if (prior?.attempt === null || prior?.attempt === undefined) return null;
  const from = Number(prior.attempt);
  const rows = await s.db
    .selectFrom('build_steps')
    .select(['stage', 'outcome', 'detail'])
    .where('build_request_id', '=', r.requestId)
    .where('attempt', '=', from)
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const builder = rows.filter((x) => x.stage === 'builder' && x.outcome === 'ok').at(-1);
  const commits = rows.filter((x) => x.stage === 'commit' && x.outcome !== 'started');
  const last = rows.filter((x) => x.outcome !== 'started').at(-1);
  if (!builder || commits.length === 0 || commits.some((x) => x.outcome === 'ok') || last?.stage !== 'commit' || last.outcome !== 'failed') return null;
  // Resuming only makes sense when the commit itself broke (git, a hook); when the builder left nothing to
  // commit or unresolved conflicts, it is the builder's work that is missing: run it again.
  const failure = last.detail as { error?: string; conflicts?: string[] } | null;
  if (failure?.conflicts || /changed nothing|conflicts unresolved/.test(failure?.error ?? '')) return null;
  return { report: (builder.detail as { report?: BuildReport | null } | null)?.report ?? null, from };
}

/** After a timeout: commits what the builder left as work in progress and pushes the branch; null when there is nothing. */
async function keepWork(
  worktree: { path: string; branch: string },
  info: Loaded,
  github: BuildDeps['github'],
  cfg: github.GithubConfig,
): Promise<{ sha: string; files: string[]; pushError?: string } | null> {
  const sha = await commitAll(worktree.path, `WIP: ${info.taskCode} (builder ran out of time)`).catch(() => null);
  if (!sha) return null;
  const files = await commitFiles(worktree.path, sha).catch(() => []);
  try {
    await github.pushBranch(info.repoDir, worktree.branch, cfg);
    return { sha, files };
  } catch (e) {
    return { sha, files, pushError: messageOf(e) };
  }
}

/** The whole flow of one attempt. Returns how it ended. */
async function buildWorkflow(projectId: string, requestId: string, attempt: number): Promise<string> {
  const r: Run = { projectId, requestId, attempt };
  const d = deps;
  const cfg = d.config();
  if (!cfg) {
    await plain('no-github', () => record(r, 'repo', 'failed', { error: 'Connect GitHub first: set DEMIURGO_GITHUB_TOKEN and DEMIURGO_GITHUB_OWNER.' }));
    return 'failed:repo';
  }
  const s0 = engineServices();
  const info = await plain('load', () => load(s0, r));
  const stop = (name: Stage, outcome: string) => `${outcome}:${name}`;

  // repo (build.start already recorded it as started)
  const repo = await stage(r, 'repo', async () => ({ value: await d.github.ensureProjectRepo(s0.db, projectId, cfg) }), { announce: false });
  if (!repo.ok) return stop('repo', repo.outcome);
  const { owner, repo: repoName } = repo.value;

  // a failed commit after a good builder resumes here, with the same worktree, without the builder
  const resume = await plain('resume-check', () => resumableBuilder(s0, r, Boolean(info.branch)));

  // worktree
  const tree = await stage(r, 'worktree', async () => {
    const w = await prepareWorktree({ repoDir: info.repoDir, taskCode: info.taskCode, buildId: requestId, existingBranch: info.branch, skipIntegrate: resume !== null });
    // The CI paved road: DEMIURGO's own files, rewritten on every build (committed with the task's work).
    await ensureManagedFiles(w.path);
    return { value: w, detail: { branch: w.branch, reused: Boolean(info.branch), ...(w.conflicts ? { conflicts: w.conflicts } : {}) }, extra: { branch: w.branch } };
  });
  if (!tree.ok) return stop('worktree', tree.outcome);
  const worktree = tree.value;

  // environment: what CI would have before the tests run, prepared here so the agent only does the task
  let prepared: { network: string; storeVolume: string; env: Record<string, string> } | null = null;
  const slug = projectSlug(basename(info.repoDir));
  if (!resume) {
    const environment = await stage(r, 'environment', async () => {
      const ciText = await readWorktreeFile(worktree.path, '.github/workflows/ci.yml');
      const ci = ciText === null ? null : environmentFromCi(ciText, await startFilesOf(worktree.path));
      if (!ci) {
        return { value: null, detail: { note: ciText === null ? 'The project has no CI workflow yet: the builder starts without a prepared environment.' : 'The CI workflow has no `ci` job DEMIURGO understands: the builder starts without a prepared environment.' } };
      }
      const control = new AbortController();
      builders.set(requestId, control);
      environments.set(requestId, slug);
      try {
        const open = await s0.db
          .selectFrom('build_requests')
          .select('id')
          .where('project_id', '=', projectId)
          .where('state', 'in', ['requested', 'in_review'])
          .execute();
        // A tree with merge conflict markers cannot be installed (an unresolved package.json is invalid JSON): the services
        // and the database are prepared, and install, browsers and migrate are left to the builder once it has resolved them.
        const conflicted = (worktree.conflicts ?? []).length > 0;
        const result = await d.prepareEnvironment({
          slug,
          id: requestId,
          ci: conflicted ? { ...ci, install: undefined, browsers: undefined, migrate: undefined } : ci,
          worktreeHostPath: hostPathOf(worktree.path),
          keepDatabases: open.map((x) => databaseName(x.id)),
          signal: control.signal,
        });
        if (!result.ok) return { outcome: 'failed' as const, detail: { error: result.reason, failed_step: result.failedStep, ...(ci.start ? { start_command: ci.start } : {}) } };
        // Smoke before the builder: the CI's build and the previous merged task's tests must pass on the tree it starts from.
        // A project failure ends the attempt here; infrastructure trouble is recorded and does not (see `runSmoke`).
        const smoke: SmokeDetail = await (async () => {
          // A branch that already carries the builder's work may be red because of it, and that is what the builder is sent back to fix.
          if (attempt > 1 || info.branch) return { skipped: 'The branch already carries earlier work of this task: the smoke only checks a branch that starts from main.' } as SmokeDetail;
          try {
            const codes = await previousMergedCriteria(s0, projectId, requestId);
            return await runSmoke({ worktreePath: worktree.path, requestId, ciText: ciText as string, codes, prepared: { network: result.network, storeVolume: result.storeVolume, env: result.env }, ...(d.tddExec ? { exec: d.tddExec } : {}), signal: control.signal });
          } catch (e) {
            return { ok: true, commands: [], duration_ms: 0, infra_error: messageOf(e) } as SmokeDetail;
          }
        })();
        const smokeDetail = { smoke, ...(ci.start ? { start_command: ci.start } : {}) };
        if ('ok' in smoke && !smoke.ok) {
          return { outcome: 'failed' as const, detail: { error: `The tree the builder would start from is already red: ${(smoke.failed ?? []).map((f) => f.reason).join(' | ').slice(0, 800)}`, ...smokeDetail } };
        }
        return {
          value: { network: result.network, storeVolume: result.storeVolume, env: result.env },
          detail: {
            ...smokeDetail,
            services: result.services.map((x) => ({ name: x.name, image: x.image, action: x.action })),
            databases: result.databases,
            variables: Object.keys(result.env).sort(),
            steps: result.steps,
            ...(conflicted ? { setup_left_to_builder: worktree.conflicts } : {}),
          },
        };
      } finally {
        if (builders.get(requestId) === control) builders.delete(requestId);
      }
    });
    if (!environment.ok) {
      await plain('environment-teardown', () => d.teardownEnvironment(slug, requestId));
      return stop('environment', environment.outcome);
    }
    prepared = environment.value;
  }

  // builder
  const built = resume
    ? await stage(r, 'builder', async () => ({
        value: { report: resume.report },
        detail: { resumed: true, resumed_from_attempt: resume.from, report: resume.report, note: 'The builder is not run again: the previous attempt built it and only the commit failed.' },
      }))
    : await stage(r, 'builder', async () => {
    const catalog = await loadAgentCatalog();
    const agent = catalog.get('builder');
    if (!agent) throw new DomainError('not_found', 'The builder agent does not exist.');
    const resolution = await resolveEngine(s0.db, s0.providers, { agent: agent.id });
    const problem = resolutionProblem(agent.id, resolution);
    if (problem || resolution.status !== 'ok') throw new DomainError('guard', problem ?? 'The builder has no engine.');
    const feedbackBase = attempt > 1 ? { ...(await feedbackOf(s0, r)), conflicts: worktree.conflicts ?? [] } : NO_FEEDBACK;
    const designSystem = await designSystemOf(worktree.path).catch(() => null);
    // Registered before anything slow, so a withdrawal can already abort this attempt.
    const control = new AbortController();
    builders.set(requestId, control);
    // «Code to extend», computed on the branch this attempt works on (attempt 2 sees its own earlier work); what was shown is kept in the step and per file in task_code_opinions.
    const code = await codeToExtend(s0.db, projectId, info.taskCode, { repoPath: worktree.path, ref: 'HEAD', versionId: info.taskVersionId });
    await storeCodeOpinions(s0.db, { projectId, buildRequestId: requestId, attempt, versionId: info.taskVersionId }, code).catch(() => undefined);
    const affected = await affectedLine(worktree.path, code.files, attempt > 1 && feedbackBase.failing.length > 0);
    // The existing tests of the task's criteria, so the builder extends them (test-guard.ts); help, never a gate.
    const { lines: testLines, reuse: testReuse } = await (async (): Promise<{ lines: string[]; reuse: { criterion: string; path: string; title: string; p: number }[] }> => {
      try {
        const task = { ...(await s0.db.selectFrom('build_requests').select('task_id').where('id', '=', requestId).executeTakeFirstOrThrow()), ...(await effectiveBasis(s0.db, requestId)) };
        const split = await automaticCriteriaOf(s0.db, projectId, await taskCoversOf(s0.db, task.task_id));
        const codes = split.automatic;
        const tests = await readRepoTests(worktree.path, 'HEAD');
        const lines = existingTestsLines(tests, codes);
        if (split.notAutomated.length > 0) lines.push(`Not tested by you: ${split.notAutomated.join(', ')} (checked by a person or at release, not in CI; write no test for them).`);
        // Tests of other criteria that already check something close (Jev, classifier/test-reuse.ts); no section on any failure.
        let reuse: ReusePair[] = [];
        try {
          if (task.feature_version_id && codes.length > 0) {
            const rows = await s0.db.selectFrom('criteria').select(['code', 'statement']).where('record_version_id', '=', task.feature_version_id).where('code', 'in', codes).execute();
            const own = new Set(codes);
            const candidates = sameFeatureTests(codes, [...tests.values()].flat().filter((t) => !own.has(t.criterion))).map((t) => ({ path: t.path, title: t.title, level: t.level }));
            // One row per call, keyed so a replayed attempt does not count it twice (salud-del-harness §6.4).
            reuse = await recordedCall(s0.db, { projectId, question: 'test_reuse', callKey: `test_reuse:${requestId}:${attempt}` }, (note) =>
              judgeTestReuse(null, { criteria: rows.map((c) => ({ code: c.code, statement: c.statement })), candidates }, { onUsage: (n) => note(n) }),
            );
          }
        } catch {
          reuse = [];
        }
        return { lines: [...lines, ...reuseLines(reuse)], reuse: reuse.slice(0, 8).map((x) => ({ criterion: x.criterion, path: x.path, title: x.title, p: Math.round(x.p * 100) / 100 })) };
      } catch {
        return { lines: [], reuse: [] };
      }
    })();
    // The session of this attempt: continued from the previous one or fresh (see `builderSessionPlan`). Its folder is per request and goes with the worktree.
    const sessionDir = join(projectsDir() ?? '', '.sessions', requestId);
    await mkdir(sessionDir, { recursive: true });
    const provider = resolution.provider as 'claude' | 'codex';
    const plan = await previousSessionPlan(s0, requestId, attempt, sessionDir, { provider, model: resolution.model });
    // A continued session already has «Code to extend» in its conversation: it is sent again only when the file list changed since (Anthropic: a resumed session keeps what it read).
    const earlierFiles = plan.mode === 'resumed' ? await previousCodeFiles(s0, requestId, attempt) : null;
    const codeSent = plan.mode !== 'resumed' || earlierFiles === null || !sameFileList(earlierFiles, code.files);
    const codeLines = [...(codeSent ? code.lines : []), ...(affected ? [affected] : []), ...testLines];
    // The earlier attempts' notes go back into the worktree under `## Attempt N`, accumulated and not committed; this attempt adds its own.
    const restored = await restoredProgress(s0, requestId, attempt).catch(() => '');
    if (restored) {
      await mkdir(join(worktree.path, '.demiurgo'), { recursive: true });
      await writeFile(join(worktree.path, PROGRESS_PATH), `${restored}\n`);
    }
    // How to run the app, in one line of the brief (environment.ts).
    const startFiles = await startFilesOf(worktree.path);
    const ciForStart = await readWorktreeFile(worktree.path, '.github/workflows/ci.yml');
    const startCmd = (ciForStart === null ? null : environmentFromCi(ciForStart, startFiles)?.start) ?? startCommandOf(startFiles);
    const briefText = startCmd ? `${info.brief}\n\n${startLine(startCmd)}` : info.brief;
    // Claude takes the id of a new session up front; Codex announces it and the runner reports it back.
    const freshId = plan.mode === 'fresh' && provider === 'claude' ? randomUUID() : undefined;
    const sessionId = plan.mode === 'resumed' ? plan.id : freshId;
    // Everything tried before: earlier attempts (fresh session only), earlier builds of the task and what the reviewer asked on sibling tasks.
    const earlierContext = await (async () => {
      try {
        const task = await s0.db.selectFrom('build_requests').select('task_id').where('id', '=', requestId).executeTakeFirstOrThrow();
        return await builderContextOf(s0.db, { requestId, taskId: task.task_id, attempt, resumed: plan.mode === 'resumed' });
      } catch {
        return { history: [], fresh: [], sections: [] } as BuilderContext;
      }
    })();
    const feedback: Feedback = { ...feedbackBase, history: earlierContext.history };
    const promptArgs = [agent.body, briefText, attempt, feedback, designSystem, codeLines, plan.mode === 'resumed', earlierContext.fresh] as const;
    const builderPrompt = promptOf(...promptArgs);
    const told = capTold(promptExtras(...promptArgs), TOLD_MAX);
    const tddTold: string[] = [];
    const first = await d.runBuilder(
      {
        worktreeHostPath: hostPathOf(worktree.path),
        gitDir: { hostPath: hostPathOf(join(info.repoDir, '.git')), containerPath: join(info.repoDir, '.git') },
        provider,
        model: resolution.model,
        effort: resolution.effort ?? 'medium',
        prompt: builderPrompt,
        session: { mode: plan.mode, ...(sessionId ? { id: sessionId } : {}), hostDir: hostPathOf(sessionDir) },
        maxTimeMs: Math.min(agent.timeLimitSeconds * 1000, BUILDER_MAX_TIME_MS),
        limits: { cpus: 2, memoryMb: 4096, pids: 512 },
        ...(prepared ? { network: prepared.network, storeVolume: prepared.storeVolume, env: prepared.env } : {}),
      },
      { worktreePath: worktree.path, signal: control.signal, containerName: `demiurgo-build-${requestId}` },
    ).finally(async () => {
      if (builders.get(requestId) === control) builders.delete(requestId);
    });
    // Test-driven gate (tdd.ts), before the commit and the push: the task's criterion tests must fail on main (RED) and the
    // selected suite must pass with the change (GREEN); otherwise the builder is sent back in its session (up to TDD_MAX_LOOPS).
    // It runs inside this step, in the builder's environment, so the step order does not change.
    const gate =
      first.state === 'ok' && prepared
        ? await (async () => {
            builders.set(requestId, control);
            try {
              const row = await s0.db.selectFrom('build_requests').select('task_id').where('id', '=', requestId).executeTakeFirstOrThrow();
              const covered = await taskCoversOf(s0.db, row.task_id);
              // Only automatic criteria expect a test; manual and release ones are checked by a person or at release.
              const { automatic: criteria, notAutomated } = await automaticCriteriaOf(s0.db, projectId, covered);
              const affectedBy = await loadAffectedCriteria(s0.db, projectId, { id: row.task_id, versionId: info.taskVersionId }, await changedWithPending(worktree.path).catch(() => [])).catch(() => null);
              return await verifyTdd({
                worktreePath: worktree.path,
                requestId,
                criteria,
                notAutomated,
                affected: affectedBy,
                prepared,
                ...(d.tddExec ? { exec: d.tddExec } : {}),
                signal: control.signal,
                session: first.sessionId ?? sessionId,
                rerun: (prompt, loop, session) => {
                  tddTold.push(capTold(prompt, TDD_TOLD_MAX));
                  return d.runBuilder(
                    {
                      worktreeHostPath: hostPathOf(worktree.path),
                      gitDir: { hostPath: hostPathOf(join(info.repoDir, '.git')), containerPath: join(info.repoDir, '.git') },
                      provider,
                      model: resolution.model,
                      effort: resolution.effort ?? 'medium',
                      prompt,
                      session: { mode: 'resumed', id: session, hostDir: hostPathOf(sessionDir) },
                      maxTimeMs: Math.min(agent.timeLimitSeconds * 1000, BUILDER_MAX_TIME_MS),
                      limits: { cpus: 2, memoryMb: 4096, pids: 512 },
                      network: prepared.network,
                      storeVolume: prepared.storeVolume,
                      env: prepared.env,
                    },
                    { worktreePath: worktree.path, signal: control.signal, containerName: `demiurgo-build-${requestId}-tdd${loop}` },
                  );
                },
              });
            } catch {
              return null;
            } finally {
              if (builders.get(requestId) === control) builders.delete(requestId);
            }
          })()
        : null;
    // Success, failure, timeout or withdrawal: the build's database goes with the attempt (after the gate used it).
    if (prepared) await d.teardownEnvironment(slug, requestId).catch(() => undefined);
    const result = gate ? mergeBuilderResults(first, gate.runs) : first;
    // The progress notes (Anthropic, «Effective harnesses for long-running agents») go to the step and the next attempt's prompt.
    const progressText = ownProgress((await readWorktreeFile(worktree.path, PROGRESS_PATH)) ?? '', restored, PROGRESS_MAX_CHARS);
    // The screenshots the builder left (`.demiurgo/screens/<criterion>.png`) are kept outside the worktree and the commit, listed in the step.
    const screens = await keepScreens(worktree.path, requestId, attempt);
    // The report and the notes are DEMIURGO's, not the project's: they never enter the commit (nor the WIP one).
    // The managed files DEMIURGO ships (the CI selector) stay: they are part of the work.
    for (const entry of await readdir(join(worktree.path, '.demiurgo')).catch(() => [] as string[])) {
      if (join('.demiurgo', entry) !== MANAGED_SELECT_E2E) await rm(join(worktree.path, '.demiurgo', entry), { recursive: true, force: true });
    }
    const failed = result.state !== 'ok';
    const kind = failed
      ? classifyBuilderFailure({ runnerKind: result.failureKind, exitCode: result.exitCode, stderr: result.stderrTail, transcript: result.transcriptTail })
      : null;
    // Out of time: the work in progress is kept on the branch (committed and pushed, no pull request) and
    // the next attempt continues from it.
    const wip = kind === 'timeout' ? await keepWork(worktree, info, d.github, cfg) : null;
    const twice = kind === 'timeout' && attempt > 1 && (await failedBuilderStep(s0, requestId, attempt - 1))?.failure_kind === 'timeout';
    const detail = {
      agent_version: agent.version,
      provider: resolution.provider,
      model: resolution.model,
      engine: buildEngineMark({ provider: resolution.provider, model: resolution.model, modelReported: result.modelReported ?? null, cliVersion: result.cliVersion ?? (await cliVersionOf(resolution.provider)) }),
      session: { mode: plan.mode, ...(result.sessionId ?? sessionId ? { id: result.sessionId ?? sessionId } : {}), reason: plan.reason, reason_code: plan.reason_code, ...(plan.insisted_signal ? { insisted_signal: plan.insisted_signal } : {}), ...(plan.jev ? { jev: plan.jev } : {}) },
      exit_code: result.exitCode,
      ...(result.reattached ? { reattached: true } : {}),
      duration_ms: result.durationMs,
      transcript_tail_length: result.transcriptTail.length,
      ...(result.usage || result.lastTurnInputTokens !== undefined ? { usage: { ...(result.usage ?? {}), ...(result.lastTurnInputTokens !== undefined ? { last_turn_input_tokens: result.lastTurnInputTokens } : {}) } } : {}),
      report: result.report,
      ...(progressText ? { progress: progressText } : {}),
      ...(screens.length > 0 ? { screens } : {}),
      ...(restored ? { progress_restored_chars: restored.length } : {}),
      ...(!codeSent ? { code_to_extend_reused: true } : {}),
      ...(startCmd ? { start_command: startCmd } : {}),
      ...(earlierContext.sections.length > 0 ? { context: earlierContext.sections } : {}),
      ...(testReuse.length > 0 ? { test_reuse: testReuse } : {}),
      ...(code.lines.length > 0 ? { code_to_extend: { commit: code.commit, files: code.files, classifier_id: code.classifier_id, section: codeLines.join('\n') } } : {}),
      effort: resolution.effort ?? 'medium',
      ...(wip ? { wip_commit: wip.sha, wip_files: wip.files, ...(wip.pushError ? { wip_push_error: wip.pushError } : {}) } : {}),
      ...(twice ? { timed_out_twice: true, branch: worktree.branch } : {}),
      told,
      told_sections: toldSections(told),
      ...(tddTold.length > 0 ? { tdd_told: tddTold } : {}),
      ...(gate ? { tdd: gate.runs.length > 0 ? { ...gate.detail, loop_runs: loopRunsOf(gate.runs, gate.failureClasses) } : gate.detail } : {}),
      ...(kind ? { failure_kind: kind, transcript_excerpt: failureExcerpt({ stderr: result.stderrTail, transcript: result.transcriptTail }) } : {}),
    };
    if (failed) {
      return { outcome: 'failed' as const, detail: { ...detail, error: `The builder ended with ${result.failureKind ?? `exit code ${result.exitCode}`}.` } };
    }
    // Still red after the cap (or with no session to resume): nothing is committed or pushed; the next attempt gets the failing tests.
    if (gate?.stopped === 'red') return { outcome: 'failed' as const, detail: { ...detail, failure_kind: 'tdd_red', error: tddSummary(gate.detail) } };
    return { value: { report: result.report }, detail };
  });
  // The builder step tears the environment down itself; this covers a builder that failed before it ran.
  if (prepared) await plain('environment-teardown', () => d.teardownEnvironment(slug, requestId));
  if (!built.ok) {
    // A plain failure (the CLI exited with an error, nothing more specific) gets one automatic retry before
    // it stops; a usage limit, a login problem or a timeout would only fail again (our convention).
    const next = built.outcome === 'failed' ? await plain('builder-retry', () => retryBuilder(s0, r, d.transientBackoffMs)) : null;
    if (next !== null) await DBOS.startWorkflow(buildWorkflowRegistered, { workflowID: buildWorkflowId(requestId, next) })(projectId, requestId, next);
    return stop('builder', built.outcome);
  }
  const report = built.value.report;

  // commit
  const committed = await stage(r, 'commit', async () => {
    const conflicted = await unresolvedConflicts(worktree.path);
    if (conflicted.length > 0) {
      return { outcome: 'failed' as const, detail: { error: `The builder left merge conflicts unresolved in: ${conflicted.join(', ')}.`, conflicts: conflicted } };
    }
    // The criteria this PR affects, as a trailer so CI runs only their tests on the PR (affected-criteria.ts). Fail safe: none.
    const taskRow = await s0.db.selectFrom('build_requests').select('task_id').where('id', '=', requestId).executeTakeFirst().catch(() => undefined);
    const affected = taskRow ? await loadAffectedCriteria(s0.db, projectId, { id: taskRow.task_id, versionId: info.taskVersionId }, await changedWithPending(worktree.path).catch(() => [])) : null;
    const fresh = await commitAll(worktree.path, withAffectedTrailer(commitMessageOf(`${info.taskCode}: ${info.taskTitle}`, report?.summary), affected));
    const sha = fresh ?? (await headWithWork(worktree.path));
    if (!sha) return { outcome: 'failed' as const, detail: { error: 'The builder changed nothing: there is nothing to commit.' } };
    // The files the branch really changes, for the queue planner (it collides running builds by these, not by the prediction).
    const files = (await changedOnBranch(worktree.path).catch(() => [] as string[])).slice(0, 300);
    // What this attempt itself changed since the previous attempt's commit (the harness post-mortem judges review
    // comments against it; `files` is the whole branch against main). The first attempt changed the whole branch.
    const previousSha = r.attempt > 1 ? await previousCommitSha(s0, requestId, r.attempt) : null;
    const ownFiles = previousSha ? await filesBetween(worktree.path, previousSha, sha) : files;
    return { value: sha, detail: { sha, ...(files.length > 0 ? { files } : {}), ...(ownFiles ? { own_files: ownFiles.slice(0, 300) } : {}), ...(fresh && affected ? { affected_criteria: affected } : {}) }, extra: { head_sha: sha } };
  });
  if (!committed.ok) return stop('commit', committed.outcome);
  const headSha = committed.value;

  // design: the deterministic design-system guard; no approved system yet means nothing to check
  const designed = await stage(r, 'design', async () => {
    // Ownership: what the branch adds must not belong to another feature (ownership.ts). Best effort: an error checks nothing.
    const ownership = await checkOwnership(s0.db, projectId, info.taskCode, {
      paths: await addedOnBranch(worktree.path),
      deleted: await deletedOnBranch(worktree.path),
      read: (file) => readWorktreeFile(worktree.path, file),
      repoDir: info.repoDir,
    }).catch(() => [] as OwnershipViolation[]);
    const ownershipText = ownership.length > 0 ? `${ownership.length} ownership ${ownership.length === 1 ? 'violation' : 'violations'}: ${ownership.slice(0, 5).map(ownershipLine).join(' | ')}` : null;
    // Test guard: no second test for a criterion that already has one (test-guard.ts). Fail safe: it passes when it cannot compute.
    const testGuard = await checkTestGuard(worktree.path);
    const testGuardRecord = testGuard.skipped ? { skipped: testGuard.skipped } : { violations: testGuard.violations.length };
    const testGuardText = testGuard.violations.length > 0 ? `${testGuard.violations.length} duplicate ${testGuard.violations.length === 1 ? 'test' : 'tests'}: ${testGuardFeedback(testGuard.violations.slice(0, 5)).join(' | ')}` : null;
    const ownershipError = [ownershipText, testGuardText].filter(Boolean).join(' | ') || null;
    const approved = await designSystemOf(worktree.path);
    if (!approved) {
      if (ownershipError) return { outcome: 'failed' as const, detail: { violations: [], ownership, test_guard: testGuardRecord, error: ownershipError } };
      return { value: { note: 'no design system yet' }, detail: { note: 'no design system yet', violations: [], ownership, test_guard: testGuardRecord } };
    }
    const keep = (file: string) => /\.(css|scss|html|jsx|tsx|vue|svelte)$/.test(file) || file.endsWith('/tokens.json') || file === 'tokens.json';
    const files = await readWorktreeFiles(worktree.path, keep);
    const result = designGuard(files, approved.manifest, approved.tokens);
    const detail = { version: approved.manifest.version, checked: files.length, violations: result.violations, ownership, test_guard: testGuardRecord };
    if (!result.ok || ownershipError) {
      const designError = result.ok ? null : `${result.violations.length} design-system ${result.violations.length === 1 ? 'violation' : 'violations'}: ${result.violations.slice(0, 5).map(violationLine).join(' | ')}`;
      return { outcome: 'failed' as const, detail: { ...detail, error: [designError, ownershipError].filter(Boolean).join(' | ') } };
    }
    return { value: { note: `Uses the approved design system ${approved.manifest.version}.` }, detail };
  });
  if (!designed.ok) {
    // A design-system or ownership violation is the builder's to fix: the next attempt gets the violations as
    // feedback (feedbackFor) and starts on its own, up to `autoFollowUps` like any other fixable stop.
    const next = designed.outcome === 'failed' ? await plain('design-retry', () => retryDesign(s0, r, d.autoFollowUps)) : null;
    if (next !== null) await DBOS.startWorkflow(buildWorkflowRegistered, { workflowID: buildWorkflowId(requestId, next) })(projectId, requestId, next);
    return stop('design', designed.outcome);
  }
  const designNote = designed.value.note;

  // push
  const pushed = await stage(r, 'push', async () => {
    await d.github.pushBranch(info.repoDir, worktree.branch, cfg);
    return { value: true, detail: { branch: worktree.branch } };
  });
  if (!pushed.ok) return stop('push', pushed.outcome);

  // pr
  const pr = await stage(r, 'pr', async () => {
    if (info.prNumber && info.prUrl) {
      const previous = await s0.db
        .selectFrom('build_steps')
        .select('detail')
        .where('build_request_id', '=', requestId)
        .where('stage', '=', 'pr')
        .where('outcome', '=', 'ok')
        .orderBy('created_at', 'desc')
        .orderBy('id', 'desc')
        .executeTakeFirst();
      const nodeId = (previous?.detail as { node_id?: string } | null)?.node_id ?? null;
      return {
        value: { number: info.prNumber, url: info.prUrl, nodeId },
        detail: { pr_url: info.prUrl, number: info.prNumber, node_id: nodeId, reused: true },
        extra: { head_sha: headSha },
      };
    }
    const covers = await s0.db
      .selectFrom('build_requests')
      .select('task_id')
      .where('id', '=', requestId)
      .executeTakeFirstOrThrow();
    const criteria = await taskCoversOf(s0.db, covers.task_id);
    const opened = await d.github.openPullRequest(cfg, {
      owner,
      repo: repoName,
      head: worktree.branch,
      title: `${info.taskCode} ${info.taskTitle}`,
      body: bodyOf(report, criteria),
    });
    await executeCommand(s0, { command: 'build_request.submit_review', actor: BUILD, projectId, entityId: requestId, data: { pr_url: opened.url } });
    return {
      value: { number: opened.number, url: opened.url, nodeId: opened.nodeId },
      detail: { pr_url: opened.url, number: opened.number, node_id: opened.nodeId },
      extra: { pr_number: opened.number, head_sha: headSha },
    };
  });
  if (!pr.ok) return stop('pr', pr.outcome);
  const pull = pr.value;

  // status: the required review check stays pending until the reviewer has spoken
  const pending = await stage(r, 'status', async () => {
    await d.github.setCommitStatus(cfg, owner, repoName, headSha, {
      context: REVIEW_STATUS,
      state: 'pending',
      description: "Waiting for CI and for DEMIURGO's reviewer agent.",
      target_url: pull.url,
    });
    // The design check already passed before the push (a failure stops the attempt first): the
    // required status goes on the pushed head, with or without an approved design system.
    await d.github.setCommitStatus(cfg, owner, repoName, headSha, {
      context: DESIGN_STATUS,
      state: 'success',
      description: designNote.charAt(0).toUpperCase() + designNote.slice(1),
      target_url: pull.url,
    });
    return { value: true };
  });
  if (!pending.ok) return stop('status', pending.outcome);

  // ci and review run in parallel (Software Engineering at Google, ch. 19 "Critique": presubmit results show beside the
  // review; see build/gate.ts). CI is already running on the pushed head; the reviewer starts now, without waiting for it.
  // Same step as before (a replay stays deterministic): a head whose CI an earlier attempt cancelled gets it re-run.
  await plain('ci-start', async () => {
    const rerun = await d.github.rerunCancelledRuns(cfg, owner, repoName, headSha).catch(() => 0);
    await record(r, 'ci', 'started', rerun > 0 ? { rerun_cancelled: rerun } : undefined);
  });

  // evidence (of a head SHA; again after the branch is updated from the base)
  const gatherEvidence = (sha: string) => stage(r, 'evidence', async () => {
    const junit = await d.github.junitArtifactFor(cfg, owner, repoName, sha);
    if (!junit) return { value: { tests: [] as { code: string; result: 'pass' | 'fail' }[], flaky: [] as string[], quarantined: [] as string[], forgiven: false }, detail: { note: 'The CI run has no artifact named "junit": no evidence recorded.', recorded: [] } };
    const taskRow = await s0.db.selectFrom('build_requests').select('task_id').where('id', '=', requestId).executeTakeFirstOrThrow();
    // Only automatic criteria expect a test in CI (manual and release ones are checked by a person or at release).
    const covers = (await automaticCriteriaOf(s0.db, projectId, await taskCoversOf(s0.db, taskRow.task_id))).automatic;
    // The ids the test history needs (salud-del-harness §6.5): inputs of this stage, not steps. The workflow run is the
    // latest one that produced a `ci` check of the SHA (the artifact concatenates every run); none when GitHub does not say.
    const ciRunId = await d.github
      .checkRunsFor(cfg, owner, repoName, sha)
      .then((checks) => checks.filter((c) => c.name === 'ci').map((c) => github.workflowRunIdOf(c.detailsUrl)).filter((id): id is string => id !== null).sort((a, b) => Number(a) - Number(b)).at(-1))
      .catch(() => undefined);
    const done = await executeCommand(s0, {
      command: 'evidence.ingest_junit',
      actor: BUILD,
      projectId,
      data: { junit, pr_url: pull.url, reference: sha, expected: covers, build_request_id: requestId, attempt, ...(ciRunId ? { ci_run_id: ciRunId } : {}) },
    });
    const result = done.result as { recorded: { code: string; result: 'pass' | 'fail'; tests: number }[]; unknown: string[]; ignored: number; not_run: string[]; not_automated?: string[]; flaky: string[]; failures: { code: string | null; test: string; file: string | null; message: string }[] };
    // A test that failed in every run it ran in is a real failure; only the ones that passed somewhere are flaky.
    const outcomes = new Map<string, Set<string>>();
    for (const t of parseJunit(junit)) outcomes.set(t.name, (outcomes.get(t.name) ?? new Set()).add(t.outcome));
    const stableFailures = [...outcomes.values()].filter((o) => o.has('fail') && !o.has('pass')).length;
    const quarantine = quarantineOf({ flaky: result.flaky, covers, stableFailures });
    // Did each failing test pass on other commits lately? (the ingest above already stored this commit's rows)
    const failures: CiFailureDetail[] = [];
    for (const f of result.failures ?? []) {
      const row = await s0.db
        .selectFrom('test_runs')
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .where('project_id', '=', projectId)
        .where('test_name', '=', f.test.slice(0, 1000))
        .where('outcome', '=', 'pass')
        .where('head_sha', 'is distinct from', sha)
        .where(sql<boolean>`recorded_at > now() - make_interval(days => ${PASSED_ELSEWHERE_DAYS})`)
        .executeTakeFirst();
      failures.push({ ...f, passed_elsewhere: Number(row?.n ?? 0) });
    }
    return {
      value: { tests: result.recorded.map((t) => ({ code: t.code, result: t.result })), flaky: result.flaky, quarantined: quarantine.quarantined, forgiven: quarantine.forgiven },
      detail: {
        recorded: result.recorded,
        ...(failures.length > 0 ? { failures } : {}),
        unknown: result.unknown,
        ignored: result.ignored,
        not_run: result.not_run,
        ...((result.not_automated ?? []).length > 0 ? { not_automated: result.not_automated } : {}),
        flaky: result.flaky,
        ...(quarantine.quarantined.length > 0 ? { quarantined: quarantine.quarantined } : {}),
      },
    };
  });
  // review: the pack says CI runs in parallel and is checked by DEMIURGO on its own (the reviewer never judges it).
  // The start is a function so a transient provider failure can request the same review again.
  const startReview = async (): Promise<string> => {
    const diff = await d.github.pullRequestDiff(cfg, owner, repoName, pull.number);
    // Incremental re-review: the earlier request_changes review and what changed since its head. Best effort.
    const previous = attempt > 1 ? await previousReviewOf(s0.db, requestId, headSha).catch(() => null) : null;
    const since = previous ? await diffBetween(worktree.path, previous.head_sha, headSha).then(truncateChanges).catch(() => null) : null;
    let waitedForGraph = 0;
    for (;;) {
      try {
        const run = await executeCommand(s0, {
          command: 'run.request',
          actor: BUILD,
          projectId,
          data: {
            action: 'pr_review',
            scope: { type: 'build_request', id: requestId },
            input: { diff, pr_url: pull.url, ci: { parallel: true }, ...(previous ? { previous_review: previous } : {}), ...(since !== null ? { changes_since_previous_review: since } : {}) },
          },
        });
        return run.entityId;
      } catch (e) {
        // The graph is being updated: the reviewer's context waits for it.
        if (!isDomainError(e) || e.type !== 'guard' || waitedForGraph >= d.reviewTimeoutMs) throw e;
        await new Promise((resolve) => setTimeout(resolve, Math.min(d.pollMs, 1000)));
        waitedForGraph += Math.min(d.pollMs, 1000);
      }
    }
  };
  // LGTM with comments: the previous attempt approved with fixes. The review is not requested again when this attempt only
  // touched the files the fixes name (see build/lgtm.ts). The lookup reads immutable rows of the previous attempt; the git
  // comparison is its own checkpointed step, taken only on this path (an attempt in flight never takes it).
  const approving = attempt > 1 ? await approvingReviewOf(s0.db, requestId, attempt).catch(() => null) : null;
  const waiver = approving
    ? await plain('lgtm-waiver', async () => {
        try {
          const from = approving.head_sha;
          const fixes = fixCommentsOf(approving.comments).map((c) => ({ path: c.path, line: c.line }));
          const numstat = parseNumstat(await numstatBetween(worktree.path, from, headSha));
          const nameStatus = parseNameStatus(await nameStatusBetween(worktree.path, from, headSha));
          const hunks = parseHunks(await unifiedZeroBetween(worktree.path, from, headSha));
          const testCounts: Record<string, { before: ReturnType<typeof countTestMarkers>; after: ReturnType<typeof countTestMarkers> }> = {};
          for (const row of nameStatus.filter((n) => isTestFile(n.path))) {
            testCounts[row.path] = { before: countTestMarkers(await showAt(worktree.path, from, row.path)), after: countTestMarkers(await showAt(worktree.path, headSha, row.path)) };
          }
          const { minor, failed } = minorChange({ fixes, numstat, nameStatus, hunks, testCounts });
          let jev: 'ok' | 'refused' | 'unavailable' = 'unavailable';
          let waive = minor;
          if (minor) {
            // Jev's second look (classifier/fix-check.ts): per fix, is it mechanical and does the diff do exactly what it asks.
            const diffs = diffsByFile(await diffBetween(worktree.path, from, headSha));
            const fixCheckStarted = Date.now();
            const verdict = await checkFixes({
              fixes: fixCommentsOf(approving.comments).map((c) => ({ path: c.path, line: c.line, comment: c.body, diff: diffs[c.path.replace(/^\.\//, '')] ?? '' })),
            });
            if (verdict) await recordClassifierCall(s0.db, { projectId, question: 'fix_check', callKey: `fix_check:${requestId}:${attempt}`, inputTokens: verdict.usage.input_tokens, durationMs: Date.now() - fixCheckStarted, outcome: 'ok' });
            if (verdict) {
              jev = verdict.ok ? 'ok' : 'refused';
              if (!verdict.ok) {
                waive = false;
                failed.push(...verdict.failed);
              }
            }
          }
          return { waive, failed, jev };
        } catch {
          return { waive: false, failed: ['git_comparison_failed'] };
        }
      })
    : null;
  const waived = approving !== null && waiver?.waive === true;
  const requested = waived
    ? await stage(r, 'review', async () => ({
        value: { runId: '' },
        detail: { waived: 'lgtm_with_comments', approved_review_id: approving.id, waiver: waiverDetail(waiver) },
      }))
    : await stage(
        r,
        'review',
        async () => {
          const id = await startReview();
          return {
            value: { runId: id },
            detail: { run_id: id, ci: 'parallel', ...(waiver && !waiver.waive ? { waiver_refused: (waiver.failed ?? ['files_outside_fixes']).join(', '), waiver: waiverDetail(waiver) } : {}) },
            outcome: 'waiting' as const,
          };
        },
        { announce: true },
      );
  if (!requested.ok) return stop('review', requested.outcome);
  let runId = requested.value.runId;
  let reviewRetries = 0;

  // The parallel wait. Every poll is a durable step (its result is checkpointed), and waiting is counted, not read from a
  // clock, so after a restart the replay returns the same snapshots and decides the same way; the rows (`ci` and `review`
  // waiting, then their results) are the recorded state. The first rejection ends the attempt.
  type Verdict = { id: string; verdict: string; summary: string; comments: { path: string; line: number | null; severity: string; body: string; needs_person?: boolean }[] };
  let waited = 0;
  let ciAnnounced = false;
  let rawConclusion: string | null = null;
  let ciDone = false;
  let ciCancelled = false;
  let conclusion: string | null = null;
  let quarantined: string[] = [];
  let evidenceValue = { tests: [] as { code: string; result: 'pass' | 'fail' }[], flaky: [] as string[], quarantined: [] as string[], forgiven: false };
  let reviewState: 'pending' | 'approved' | 'rejected' | 'failed' = waived ? 'approved' : 'pending';
  let reviewVerdict: Verdict | null = waived && approving ? { id: approving.id, verdict: 'approve', summary: approving.summary, comments: approving.comments } : null;
  let runState = 'queued';
  let gate = decideGate({ ci: 'pending', review: 'pending' });
  /** CI of this head is cancelled once the review rejects first: its result no longer matters to this attempt. */
  const cancelCi = async (reason: string): Promise<void> => {
    if (ciDone) return;
    ciCancelled = true;
    await plain('ci-cancel', async () => {
      let cancelled = 0;
      let cancelError: string | undefined;
      try {
        cancelled = await d.github.cancelWorkflowRuns(cfg, owner, repoName, headSha);
      } catch (e) {
        cancelError = messageOf(e);
      }
      // `failed` with the conclusion GitHub gives a cancelled run (not the `cancelled` outcome, which ends the attempt for buildRunning).
      await record(r, 'ci', 'failed', { conclusion: 'cancelled', cancelled: true, reason, runs_cancelled: cancelled, head_sha: headSha, ...(cancelError ? { cancel_error: cancelError } : {}) });
    });
  };
  for (;;) {
    const snap = await plain('gate-poll', async () => {
      const checks = ciDone ? null : await d.github.checkRunsFor(cfg, owner, repoName, headSha);
      const { state, conclusion: raw } = checks === null ? { state: 'done' as const, conclusion: rawConclusion } : ciStatusOf(checks);
      // The timings of the CI runs (salud-del-harness §6.6): new keys of this step's result; snapshots recorded before have none.
      const timings = checks !== null && state === 'done' ? github.ciTimingsOf(checks) : undefined;
      // A waived review has no run: the approving review already stands.
      if (waived) return { ci: { state, conclusion: raw, timings }, run: 'ended', ended: false, verdict: null, error: null };
      const run = await s0.db.selectFrom('ai_runs').select(['state', 'error']).where('id', '=', runId).executeTakeFirstOrThrow();
      const ended = !['queued', 'running'].includes(run.state);
      const row = ended
        ? await s0.db.selectFrom('pr_reviews').select(['id', 'verdict', 'summary', 'comments']).where('run_id', '=', runId).executeTakeFirst()
        : undefined;
      const found: Verdict | null = row ? { id: row.id, verdict: row.verdict, summary: row.summary, comments: row.comments as Verdict['comments'] } : null;
      return { ci: { state, conclusion: raw, timings }, run: run.state, ended, verdict: found, error: ended && !found ? (run.error ?? null) : null };
    });
    runState = snap.run;

    // CI finished: its row, then the evidence of its JUnit report and the flaky quarantine, as soon as it is known.
    if (!ciDone && snap.ci.state === 'done') {
      ciDone = true;
      rawConclusion = snap.ci.conclusion;
      const ciTimings = snap.ci.timings;
      await plain('ci-done', () =>
        record(r, 'ci', rawConclusion === 'success' ? 'ok' : 'failed', {
          conclusion: rawConclusion,
          head_sha: headSha,
          ...(ciTimings?.run_id ? { run_id: ciTimings.run_id } : {}),
          ...(ciTimings?.queued_at ? { queued_at: ciTimings.queued_at } : {}),
          ...(ciTimings?.started_at ? { started_at: ciTimings.started_at } : {}),
          ...(ciTimings?.completed_at ? { completed_at: ciTimings.completed_at } : {}),
        }),
      );
      const evidence = await gatherEvidence(headSha);
      if (!evidence.ok) return stop('evidence', evidence.outcome);
      evidenceValue = evidence.value;
      // Quarantine: a red CI explained only by flaky tests outside this task's criteria does not block this pull request.
      quarantined = rawConclusion !== 'success' && evidence.value.forgiven ? [...evidence.value.quarantined] : [];
      conclusion = quarantined.length > 0 ? 'success' : rawConclusion;
      if (quarantined.length > 0) {
        await plain('ci-quarantined', () =>
          record(r, 'ci', 'ok', { conclusion: 'success', raw_conclusion: rawConclusion, head_sha: headSha, quarantined, note: quarantineNote(quarantined) }),
        );
      }
    }

    // The reviewer spoke (or its run ended without a verdict, or took too long): its row, as soon as it is known.
    if (reviewState === 'pending' && (snap.ended || waited >= d.reviewTimeoutMs)) {
      reviewVerdict = snap.verdict;
      // A run that ended without a verdict for a passing provider reason is requested again, with backoff and CI left running.
      if (!reviewVerdict && snap.ended && reviewRetries < REVIEW_MAX_RETRIES && isTransientRunError(snap.error)) {
        const previousRunId = runId;
        const retry = reviewRetries + 1;
        const backoff = REVIEW_RETRY_BACKOFF_MS[reviewRetries] ?? REVIEW_RETRY_BACKOFF_MS[REVIEW_RETRY_BACKOFF_MS.length - 1] ?? 120_000;
        await d.sleep(backoff);
        waited += backoff;
        const again = await plain(`review-retry-${retry}`, async () => {
          try {
            const id = await startReview();
            await record(r, 'review', 'waiting', { retry, previous_run_id: previousRunId, previous_error: redactConfigured(snap.error ?? '').slice(0, 500), run_id: id });
            return { runId: id, error: null };
          } catch (e) {
            return { runId: null, error: messageOf(e) };
          }
        });
        if (again.runId) {
          reviewRetries = retry;
          runId = again.runId;
          runState = 'queued';
          continue;
        }
        await plain(`review-retry-${retry}-failed`, () => record(r, 'review', 'failed', { run_id: previousRunId, error: `Could not request the review again: ${again.error}` }));
        reviewState = 'failed';
        gate = decideGate({ ci: 'pending', review: 'failed' });
        break;
      }
      if (!reviewVerdict) {
        reviewState = 'failed';
        await plain('review-failed', () =>
          record(r, 'review', 'failed', { run_id: runId, error: snap.ended ? `The reviewer's run ended ${runState} without a verdict.` : `The reviewer's run did not finish after ${Math.round(d.reviewTimeoutMs / 60_000)} minutes.` }),
        );
      } else {
        const v = reviewVerdict;
        reviewState = v.verdict === 'approve' ? 'approved' : 'rejected';
        await plain('review-ok', () =>
          record(r, 'review', v.verdict === 'approve' ? 'ok' : 'changes_requested', { run_id: runId, verdict: v.verdict, comments_count: v.comments.length }),
        );
      }
    }

    gate = decideGate({ ci: !ciDone ? 'pending' : conclusion === 'success' ? 'green' : 'red', review: reviewState });
    if (gate !== 'wait') break;
    // Approved with fixes: the attempt ends for them without waiting for CI, which is cancelled below.
    if (reviewState === 'approved' && !waived && reviewVerdict && approvedWithFixes(reviewVerdict.verdict, reviewVerdict.comments)) break;

    // CI that never shows up or never ends fails the attempt, as it did when CI was awaited alone.
    if (!ciDone) {
      const failure =
        snap.ci.state === 'missing' && waited >= d.ciAppearMs
          ? 'The project has no CI check named "ci": the walking skeleton task adds it.'
          : waited >= d.ciTimeoutMs
            ? `CI did not finish after ${Math.round(d.ciTimeoutMs / 60_000)} minutes.`
            : null;
      if (failure) {
        await plain('ci-failed', () => record(r, 'ci', 'failed', { error: failure }));
        return stop('ci', 'failed');
      }
      if (!ciAnnounced && snap.ci.state === 'pending') {
        ciAnnounced = true;
        await plain('ci-waiting', () => record(r, 'ci', 'waiting', { head_sha: headSha }));
      }
    }
    await d.sleep(d.pollMs);
    waited += d.pollMs;
  }
  // Review first: CI is cancelled (when still running) and the attempt goes on as a review rejection. A red CI with the
  // review still running waited for it above (the run is already paid for, and the next attempt gets both findings).
  if (gate === 'reject_review') await cancelCi('review_requested_changes');
  if (gate === 'review_failed') {
    await cancelCi('review_failed');
    return stop('review', 'failed');
  }
  if (!reviewVerdict) return stop('review', 'failed');
  const verdict: Verdict = reviewVerdict;
  // LGTM with comments: approved, CI not red, and fixes left to make before merging (a red CI is an ordinary rejection).
  const lgtmStop = !waived && approvedWithFixes(verdict.verdict, verdict.comments) && (gate === 'wait' || gate === 'pass');
  if (lgtmStop) await cancelCi('approved_with_fixes');

  // publish: the review on the pull request and the required status
  const approved = verdict.verdict === 'approve' && conclusion === 'success' && !lgtmStop;
  const published = await stage(r, 'publish', async () => {
    const inline = verdict.comments.filter((c) => c.line !== null && c.line > 0);
    const loose = verdict.comments.filter((c) => c.line === null || c.line <= 0);
    const body = [
      `**DEMIURGO reviewer: ${verdict.verdict === 'approve' ? 'approved' : 'changes requested'}**`,
      '',
      verdict.summary,
      ...(loose.length > 0 ? ['', ...loose.map((c) => `- [${c.severity}] ${c.path}: ${c.body}`)] : []),
    ].join('\n');
    // A waived review was already posted on the pull request by the attempt that approved with fixes.
    if (!waived) {
      await d.github.postReview(cfg, owner, repoName, pull.number, {
        body,
        comments: inline.map((c) => ({ path: c.path, line: c.line as number, body: `[${c.severity}] ${c.body}` })),
      });
    }
    await d.github.setCommitStatus(cfg, owner, repoName, headSha, {
      context: REVIEW_STATUS,
      state: approved ? 'success' : 'failure',
      description: approved
        ? waived
          ? 'The reviewer agent approved with fixes, the fixes are applied and CI is green.'
          : 'The reviewer agent approved and CI is green.'
        : lgtmStop
          ? 'The reviewer agent approved with fixes to make before merging.'
          : conclusion === 'success' || ciCancelled
          ? 'The reviewer agent asked for changes.'
          : `CI concluded ${conclusion ?? 'without a result'}.`,
      target_url: pull.url,
    });
    return {
      value: true,
      detail: { status: approved ? 'success' : 'failure', verdict: verdict.verdict, ...(waived ? { waived: 'lgtm_with_comments' } : {}), ...(lgtmStop ? { lgtm_with_comments: true } : {}), ci_conclusion: conclusion, ...(ciCancelled ? { ci_cancelled: true } : {}) },
      extra: { published_review: verdict.id },
    };
  });
  if (!published.ok) return stop('publish', published.outcome);

  // merge
  /**
   * The attempt ends needing changes (the reviewer's verdict, a red CI, a conflict with main). DEMIURGO starts the next
   * attempts itself first (up to `autoFollowUps`) and only then leaves it to the person.
   */
  const stopForChanges = async (reason: string, opts: { blocking: number; fixable: boolean; extra?: Record<string, unknown>; escalate?: number; cheap?: boolean }): Promise<void> => {
    const next = await plain('merge-stop', async () => {
      // The attempts started by DEMIURGO itself since the person's last one (our convention, see autoFollowUps).
      const automatic = await automaticAttempts(s0, requestId);
      const latest = await s0.db
        .selectFrom('build_steps')
        .select((eb) => eb.fn.max('attempt').as('attempt'))
        .where('build_request_id', '=', requestId)
        .executeTakeFirst();
      // Someone (the person) already started a newer attempt: nothing to follow up.
      const current = Number(latest?.attempt ?? attempt) === attempt;
      // Escalated: resolving it needs something only a person can provide, so no automatic follow-up.
      const escalated = (opts.escalate ?? 0) > 0;
      // A cheap round (approved with fixes, no new review) always follows up and does not count against the limit.
      // This attempt insisted again (the reviewer repeated a blocking finding) after one that already started fresh for it:
      // another round would be the same one, so it is left to the person (convención nuestra, see insisted.ts).
      const insisting = current && opts.blocking > 0 ? await reviewerRepeatedAny(s0, requestId) : false;
      const builderStep = insisting
        ? await s0.db
            .selectFrom('build_steps')
            .select('detail')
            .where('build_request_id', '=', requestId)
            .where('attempt', '=', attempt)
            .where('stage', '=', 'builder')
            .where('outcome', '=', 'ok')
            .orderBy('created_at', 'desc')
            .orderBy('id', 'desc')
            .executeTakeFirst()
        : undefined;
      const stopInsisted = insistedTwice((builderStep?.detail as BuilderStepDetail | null | undefined)?.session?.reason_code, insisting);
      const follow = current && opts.fixable && !escalated && !stopInsisted && (opts.cheap === true || automatic < d.autoFollowUps);
      await record(r, 'merge', 'changes_requested', {
        reason,
        ...(stopInsisted ? { insisted: true, insisted_reason: 'The reviewer repeated a blocking finding after a fresh session that started because of the same repetition: stopping here.' } : {}),
        blocking: opts.blocking,
        ...(opts.extra ?? {}),
        ...(current && opts.fixable && !follow ? { needs_you: true, tried: automatic + 1 } : {}),
        ...(escalated ? { needs_you: true, escalated: 'needs_person', needs_person: opts.escalate } : {}),
        ...(follow ? { next_attempt: attempt + 1 } : {}),
      });
      if (!follow) return null;
      // The same first step the person's «Address the review» leaves (build.start), by the system actor.
      await record({ ...r, attempt: attempt + 1 }, 'repo', 'started', { started_by: formatActor(BUILD), automatic: true, reason, ...(opts.cheap ? { lgtm_fixes: true } : {}) });
      return attempt + 1;
    });
    // Durable and idempotent: the workflow id is the attempt's, so a replay (or a person who pressed the
    // button first and got there before) never starts it twice.
    if (next !== null) await DBOS.startWorkflow(buildWorkflowRegistered, { workflowID: buildWorkflowId(requestId, next) })(projectId, requestId, next);
  };
  if (lgtmStop) {
    await stopForChanges('The reviewer approved with fixes to make before merging.', {
      blocking: 0,
      fixable: true,
      // Only one cheap round in a row: a fix attempt approved with fixes again counts like any other follow-up.
      cheap: approving === null,
      extra: { lgtm_with_comments: true, fixes: countFixes(verdict.comments) },
    });
    return stop('merge', 'changes_requested');
  }
  if (!approved) {
    const blocking = verdict.comments.filter((c) => c.severity === 'blocking').length;
    const ciRed = ciDone && conclusion !== 'success';
    const reason = verdict.verdict === 'approve' ? `CI concluded ${conclusion ?? 'without a result'}.` : 'The reviewer asked for changes.';
    const needsPerson = verdict.verdict === 'request_changes' ? verdict.comments.filter((c) => c.severity === 'blocking' && c.needs_person === true).length : 0;
    await stopForChanges(reason, { blocking, fixable: ciRed || blocking > 0, escalate: needsPerson });
    return stop('merge', 'changes_requested');
  }

  // Integrate with the base before merging (Martin Fowler, "Continuous Integration": a branch that is green alone can
  // break once combined with what main got meanwhile; GitHub's "Require branches to be up to date before merging").
  // A branch behind main is updated with it, and only merges if CI is green on the new head.
  let mergeSha = headSha;
  const behind = await plain('merge-behind', async () => {
    try {
      return await d.github.behindBy(cfg, owner, repoName, 'main', headSha);
    } catch {
      return 0; // cannot tell: GitHub's own merge rule still applies
    }
  });
  // Only what can affect this task is worth a second CI run (Google TAP: affected tests presubmit, everything
  // postsubmit; the `main` stage is the postsubmit). Disjoint changes that merge cleanly skip it (see build/recheck.ts).
  const recheck =
    behind > 0
      ? await plain('merge-recheck', async () => {
          const decision = await decideRecheck(info.repoDir, headSha);
          if (!decision.recheck) await record(r, 'merge', 'waiting', { recheck: false, reason: decision.reason, main_files: decision.mainFiles, behind_by: behind });
          return decision;
        })
      : null;
  if (behind > 0 && recheck?.recheck !== false) {
    const update = await plain('merge-update', async () => {
      try {
        return await d.github.updateBranch(cfg, owner, repoName, pull.number, headSha);
      } catch (e) {
        return { result: 'error' as const, message: messageOf(e) };
      }
    });
    if (update.result === 'conflict') {
      await stopForChanges(`The branch conflicts with main: ${update.message}`, { blocking: 0, fixable: true, extra: { conflict: true, behind_by: behind } });
      return stop('merge', 'changes_requested');
    }
    if (update.result === 'error') {
      await plain('merge-update-failed', () => record(r, 'merge', 'failed', { error: `Could not update the branch with main: ${update.message}` }));
      return stop('merge', 'failed');
    }
    // GitHub updates the branch asynchronously: wait for its new head.
    let waitedForHead = 0;
    let newSha: string | null = null;
    for (;;) {
      const now = await plain('merge-head-poll', async () => (await d.github.pullRequest(cfg, owner, repoName, pull.number)).headSha);
      if (now && now !== headSha) {
        newSha = now;
        break;
      }
      if (waitedForHead >= d.ciAppearMs) break;
      await d.sleep(d.pollMs);
      waitedForHead += d.pollMs;
    }
    if (!newSha) {
      await plain('merge-head-failed', () => record(r, 'merge', 'failed', { error: 'GitHub did not update the branch with main.' }));
      return stop('merge', 'failed');
    }
    const updatedSha = newSha;
    await plain('merge-updated', () => record(r, 'merge', 'waiting', { updated_from_base: true, recheck: true, reason: recheck?.reason ?? 'no_code_map', head_sha: updatedSha, behind_by: behind }, { head_sha: updatedSha }));
    // The same CI wait as the `ci` stage, on the new head.
    const again = await waitForCi(d, cfg, owner, repoName, updatedSha, 'merge-ci');
    if (!again.ci) {
      await plain('merge-ci-failed', () => record(r, 'ci', 'failed', { error: again.failure ?? 'CI did not report.', head_sha: updatedSha, updated_from_base: true }));
      return stop('ci', 'failed');
    }
    const againConclusion = again.ci.conclusion;
    let forgiven: string[] = [];
    if (againConclusion !== 'success') {
      await plain('merge-ci-red', () => record(r, 'ci', 'failed', { conclusion: againConclusion, head_sha: updatedSha, updated_from_base: true }));
      // The failing tests go to the next attempt as feedback, like those of any red CI.
      const redEvidence = await gatherEvidence(updatedSha);
      if (!redEvidence.ok) return stop('evidence', redEvidence.outcome);
      if (redEvidence.value.forgiven) forgiven = redEvidence.value.quarantined;
      else {
        await stopForChanges(`CI failed after updating the branch with main (${againConclusion ?? 'no result'}).`, { blocking: 0, fixable: true, extra: { updated_from_base: true, head_sha: updatedSha } });
        return stop('ci', 'failed');
      }
    }
    if (forgiven.length > 0) {
      await plain('merge-ci-quarantined', () =>
        record(r, 'ci', 'ok', { conclusion: 'success', raw_conclusion: againConclusion, head_sha: updatedSha, updated_from_base: true, quarantined: forgiven, note: quarantineNote(forgiven) }),
      );
      quarantined.push(...forgiven);
    } else {
      await plain('merge-ci-ok', () => record(r, 'ci', 'ok', { conclusion: 'success', head_sha: updatedSha, updated_from_base: true }));
    }
    // The required statuses belong on the head that merges: the review approved this pull request's own change.
    await plain('merge-statuses', async () => {
      await d.github.setCommitStatus(cfg, owner, repoName, updatedSha, { context: REVIEW_STATUS, state: 'success', description: 'The reviewer agent approved and CI is green.', target_url: pull.url });
      await d.github.setCommitStatus(cfg, owner, repoName, updatedSha, { context: DESIGN_STATUS, state: 'success', description: designNote.charAt(0).toUpperCase() + designNote.slice(1), target_url: pull.url });
    });
    mergeSha = updatedSha;
  }
  const armed = await stage(r, 'merge', async () => {
    if (repo.value.protection === 'demiurgo') {
      // GitHub Free private repo: no branch protection or auto-merge, so DEMIURGO applies the same rule itself.
      const checks = await d.github.checkRunsFor(cfg, owner, repoName, mergeSha);
      const ci = ciStatusOf(checks);
      const red: string[] = [];
      // A red CI explained only by quarantined flaky tests does not block (see quarantineOf).
      if (ci.state !== 'done' || (ci.conclusion !== 'success' && quarantined.length === 0)) {
        const why = ci.state === 'missing' ? 'missing' : ci.state === 'pending' ? 'still running' : ci.failed.join(', ');
        red.push(`ci (${why}${ci.runs > 1 && ci.failed.length > 0 ? `; ${ci.failed.length} of ${ci.runs} runs failed` : ''})`);
      }
      // demiurgo/review is the status set on the head SHA in `publish`; demiurgo/design was set green in `status`
      // (a failing design check stops the attempt before the push), so both come from this same run.
      if (!approved) red.push(REVIEW_STATUS);
      if (red.length > 0) throw new DomainError('validation', `Not merged: required checks are not green: ${red.join(', ')}.`);
      await d.github.mergePullRequest(cfg, owner, repoName, pull.number);
      return { value: 'direct', detail: { via: 'merge', protection: 'demiurgo', pr_url: pull.url }, outcome: 'waiting' as const };
    }
    if (!pull.nodeId) throw new DomainError('not_found', 'The pull request has no node id to enable auto-merge on.');
    try {
      await d.github.enableAutoMerge(cfg, pull.nodeId);
      return { value: 'auto_merge', detail: { via: 'auto_merge', pr_url: pull.url }, outcome: 'waiting' as const };
    } catch (e) {
      // Everything is already green, so GitHub refuses to arm auto-merge: merge now (branch protection still applies).
      if (!/clean status|already/i.test(messageOf(e))) throw e;
      await d.github.mergePullRequest(cfg, owner, repoName, pull.number);
      return { value: 'direct', detail: { via: 'merge', pr_url: pull.url }, outcome: 'waiting' as const };
    }
  });
  if (!armed.ok) return stop('merge', armed.outcome);
  // The stage above only armed the merge (`waiting`); the merge itself is what ends the attempt.
  let waitedForMerge = 0;
  let mergedAt: string | null = null;
  let mergedCommit: string | null = null;
  let mergeFailure: string | null = null;
  for (;;) {
    const state = await plain('merge-poll', async () => {
      const p = await d.github.pullRequest(cfg, owner, repoName, pull.number);
      return { merged: p.merged, closed: p.state === 'closed', mergedAt: p.mergedAt, commit: p.mergeCommitSha ?? null };
    });
    if (state.merged) {
      mergedAt = state.mergedAt ?? 'merged';
      mergedCommit = state.commit;
      break;
    }
    if (state.closed) {
      mergeFailure = 'The pull request was closed without merging.';
      break;
    }
    if (waitedForMerge >= d.mergeTimeoutMs) {
      mergeFailure = `The pull request was not merged after ${Math.round(d.mergeTimeoutMs / 3_600_000)} hours.`;
      break;
    }
    await d.sleep(d.pollMs);
    waitedForMerge += d.pollMs;
  }
  if (mergedAt === null) {
    await plain('merge-failed', () => record(r, 'merge', 'failed', { error: mergeFailure ?? 'The pull request did not merge.' }));
    return stop('merge', 'failed');
  }
  const mergedTime = mergedAt;
  // The task is done when it merges: its slot in «Build the queue» frees now, and CI on the merge commit is watched
  // after it (presubmit before merging, postsubmit on main that blocks nobody: Google's TAP, Software Engineering at
  // Google, ch. 23). A red main still stops the line (Martin Fowler, "Continuous Integration": fix broken builds
  // immediately): the `main` row it leaves makes the queue start nothing new until main is green again.
  await plain('complete', async () => {
    await executeCommand(s0, { command: 'build_request.complete', actor: BUILD, projectId, entityId: requestId, data: {} });
    // Best effort: the files this task landed (Nx "affected": files changed per git), so later briefs can point at them.
    const footprint = await pullRequestFootprint(d.github, cfg, { owner, repo: repoName }, pull.number).catch(() => null);
    await record(r, 'merge', 'ok', { merged_at: mergedTime, pr_url: pull.url, ...(footprint ? { footprint } : {}) });
  });
  if (mergedCommit) {
    const onMain = mergedCommit;
    const main = await waitForCi(d, cfg, owner, repoName, onMain, 'main-ci');
    if (main.kind === 'done') {
      await plain('main-ci-done', async () => {
        const conclusion = main.ci?.conclusion ?? null;
        // A run on main cancelled because a newer commit landed (GitHub Actions `concurrency` with cancel-in-progress)
        // is not red: the newer commit's run checks main, and its own merge records it.
        const superseded = conclusion === 'cancelled' && (await d.github.behindBy(cfg, owner, repoName, 'main', onMain).catch(() => 0)) > 0;
        const red = conclusion !== 'success' && !superseded;
        await record(
          r,
          'main',
          red ? 'failed' : 'ok',
          red
            ? { on: 'main', sha: onMain, conclusion, error: `CI on main is red after merging ${info.taskCode}: fix main before building more.` }
            : superseded
              ? { on: 'main', sha: onMain, conclusion, superseded: true }
              : { on: 'main', sha: onMain, conclusion: 'success' },
        );
      });
    }
  }
  await plain('cleanup', async () => {
    await removeWorktree(info.repoDir, worktree.path).catch(() => undefined);
    await rm(join(projectsDir() ?? '', '.sessions', requestId), { recursive: true, force: true }).catch(() => undefined);
  });
  return 'done';
}

const buildWorkflowRegistered = DBOS.registerWorkflow(buildWorkflow, { name: 'demiurgo.build' });

/** Starts the workflow of an attempt (with the same id DBOS does not repeat it). */
export async function startBuildWorkflow(requestId: string, projectId: string, attempt: number): Promise<void> {
  await DBOS.startWorkflow(buildWorkflowRegistered, { workflowID: buildWorkflowId(requestId, attempt) })(projectId, requestId, attempt);
}

/** Withdrawn request: kills the builder container and cancels the attempt's workflow (no more steps run). */
export async function cancelBuildWorkflow(requestId: string, attempt: number): Promise<void> {
  builders.get(requestId)?.abort();
  await DBOS.cancelWorkflow(buildWorkflowId(requestId, attempt)).catch(() => undefined);
  const slug = environments.get(requestId);
  if (slug) await deps.teardownEnvironment(slug, requestId).catch(() => undefined);
}

/** Waits for the result of an attempt (tests). */
export async function waitForBuild(requestId: string, attempt: number): Promise<string> {
  return DBOS.retrieveWorkflow<string>(buildWorkflowId(requestId, attempt)).getResult();
}

/**
 * A withdrawn request whose pull request is open: comments on it and closes it, and deletes its branch, so GitHub
 * does not keep a pull request DEMIURGO no longer tracks. Best effort: the withdrawal stands even if GitHub fails.
 */
export async function closeWithdrawnPullRequest(requestId: string, reason?: string): Promise<void> {
  try {
    const cfg = deps.config();
    if (!cfg) return;
    const db = engineServices().db;
    const row = await db
      .selectFrom('build_requests')
      .select(['project_id', 'pr_number', 'branch'])
      .where('id', '=', requestId)
      .executeTakeFirst();
    if (!row || row.pr_number == null) return;
    const repo = await db.selectFrom('project_github').select(['owner', 'repo']).where('project_id', '=', row.project_id).executeTakeFirst();
    if (!repo) return;
    const pr = await deps.github.pullRequest(cfg, repo.owner, repo.repo, Number(row.pr_number));
    if (pr.state === 'open') {
      await deps.github.closePullRequest(cfg, repo.owner, repo.repo, Number(row.pr_number), `Withdrawn in DEMIURGO${reason ? `: ${reason}` : '.'}`);
      if (row.branch) await deps.github.deleteBranch(cfg, repo.owner, repo.repo, row.branch);
    }
  } catch (e) {
    engineServices().logger.error('Could not close the pull request of a withdrawn build request', { request: requestId, error: redactConfigured(String(e)) });
  }
}

/** DBOS statuses of a workflow that will not go on by itself. */
const DEAD_WORKFLOW = new Set(['ERROR', 'CANCELLED', 'MAX_RECOVERY_ATTEMPTS_EXCEEDED', 'RETRIES_EXCEEDED']);

/**
 * Open attempts whose workflow died (a DEMIURGO update changed its steps while it ran, so the durable replay no longer
 * matches, or it errored): the last stage gets a `failed` row, so the task shows «Build again» instead of looking busy
 * forever. The next attempt goes on with the branch's work (see `headWithWork`).
 */
export async function failDeadAttempts(db: Services['db']): Promise<number> {
  const open = await db.selectFrom('build_requests').select(['id', 'project_id']).where('state', 'in', ['requested', 'in_review']).execute();
  let failed = 0;
  for (const o of open) {
    if (!(await buildRunning(db, o.id))) continue;
    const last = await db
      .selectFrom('build_steps')
      .select(['attempt', 'stage'])
      .where('build_request_id', '=', o.id)
      .orderBy('created_at', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();
    if (!last) continue;
    const status = await DBOS.getWorkflowStatus(buildWorkflowId(o.id, last.attempt)).catch(() => null);
    if (!status || !DEAD_WORKFLOW.has(status.status)) continue;
    await record({ projectId: o.project_id, requestId: o.id, attempt: last.attempt }, last.stage as Stage, 'failed', {
      error: 'This attempt stopped: DEMIURGO was updated while it ran. «Build again» goes on with the work already on the branch.',
      interrupted: true,
      workflow_status: status.status,
    });
    failed++;
  }
  return failed;
}

// On startup, once DBOS has tried to recover the workflows (a replay that no longer matches fails then).
registerReconciler(async (s) => {
  // unref: a short-lived process (the CLI) must not wait 90 s for this check before it can exit.
  setTimeout(() => void failDeadAttempts(s.db).catch(() => undefined), 90_000).unref();
}, 'build-dead-attempts');
