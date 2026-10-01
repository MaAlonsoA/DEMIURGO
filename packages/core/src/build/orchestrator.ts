// The durable GitHub build of a task (FDR-BUI-002 and the person's decisions: a private repository
// per project, code written only in an isolated container, an agent as the approver, merge only when
// CI is green). One DBOS workflow per attempt, one step per stage; every stage leaves its build_step
// (started, ok, failed, waiting or changes_requested) through the `build_step.record` command:
//
//   repo → worktree → builder → commit → design → push → pr → status → ci → evidence → review → publish → merge
//
// `design` is the deterministic design-system guard (packages/domain/src/design-guard.ts): with an
// approved design system in the worktree's design/design-system/, violations fail the attempt before
// anything is pushed and come back to the next attempt as feedback. Its commit status
// `demiurgo/design` is published in `status`, on the pushed head, next to the pending review status.
//
// A stage that fails stops the attempt. Changes requested (the reviewer's verdict or a red CI) ends it
// too, and the person can press Build again: the next attempt continues on the same branch and pull
// request. When CI is red or the reviewer left a blocking comment, DEMIURGO itself starts the next
// attempts first (up to `autoFollowUps`), and only then leaves it to the person. Waiting (CI, the reviewer, the merge) polls with durable sleeps; the time spent is counted,
// not read from a clock, so a replay decides the same way. The workflow never accepts or ratifies
// anything: it only builds, records evidence and lets GitHub merge once its required checks pass.

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
import { engineServices } from '../engine/registry.ts';
import * as github from '../github/client.ts';
import { ciStatusOf, redactConfigured } from '../github/client.ts';
import { flakyNote } from './flaky.ts';
import { classifyBuilderFailure, failureExcerpt } from './failure.ts';
import { taskCoversOf } from '../queries/sizes.ts';
import { projectsDir } from '../repo/repo.ts';
import { BUILDER_MAX_TIME_MS, type BuildReport, runBuilder } from '../runner/builder.ts';
import type { Services } from '../services.ts';
import { commitAll, commitFiles, hostPathOf, prepareWorktree, readWorktreeFile, readWorktreeFiles, removeWorktree } from './workspace.ts';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

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
  | 'pullRequestDiff'
  | 'setCommitStatus'
  | 'postReview'
  | 'enableAutoMerge'
  | 'mergePullRequest'
  | 'checkRunsFor'
  | 'junitArtifactFor'
  | 'closePullRequest'
  | 'deleteBranch'
>;

/** What the flow talks to; the tests replace it (GitHub, the builder container and time). */
export type BuildDeps = {
  github: GithubApi;
  config: () => github.GithubConfig | null;
  runBuilder: typeof runBuilder;
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
   * asks for changes with a blocking comment. 2 is our convention (not a published standard): enough to
   * fix what the first review found, little enough not to burn the subscription quota on a loop.
   */
  autoFollowUps: number;
};

const defaults = (): BuildDeps => ({
  github,
  config: () => github.githubConfig(),
  runBuilder,
  sleep: (ms) => DBOS.sleepms(ms),
  pollMs: 5_000,
  ciTimeoutMs: 2 * 3_600_000,
  ciAppearMs: 15 * 60_000,
  mergeTimeoutMs: 24 * 3_600_000,
  reviewTimeoutMs: 3_600_000,
  autoFollowUps: 2,
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

export const buildWorkflowId = (buildRequestId: string, attempt: number): string => `build:${buildRequestId}:${attempt}`;

/** Automatic retries after a plain builder failure (our convention: one, like a flaky CLI start). */
const BUILDER_AUTO_RETRIES = 1;

type Stage = 'repo' | 'worktree' | 'builder' | 'commit' | 'design' | 'push' | 'pr' | 'status' | 'ci' | 'evidence' | 'review' | 'publish' | 'merge';
type Outcome = 'started' | 'ok' | 'failed' | 'waiting' | 'changes_requested';

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
    .innerJoin('record_versions', 'record_versions.id', 'build_requests.task_version_id')
    .select([
      'build_requests.brief',
      'build_requests.branch',
      'build_requests.pr_number',
      'build_requests.pr_url',
      'build_requests.head_sha',
      'records.code',
      'record_versions.title',
    ])
    .where('build_requests.id', '=', r.requestId)
    .executeTakeFirstOrThrow();
  const repo = await s.db.selectFrom('project_repos').select('dir').where('project_id', '=', r.projectId).executeTakeFirst();
  const root = projectsDir();
  if (!repo || !root) throw new DomainError('not_found', 'The project has no local repository yet.');
  return {
    requestId: r.requestId,
    taskCode: q.code,
    taskTitle: q.title,
    brief: q.brief,
    branch: q.branch,
    prNumber: q.pr_number,
    prUrl: q.pr_url,
    headSha: q.head_sha,
    repoDir: join(root, repo.dir),
  };
}

type Feedback = { blocking: string[]; failing: string[]; design: string[]; flaky: string[]; wip?: { sha: string; files: string[] } };

const NO_FEEDBACK: Feedback = { blocking: [], failing: [], design: [], flaky: [] };

type BuilderStepDetail = { failure_kind?: string; exit_code?: number | null; wip_commit?: string; wip_files?: string[]; timed_out_twice?: boolean };

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

/** What the previous attempt got wrong: the reviewer's blocking comments and the tests that failed. */
async function feedbackOf(s: Services, r: Run): Promise<Feedback> {
  const review = await s.db
    .selectFrom('pr_reviews')
    .select(['summary', 'comments'])
    .where('build_request_id', '=', r.requestId)
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  const comments = (review?.comments ?? []) as { path: string; line: number | null; severity: string; body: string }[];
  const blocking = comments
    .filter((c) => c.severity === 'blocking')
    .map((c) => `${c.path}${c.line ? `:${c.line}` : ''}: ${c.body}`);
  const evidence = await s.db
    .selectFrom('build_steps')
    .select('detail')
    .where('build_request_id', '=', r.requestId)
    .where('stage', '=', 'evidence')
    .where('outcome', '=', 'ok')
    .orderBy('created_at', 'desc')
    .orderBy('id', 'desc')
    .executeTakeFirst();
  const evidenceDetail = evidence?.detail as { recorded?: { code: string; result: string }[]; flaky?: string[] } | null;
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
  const violations = design?.outcome === 'failed' ? ((design.detail as { violations?: DesignViolation[] } | null)?.violations ?? []) : [];
  const previous = r.attempt > 1 ? await failedBuilderStep(s, r.requestId, r.attempt - 1) : null;
  const wip = previous?.failure_kind === 'timeout' && previous.wip_commit ? { sha: previous.wip_commit, files: previous.wip_files ?? [] } : undefined;
  return { blocking, failing: recorded.map((t) => t.code), design: violations.map(violationLine), flaky: evidenceDetail?.flaky ?? [], ...(wip ? { wip } : {}) };
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

function promptOf(
  body: string,
  brief: string,
  attempt: number,
  f: Feedback,
  design: { manifest: DesignManifest; manifestText: string; tokensText: string } | null = null,
): string {
  const lines = [body, '', '# Brief', brief, ...designSection(design)];
  if (attempt > 1 && (f.wip || f.blocking.length > 0 || f.failing.length > 0 || f.design.length > 0 || f.flaky.length > 0)) {
    lines.push('', `# Feedback on the previous attempt (this is attempt ${attempt} on the same branch)`);
    if (f.wip) {
      lines.push(
        `The previous attempt ran out of time. Its work is committed on this branch (commit ${f.wip.sha.slice(0, 8)}, "WIP"): continue from it instead of starting over.`,
        ...(f.wip.files.length > 0 ? ['Files in that commit:', ...f.wip.files.map((p) => `- ${p}`)] : []),
        "Finish within the time limit by keeping to the task's scope: do only what its criteria ask.",
      );
    }
    if (f.blocking.length > 0) lines.push('The reviewer asked for these changes:', ...f.blocking.map((b) => `- ${b}`));
    if (f.failing.length > 0) lines.push(`The tests of these criteria failed in CI: ${f.failing.join(', ')}.`);
    if (f.flaky.length > 0) lines.push(flakyNote(f.flaky));
    if (f.design.length > 0) lines.push('The design-system check (demiurgo/design) failed, fix these:', ...f.design.map((v) => `- ${v}`));
  } else if (attempt > 1) {
    lines.push('', `# Feedback on the previous attempt (this is attempt ${attempt} on the same branch)`, 'The previous attempt did not merge; check the tests and the review comments on the pull request.');
  }
  return lines.join('\n');
}

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
    if ((row.detail as { automatic?: boolean } | null)?.automatic !== true) break;
    automatic++;
  }
  return automatic;
}

/** After a failed builder: records the automatic next attempt and returns its number, or null (no retry). */
async function retryBuilder(s: Services, r: Run): Promise<number | null> {
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
  const retryable = step?.detail?.failure_kind === 'other' || (step?.detail?.failure_kind === 'timeout' && Boolean(step.detail.wip_commit) && !step.detail.timed_out_twice);
  if (!step || !retryable) return null;
  const latest = await s.db
    .selectFrom('build_steps')
    .select((eb) => eb.fn.max('attempt').as('attempt'))
    .where('build_request_id', '=', r.requestId)
    .executeTakeFirst();
  if (Number(latest?.attempt ?? r.attempt) !== r.attempt) return null;
  if ((await automaticAttempts(s, r.requestId)) >= BUILDER_AUTO_RETRIES) return null;
  const reason =
    step.detail?.failure_kind === 'timeout'
      ? 'The builder ran out of time; its work is committed on the branch and a new attempt continues from it.'
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
    return { value: w, detail: { branch: w.branch, reused: Boolean(info.branch) }, extra: { branch: w.branch } };
  });
  if (!tree.ok) return stop('worktree', tree.outcome);
  const worktree = tree.value;

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
    const feedback = attempt > 1 ? await feedbackOf(s0, r) : NO_FEEDBACK;
    const designSystem = await designSystemOf(worktree.path).catch(() => null);
    const control = new AbortController();
    builders.set(requestId, control);
    const result = await d.runBuilder(
      {
        worktreeHostPath: hostPathOf(worktree.path),
        provider: resolution.provider as 'claude' | 'codex',
        model: resolution.model,
        effort: resolution.effort ?? 'medium',
        prompt: promptOf(agent.body, info.brief, attempt, feedback, designSystem),
        maxTimeMs: Math.min(agent.timeLimitSeconds * 1000, BUILDER_MAX_TIME_MS),
        limits: { cpus: 2, memoryMb: 4096, pids: 512 },
      },
      { worktreePath: worktree.path, signal: control.signal, containerName: `demiurgo-build-${requestId}` },
    ).finally(() => {
      if (builders.get(requestId) === control) builders.delete(requestId);
    });
    // The report is DEMIURGO's, not the project's: it never enters the commit.
    await rm(join(worktree.path, '.demiurgo'), { recursive: true, force: true });
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
      exit_code: result.exitCode,
      duration_ms: result.durationMs,
      transcript_tail_length: result.transcriptTail.length,
      report: result.report,
      ...(wip ? { wip_commit: wip.sha, wip_files: wip.files, ...(wip.pushError ? { wip_push_error: wip.pushError } : {}) } : {}),
      ...(twice ? { timed_out_twice: true, branch: worktree.branch } : {}),
      ...(kind ? { failure_kind: kind, transcript_excerpt: failureExcerpt({ stderr: result.stderrTail, transcript: result.transcriptTail }) } : {}),
    };
    if (failed) {
      return { outcome: 'failed' as const, detail: { ...detail, error: `The builder ended with ${result.failureKind ?? `exit code ${result.exitCode}`}.` } };
    }
    return { value: { report: result.report }, detail };
  });
  if (!built.ok) {
    // A plain failure (the CLI exited with an error, nothing more specific) gets one automatic retry before
    // it stops; a usage limit, a login problem or a timeout would only fail again (our convention).
    const next = built.outcome === 'failed' ? await plain('builder-retry', () => retryBuilder(s0, r)) : null;
    if (next !== null) await DBOS.startWorkflow(buildWorkflowRegistered, { workflowID: buildWorkflowId(requestId, next) })(projectId, requestId, next);
    return stop('builder', built.outcome);
  }
  const report = built.value.report;

  // commit
  const committed = await stage(r, 'commit', async () => {
    const sha = await commitAll(worktree.path, `${info.taskCode}: ${info.taskTitle}`);
    if (!sha) return { outcome: 'failed' as const, detail: { error: 'The builder changed nothing: there is nothing to commit.' } };
    return { value: sha, detail: { sha }, extra: { head_sha: sha } };
  });
  if (!committed.ok) return stop('commit', committed.outcome);
  const headSha = committed.value;

  // design: the deterministic design-system guard; no approved system yet means nothing to check
  const designed = await stage(r, 'design', async () => {
    const approved = await designSystemOf(worktree.path);
    if (!approved) return { value: { note: 'no design system yet' }, detail: { note: 'no design system yet', violations: [] } };
    const keep = (file: string) => /\.(css|scss|html|jsx|tsx|vue|svelte)$/.test(file) || file.endsWith('/tokens.json') || file === 'tokens.json';
    const files = await readWorktreeFiles(worktree.path, keep);
    const result = designGuard(files, approved.manifest, approved.tokens);
    const detail = { version: approved.manifest.version, checked: files.length, violations: result.violations };
    if (!result.ok) {
      return { outcome: 'failed' as const, detail: { ...detail, error: `${result.violations.length} design-system ${result.violations.length === 1 ? 'violation' : 'violations'}: ${result.violations.slice(0, 5).map(violationLine).join(' | ')}` } };
    }
    return { value: { note: `Uses the approved design system ${approved.manifest.version}.` }, detail };
  });
  if (!designed.ok) return stop('design', designed.outcome);
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

  // ci
  await plain('ci-start', () => record(r, 'ci', 'started'));
  let waited = 0;
  let announced = false;
  let ci: CiResult | null = null;
  let ciFailure: string | null = null;
  for (;;) {
    const poll = await plain('ci-poll', async () => {
      const checks = await d.github.checkRunsFor(cfg, owner, repoName, headSha);
      // Every run named `ci` on this SHA counts (push and pull_request each yield one): all must complete, none may fail.
      const { state, conclusion } = ciStatusOf(checks);
      return { state, conclusion };
    });
    if (poll.state === 'done') {
      ci = { conclusion: poll.conclusion };
      break;
    }
    if (poll.state === 'missing' && waited >= d.ciAppearMs) {
      ciFailure = 'The project has no CI check named "ci": the walking skeleton task adds it.';
      break;
    }
    if (waited >= d.ciTimeoutMs) {
      ciFailure = `CI did not finish after ${Math.round(d.ciTimeoutMs / 60_000)} minutes.`;
      break;
    }
    if (!announced) {
      announced = true;
      await plain('ci-waiting', () => record(r, 'ci', 'waiting', { head_sha: headSha }));
    }
    await d.sleep(d.pollMs);
    waited += d.pollMs;
  }
  if (!ci) {
    await plain('ci-failed', () => record(r, 'ci', 'failed', { error: ciFailure ?? 'CI did not report.' }));
    return stop('ci', 'failed');
  }
  const conclusion = ci.conclusion;
  // The step tells the truth: a CI that did not conclude `success` is `failed`; the flow still goes on
  // to the evidence and the review, because both are worth having when the attempt is rebuilt.
  await plain('ci-done', () =>
    record(r, 'ci', conclusion === 'success' ? 'ok' : 'failed', { conclusion, head_sha: headSha }),
  );

  // evidence
  const evidence = await stage(r, 'evidence', async () => {
    const junit = await d.github.junitArtifactFor(cfg, owner, repoName, headSha);
    if (!junit) return { value: { tests: [] as { code: string; result: 'pass' | 'fail' }[], flaky: [] as string[] }, detail: { note: 'The CI run has no artifact named "junit": no evidence recorded.', recorded: [] } };
    const taskRow = await s0.db.selectFrom('build_requests').select('task_id').where('id', '=', requestId).executeTakeFirstOrThrow();
    const done = await executeCommand(s0, {
      command: 'evidence.ingest_junit',
      actor: BUILD,
      projectId,
      data: { junit, pr_url: pull.url, reference: headSha, expected: await taskCoversOf(s0.db, taskRow.task_id) },
    });
    const result = done.result as { recorded: { code: string; result: 'pass' | 'fail'; tests: number }[]; unknown: string[]; ignored: number; not_run: string[]; flaky: string[] };
    return {
      value: { tests: result.recorded.map((t) => ({ code: t.code, result: t.result })), flaky: result.flaky },
      detail: { recorded: result.recorded, unknown: result.unknown, ignored: result.ignored, not_run: result.not_run, flaky: result.flaky },
    };
  });
  if (!evidence.ok) return stop('evidence', evidence.outcome);

  // review
  const requested = await stage(
    r,
    'review',
    async () => {
      const diff = await d.github.pullRequestDiff(cfg, owner, repoName, pull.number);
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
              input: { diff, pr_url: pull.url, ci: { conclusion, tests: evidence.value.tests, flaky: evidence.value.flaky } },
            },
          });
          return { value: { runId: run.entityId }, detail: { run_id: run.entityId, ci_conclusion: conclusion }, outcome: 'waiting' as const };
        } catch (e) {
          // The graph is being updated: the reviewer's context waits for it.
          if (!isDomainError(e) || e.type !== 'guard' || waitedForGraph >= d.reviewTimeoutMs) throw e;
          await new Promise((resolve) => setTimeout(resolve, Math.min(d.pollMs, 1000)));
          waitedForGraph += Math.min(d.pollMs, 1000);
        }
      }
    },
    { announce: true },
  );
  if (!requested.ok) return stop('review', requested.outcome);
  // The stage recorded `waiting` (with the run): the review is only requested until there is a verdict.
  const runId = requested.value.runId;
  let waitedForRun = 0;
  let runState = 'queued';
  for (;;) {
    runState = await plain('review-poll', async () => {
      const run = await s0.db.selectFrom('ai_runs').select('state').where('id', '=', runId).executeTakeFirstOrThrow();
      return run.state;
    });
    if (!['queued', 'running'].includes(runState)) break;
    if (waitedForRun >= d.reviewTimeoutMs) break;
    await d.sleep(d.pollMs);
    waitedForRun += d.pollMs;
  }
  const verdict = await plain('review-read', async () => {
    const row = await s0.db
      .selectFrom('pr_reviews')
      .select(['id', 'verdict', 'summary', 'comments'])
      .where('run_id', '=', runId)
      .executeTakeFirst();
    return row ? { id: row.id, verdict: row.verdict, summary: row.summary, comments: row.comments as { path: string; line: number | null; severity: string; body: string }[] } : null;
  });
  if (!verdict) {
    await plain('review-failed', () =>
      record(r, 'review', 'failed', { run_id: runId, error: `The reviewer's run ended ${runState} without a verdict.` }),
    );
    return stop('review', 'failed');
  }
  await plain('review-ok', () =>
    record(r, 'review', verdict.verdict === 'approve' ? 'ok' : 'changes_requested', {
      run_id: runId,
      verdict: verdict.verdict,
      comments_count: verdict.comments.length,
    }),
  );

  // publish: the review on the pull request and the required status
  const approved = verdict.verdict === 'approve' && conclusion === 'success';
  const published = await stage(r, 'publish', async () => {
    const inline = verdict.comments.filter((c) => c.line !== null && c.line > 0);
    const loose = verdict.comments.filter((c) => c.line === null || c.line <= 0);
    const body = [
      `**DEMIURGO reviewer: ${verdict.verdict === 'approve' ? 'approved' : 'changes requested'}**`,
      '',
      verdict.summary,
      ...(loose.length > 0 ? ['', ...loose.map((c) => `- [${c.severity}] ${c.path}: ${c.body}`)] : []),
    ].join('\n');
    await d.github.postReview(cfg, owner, repoName, pull.number, {
      body,
      comments: inline.map((c) => ({ path: c.path, line: c.line as number, body: `[${c.severity}] ${c.body}` })),
    });
    await d.github.setCommitStatus(cfg, owner, repoName, headSha, {
      context: REVIEW_STATUS,
      state: approved ? 'success' : 'failure',
      description: approved
        ? 'The reviewer agent approved and CI is green.'
        : conclusion === 'success'
          ? 'The reviewer agent asked for changes.'
          : `CI concluded ${conclusion ?? 'without a result'}.`,
      target_url: pull.url,
    });
    return {
      value: true,
      detail: { status: approved ? 'success' : 'failure', verdict: verdict.verdict, ci_conclusion: conclusion },
      extra: { published_review: verdict.id },
    };
  });
  if (!published.ok) return stop('publish', published.outcome);

  // merge
  if (!approved) {
    const blocking = verdict.comments.filter((c) => c.severity === 'blocking').length;
    const ciRed = conclusion !== 'success';
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
      const fixable = ciRed || blocking > 0;
      const follow = current && fixable && automatic < d.autoFollowUps;
      const reason = verdict.verdict === 'approve' ? `CI concluded ${conclusion ?? 'without a result'}.` : 'The reviewer asked for changes.';
      await record(r, 'merge', 'changes_requested', {
        reason,
        blocking,
        ...(current && fixable && !follow ? { needs_you: true, tried: automatic + 1 } : {}),
        ...(follow ? { next_attempt: attempt + 1 } : {}),
      });
      if (!follow) return null;
      // The same first step the person's «Address the review» leaves (build.start), by the system actor.
      await record({ ...r, attempt: attempt + 1 }, 'repo', 'started', { started_by: formatActor(BUILD), automatic: true, reason });
      return attempt + 1;
    });
    // Durable and idempotent: the workflow id is the attempt's, so a replay (or a person who pressed the
    // button first and got there before) never starts it twice.
    if (next !== null) await DBOS.startWorkflow(buildWorkflowRegistered, { workflowID: buildWorkflowId(requestId, next) })(projectId, requestId, next);
    return stop('merge', 'changes_requested');
  }
  const armed = await stage(r, 'merge', async () => {
    if (repo.value.protection === 'demiurgo') {
      // GitHub Free private repo: no branch protection or auto-merge, so DEMIURGO applies the same rule itself.
      const checks = await d.github.checkRunsFor(cfg, owner, repoName, headSha);
      const ci = ciStatusOf(checks);
      const red: string[] = [];
      if (ci.state !== 'done' || ci.conclusion !== 'success') {
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
  let mergeFailure: string | null = null;
  for (;;) {
    const state = await plain('merge-poll', async () => {
      const p = await d.github.pullRequest(cfg, owner, repoName, pull.number);
      return { merged: p.merged, closed: p.state === 'closed', mergedAt: p.mergedAt };
    });
    if (state.merged) {
      mergedAt = state.mergedAt ?? 'merged';
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
  await plain('complete', async () => {
    await executeCommand(s0, { command: 'build_request.complete', actor: BUILD, projectId, entityId: requestId, data: {} });
    await record(r, 'merge', 'ok', { merged_at: mergedTime, pr_url: pull.url });
  });
  await plain('cleanup', async () => {
    await removeWorktree(info.repoDir, worktree.path).catch(() => undefined);
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
