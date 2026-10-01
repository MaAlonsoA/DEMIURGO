// The project's private GitHub repository and its pull requests: a tiny REST/GraphQL client over
// global fetch, plus the git pushes with a one-shot credential. The token is read from the
// environment only, never written to git config, remote URLs, logs or error text.

import { execFile } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { DomainError } from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';
import { projectsDir } from '../repo/repo.ts';

const run = promisify(execFile);

export type GithubConfig = {
  token: string;
  owner: string;
  api: string;
  /** Injectable for tests; global fetch by default. */
  fetch?: typeof fetch;
};

export function githubConfig(env: Record<string, string | undefined> = process.env): GithubConfig | null {
  const token = env.DEMIURGO_GITHUB_TOKEN?.trim();
  const owner = env.DEMIURGO_GITHUB_OWNER?.trim();
  if (!token || !owner) return null;
  return { token, owner, api: 'https://api.github.com' };
}

/** Text with the token (and its Basic form) removed. */
export function redactToken(text: string, token: string): string {
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  return text.split(basic).join('***').split(token).join('***');
}

type Called = { status: number; data: any; text: string };

async function call(
  cfg: GithubConfig,
  method: string,
  path: string,
  opts: { body?: unknown; accept?: string; okStatuses?: number[]; raw?: boolean } = {},
): Promise<Called> {
  const doFetch = cfg.fetch ?? fetch;
  const url = path.startsWith('http') ? path : `${cfg.api}${path}`;
  // A read retries a transient failure (network error, 429 or 5xx such as the artifact store's «503 ServerBusy»)
  // with exponential backoff and jitter, honouring Retry-After (GitHub REST docs, «Best practices for using the
  // REST API»; AWS Architecture Blog, «Exponential Backoff And Jitter»). Writes are not retried: they may have
  // applied. The attempt count and delays are our convention.
  const retries = method === 'GET' || method === 'HEAD' ? GET_RETRIES : 0;
  const send = (): Promise<Response> =>
    doFetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: opts.accept ?? 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'demiurgo',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      redirect: 'follow',
    });
  let res: Response | undefined;
  for (let attempt = 0; ; attempt++) {
    let failure: unknown = null;
    try {
      res = await send();
    } catch (e) {
      failure = e;
    }
    const transient = failure !== null || (res !== undefined && (res.status === 429 || res.status >= 500));
    if (!transient || attempt >= retries) {
      if (failure !== null) throw new DomainError('validation', redactToken(`GitHub is unreachable: ${(failure as Error).message}`, cfg.token));
      break;
    }
    const after = Number(res?.headers.get('retry-after'));
    const wait = Number.isFinite(after) && after > 0 ? Math.min(after * 1000, RETRY_MAX_MS) : Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
    await res?.body?.cancel().catch(() => undefined);
    await new Promise((r) => setTimeout(r, cfg.fetch ? 0 : wait / 2 + Math.random() * (wait / 2)));
  }
  return finish(res as Response);

  async function finish(res: Response): Promise<Called> {
    const status = res.status;
    if (opts.raw && status < 400) return { status, data: res, text: '' };
    const text = await res.text();
    let data: any = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (status >= 400 && !opts.okStatuses?.includes(status)) {
      const detail = data?.message ? String(data.message) : text.slice(0, 200);
      throw new DomainError(
        'validation',
        redactToken(`GitHub ${method} ${path.replace(cfg.api, '')} failed (${status}): ${detail}`, cfg.token),
      );
    }
    return { status, data, text };
  }
}

/** Retries of a transient GitHub read and its backoff (our convention). */
const GET_RETRIES = 4;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 30000;

async function graphql(cfg: GithubConfig, query: string, variables: Record<string, unknown>): Promise<any> {
  const { data } = await call(cfg, 'POST', '/graphql', { body: { query, variables } });
  if (data?.errors?.length) {
    throw new DomainError(
      'validation',
      redactToken(`GitHub GraphQL failed: ${data.errors.map((e: any) => e.message).join('; ')}`, cfg.token),
    );
  }
  return data?.data;
}

// ---------------------------------------------------------------------------------- git

/**
 * Environment that authenticates git's HTTPS calls to github.com for one child process only: the
 * credential travels in GIT_CONFIG_* variables, so it is in no file, no remote URL and no argv.
 */
export function gitAuthEnv(cfg: GithubConfig | null = githubConfig()): Record<string, string> {
  if (!cfg) return {};
  const basic = Buffer.from(`x-access-token:${cfg.token}`).toString('base64');
  // Append after any GIT_CONFIG_* entries already in the environment instead of replacing them.
  const n = Number.parseInt(process.env.GIT_CONFIG_COUNT ?? '0', 10) || 0;
  return {
    GIT_CONFIG_COUNT: String(n + 1),
    [`GIT_CONFIG_KEY_${n}`]: 'http.https://github.com/.extraheader',
    [`GIT_CONFIG_VALUE_${n}`]: `AUTHORIZATION: basic ${basic}`,
  };
}

/** Text with the configured GitHub token removed (no-op when there is none). */
export function redactConfigured(text: string): string {
  const token = process.env.DEMIURGO_GITHUB_TOKEN?.trim();
  return token ? redactToken(text, token) : text;
}

/** Runs git in `dir`; `network` calls carry the GitHub credential and their errors are scrubbed of it. */
export async function runGit(dir: string, args: string[], opts: { network?: boolean } = {}): Promise<string> {
  try {
    // DEMIURGO's own repositories: never refused for ownership (see build/workspace.ts).
    const { stdout } = await run('git', ['-c', 'safe.directory=*', '-C', dir, ...args], {
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(opts.network ? gitAuthEnv() : {}) },
    });
    return stdout;
  } catch (e) {
    const err = e as { stderr?: string; message: string };
    throw new DomainError('validation', redactConfigured(`git ${args.join(' ')} failed: ${err.stderr || err.message}`));
  }
}

const git = (dir: string, args: string[]) => runGit(dir, args);

/** Pushes a branch; the credential lives only in this child process's environment. */
export async function pushBranch(repoDir: string, branch: string, _cfg?: GithubConfig): Promise<void> {
  await runGit(repoDir, ['push', 'origin', branch], { network: true });
}

/**
 * Brings origin's main (merged pull requests: application code) into the local main, which carries
 * DEMIURGO's design/ commits, so the push that follows is a fast-forward. A merge commit keeps both
 * histories (squash-merged PRs cannot be rebased onto cleanly). The two sides touch different paths;
 * if they conflict anyway the merge is aborted, leaving the repo clean, and the step fails.
 */
export async function integrateOriginMain(repoDir: string): Promise<void> {
  try {
    await runGit(repoDir, ['fetch', 'origin', 'main'], { network: true });
  } catch (e) {
    // A brand-new remote has no main yet: nothing to integrate, the push creates it.
    if (/couldn't find remote ref/i.test(e instanceof Error ? e.message : String(e))) return;
    throw e;
  }
  const behind = Number((await runGit(repoDir, ['rev-list', '--count', 'main..origin/main'])).trim());
  if (!behind) return;
  try {
    await runGit(repoDir, [
      '-c',
      'user.name=DEMIURGO',
      '-c',
      'user.email=demiurgo@demiurgo.local',
      '-c',
      'commit.gpgsign=false',
      'merge',
      '--no-edit',
      'origin/main',
    ]);
  } catch (e) {
    await runGit(repoDir, ['merge', '--abort']).catch(() => undefined);
    throw new DomainError(
      'validation',
      `Could not merge origin/main into the project's main (the merge was aborted, the repository is unchanged): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

// ---------------------------------------------------------------------------------- repository

export const repoNameFor = (dir: string) =>
  dir
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|-+$/g, '') || 'project';

export const REQUIRED_CHECKS = ['ci', 'demiurgo/review', 'demiurgo/design'];

export type ProjectGithub = { owner: string; repo: string; url: string; protection: 'github' | 'demiurgo' };

/**
 * GitHub answers 403 (or 404) to these calls when the plan lacks the feature. Per GitHub Docs,
 * protected branches ("About protected branches", https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
 * and auto-merge ("Automatically merging a pull request", https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/automatically-merging-a-pull-request)
 * are available in public repositories with GitHub Free, and in public and private repositories only
 * with Pro, Team and Enterprise. A private repo on Free therefore has neither, and DEMIURGO enforces
 * the rule itself (build/orchestrator.ts, merge stage).
 */
const planLimited = (e: unknown) => /\((403|404)\)/.test(e instanceof Error ? e.message : String(e));

/**
 * Creates (if missing) the project's private repo, links the local one, pushes main and protects it.
 * Idempotent, and it writes nothing to the database: the `repository.connect` command saves the link
 * with its event, after this has run outside any transaction.
 */
export async function provisionProjectRepo(db: Db, projectId: string, cfg: GithubConfig): Promise<ProjectGithub> {
  const known = await db.selectFrom('project_repos').select('dir').where('project_id', '=', projectId).executeTakeFirst();
  const root = projectsDir();
  if (!known || !root) throw new DomainError('not_found', 'The project has no local repository yet.');
  const repoDir = join(root, known.dir);
  const { owner } = cfg;
  const repo = repoNameFor(known.dir);

  const existing = await call(cfg, 'GET', `/repos/${owner}/${repo}`, { okStatuses: [404] });
  if (existing.status === 404) {
    const who = await call(cfg, 'GET', `/users/${owner}`);
    const path = who.data?.type === 'Organization' ? `/orgs/${owner}/repos` : '/user/repos';
    await call(cfg, 'POST', path, { body: { name: repo, private: true, auto_init: false } });
  }
  let protection: 'github' | 'demiurgo' = 'github';
  try {
    await call(cfg, 'PATCH', `/repos/${owner}/${repo}`, {
      body: { allow_auto_merge: true, delete_branch_on_merge: true, allow_squash_merge: true },
    });
  } catch (e) {
    if (!planLimited(e)) throw e;
    protection = 'demiurgo';
    // The repo still needs squash merges and branch cleanup, which every plan allows.
    await call(cfg, 'PATCH', `/repos/${owner}/${repo}`, { body: { delete_branch_on_merge: true, allow_squash_merge: true } });
  }

  const url = `https://github.com/${owner}/${repo}.git`;
  const remotes = (await git(repoDir, ['remote'])).split('\n').map((r) => r.trim());
  await git(repoDir, remotes.includes('origin') ? ['remote', 'set-url', 'origin', url] : ['remote', 'add', 'origin', url]);
  await integrateOriginMain(repoDir);
  await pushBranch(repoDir, 'main', cfg);

  try {
    await call(cfg, 'PUT', `/repos/${owner}/${repo}/branches/main/protection`, {
      body: {
        required_status_checks: { strict: true, contexts: REQUIRED_CHECKS },
        enforce_admins: false,
        required_pull_request_reviews: { required_approving_review_count: 0 },
        restrictions: null,
      },
    });
  } catch (e) {
    if (!planLimited(e)) throw e;
    protection = 'demiurgo';
  }
  if (protection === 'demiurgo') {
    console.warn(
      `[github] ${owner}/${repo}: branch protection or auto-merge is not available on this GitHub plan (private repo on Free); DEMIURGO enforces the merge rule itself (${REQUIRED_CHECKS.join(', ')} must be green).`,
    );
  }

  return { owner, repo, url: `https://github.com/${owner}/${repo}`, protection };
}

/** Provisions the repo and links it in `project_github` (no event). The build orchestrator uses it. */
export async function ensureProjectRepo(db: Db, projectId: string, cfg: GithubConfig): Promise<ProjectGithub> {
  const linked = await provisionProjectRepo(db, projectId, cfg);
  await db
    .insertInto('project_github')
    .values({ project_id: projectId, owner: linked.owner, repo: linked.repo, protection: linked.protection })
    .onConflict((oc) => oc.column('project_id').doUpdateSet({ protection: linked.protection }))
    .execute();
  return linked;
}

// ---------------------------------------------------------------------------------- pull requests

export async function openPullRequest(
  cfg: GithubConfig,
  a: { owner: string; repo: string; head: string; base?: string; title: string; body: string },
): Promise<{ number: number; url: string; nodeId: string; headSha: string }> {
  const { data } = await call(cfg, 'POST', `/repos/${a.owner}/${a.repo}/pulls`, {
    body: { title: a.title, body: a.body, head: a.head, base: a.base ?? 'main' },
  });
  return { number: data.number, url: data.html_url, nodeId: data.node_id, headSha: data.head?.sha };
}

export async function pullRequest(
  cfg: GithubConfig,
  owner: string,
  repo: string,
  number: number,
): Promise<{ state: string; merged: boolean; mergedAt: string | null; mergeCommitSha: string | null; headSha: string; url: string }> {
  const { data } = await call(cfg, 'GET', `/repos/${owner}/${repo}/pulls/${number}`);
  return {
    state: data.state,
    merged: Boolean(data.merged),
    mergedAt: data.merged_at ?? null,
    // For a squash merge, the commit that landed on the base branch.
    mergeCommitSha: data.merge_commit_sha ?? null,
    headSha: data.head?.sha,
    url: data.html_url,
  };
}

export type PullRequestFile = { path: string; additions: number; deletions: number; status: string };

/** Cap on the files listed for one pull request (our convention: a task's footprint, not a full diff). */
export const PR_FILES_CAP = 300;

/** The files a pull request changes (REST GET /pulls/{n}/files, 100 per page), up to PR_FILES_CAP. */
export async function pullRequestFiles(cfg: GithubConfig, owner: string, repo: string, number: number): Promise<PullRequestFile[]> {
  const out: PullRequestFile[] = [];
  for (let page = 1; out.length < PR_FILES_CAP; page++) {
    const { data } = await call(cfg, 'GET', `/repos/${owner}/${repo}/pulls/${number}/files?per_page=100&page=${page}`);
    const rows: any[] = Array.isArray(data) ? data : [];
    for (const f of rows) {
      out.push({ path: String(f.filename), additions: Number(f.additions ?? 0), deletions: Number(f.deletions ?? 0), status: String(f.status ?? 'modified') });
    }
    if (rows.length < 100) break;
  }
  return out.slice(0, PR_FILES_CAP);
}

export type OpenPullRequest = { number: number; createdAt: string; headRef: string; headRepo: string | null };

/** Every open pull request of the repository (paged, newest first). */
export async function listOpenPullRequests(cfg: GithubConfig, owner: string, repo: string): Promise<OpenPullRequest[]> {
  const out: OpenPullRequest[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data } = await call(
      cfg,
      'GET',
      `/repos/${owner}/${repo}/pulls?state=open&sort=created&direction=desc&per_page=100&page=${page}`,
    );
    const rows: any[] = Array.isArray(data) ? data : [];
    for (const p of rows) {
      out.push({
        number: p.number,
        createdAt: String(p.created_at),
        headRef: String(p.head?.ref ?? ''),
        headRepo: p.head?.repo?.full_name ?? null,
      });
    }
    if (rows.length < 100) break;
  }
  return out;
}

/** Comments on a pull request and closes it without merging. */
export async function closePullRequest(cfg: GithubConfig, owner: string, repo: string, number: number, comment: string): Promise<void> {
  await call(cfg, 'POST', `/repos/${owner}/${repo}/issues/${number}/comments`, { body: { body: comment } });
  await call(cfg, 'PATCH', `/repos/${owner}/${repo}/pulls/${number}`, { body: { state: 'closed' } });
}

/** Deletes a branch; already gone (404/422) is fine. */
export async function deleteBranch(cfg: GithubConfig, owner: string, repo: string, branch: string): Promise<void> {
  const ref = branch.split('/').map(encodeURIComponent).join('/');
  await call(cfg, 'DELETE', `/repos/${owner}/${repo}/git/refs/heads/${ref}`, { okStatuses: [404, 422] });
}

export const DIFF_CAP = 400_000;

export async function pullRequestDiff(cfg: GithubConfig, owner: string, repo: string, number: number): Promise<string> {
  const { text } = await call(cfg, 'GET', `/repos/${owner}/${repo}/pulls/${number}`, {
    accept: 'application/vnd.github.diff',
  });
  return text.length > DIFF_CAP ? text.slice(0, DIFF_CAP) : text;
}

export async function setCommitStatus(
  cfg: GithubConfig,
  owner: string,
  repo: string,
  sha: string,
  s: { context: string; state: 'pending' | 'success' | 'failure' | 'error'; description: string; target_url?: string },
): Promise<void> {
  await call(cfg, 'POST', `/repos/${owner}/${repo}/statuses/${sha}`, {
    body: {
      state: s.state,
      context: s.context,
      description: s.description.slice(0, 140),
      ...(s.target_url ? { target_url: s.target_url } : {}),
    },
  });
}

/** A review with event COMMENT. Inline comments whose line is not in the diff make GitHub answer 422: then only the body goes. */
export async function postReview(
  cfg: GithubConfig,
  owner: string,
  repo: string,
  number: number,
  review: { body: string; comments: { path: string; line: number; body: string }[] },
): Promise<void> {
  const path = `/repos/${owner}/${repo}/pulls/${number}/reviews`;
  const withComments = review.comments.length > 0;
  const first = await call(cfg, 'POST', path, {
    body: {
      event: 'COMMENT',
      body: review.body,
      ...(withComments
        ? { comments: review.comments.map((c) => ({ path: c.path, line: c.line, side: 'RIGHT', body: c.body })) }
        : {}),
    },
    okStatuses: withComments ? [422] : [],
  });
  if (first.status === 422) await call(cfg, 'POST', path, { body: { event: 'COMMENT', body: review.body } });
}

export async function enableAutoMerge(cfg: GithubConfig, pullRequestNodeId: string): Promise<void> {
  await graphql(
    cfg,
    `mutation($id: ID!) { enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: SQUASH }) { pullRequest { number } } }`,
    { id: pullRequestNodeId },
  );
}

/** Squash-merges a pull request now (branch protection still demands the required checks). */
export async function mergePullRequest(cfg: GithubConfig, owner: string, repo: string, number: number): Promise<void> {
  await call(cfg, 'PUT', `/repos/${owner}/${repo}/pulls/${number}/merge`, { body: { merge_method: 'squash' } });
}

/** How many commits the base branch has that the head does not (GitHub compare API: `behind_by`). 0 means up to date. */
export async function behindBy(cfg: GithubConfig, owner: string, repo: string, base: string, headSha: string): Promise<number> {
  const { data } = await call(cfg, 'GET', `/repos/${owner}/${repo}/compare/${encodeURIComponent(base)}...${headSha}`);
  return Number(data?.behind_by ?? 0);
}

/**
 * Merges the base branch into the pull request's branch (GitHub REST «Update a pull request branch»). Returns
 * `updated` (GitHub merges asynchronously: the new head shows on the pull request shortly after), or `conflict`
 * (422: the branch conflicts with the base, a person or the builder must resolve it).
 */
export async function updateBranch(
  cfg: GithubConfig,
  owner: string,
  repo: string,
  number: number,
  expectedHeadSha: string,
): Promise<{ result: 'updated' } | { result: 'conflict'; message: string }> {
  const { status, data } = await call(cfg, 'PUT', `/repos/${owner}/${repo}/pulls/${number}/update-branch`, {
    body: { expected_head_sha: expectedHeadSha },
    okStatuses: [422],
  });
  if (status === 422) {
    const message = redactToken(String(data?.message ?? ''), cfg.token);
    // 422 also means «expected_head_sha does not match»: only a merge conflict is a conflict.
    if (!/conflict/i.test(message)) throw new DomainError('validation', `GitHub PUT /repos/${owner}/${repo}/pulls/${number}/update-branch failed (422): ${message}`);
    return { result: 'conflict', message };
  }
  return { result: 'updated' };
}

export type CheckRun = { name: string; status: string; conclusion: string | null; detailsUrl: string | null };

export async function checkRunsFor(cfg: GithubConfig, owner: string, repo: string, sha: string): Promise<CheckRun[]> {
  const { data } = await call(cfg, 'GET', `/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`);
  return (data?.check_runs ?? []).map((c: any) => ({
    name: c.name,
    status: c.status,
    conclusion: c.conclusion ?? null,
    detailsUrl: c.details_url ?? null,
  }));
}

/**
 * Cancels every GitHub Actions workflow run of a head SHA that has not completed (GitHub REST «List workflow runs
 * for a repository» with `head_sha`, then «Cancel a workflow run»). Returns how many cancellations were requested.
 */
export async function cancelWorkflowRuns(cfg: GithubConfig, owner: string, repo: string, sha: string): Promise<number> {
  const { data } = await call(cfg, 'GET', `/repos/${owner}/${repo}/actions/runs?head_sha=${sha}&per_page=100`);
  const open = (data?.workflow_runs ?? []).filter((w: any) => w.status !== 'completed');
  for (const w of open) await call(cfg, 'POST', `/repos/${owner}/${repo}/actions/runs/${w.id}/cancel`, { okStatuses: [409] });
  return open.length;
}

/**
 * Re-runs the workflow runs of a head SHA that ended cancelled (DEMIURGO cancels them when the review rejects first):
 * a new attempt on the same commit then gets a real CI result instead of the old «cancelled» (GitHub REST «Re-run a
 * workflow»). Returns how many re-runs were requested.
 */
export async function rerunCancelledRuns(cfg: GithubConfig, owner: string, repo: string, sha: string): Promise<number> {
  const { data } = await call(cfg, 'GET', `/repos/${owner}/${repo}/actions/runs?head_sha=${sha}&per_page=100`);
  const cancelled = (data?.workflow_runs ?? []).filter((w: any) => w.status === 'completed' && w.conclusion === 'cancelled');
  for (const w of cancelled) await call(cfg, 'POST', `/repos/${owner}/${repo}/actions/runs/${w.id}/rerun`, { okStatuses: [403, 409] });
  return cancelled.length;
}

const PASSING_CONCLUSIONS = new Set(['success', 'neutral', 'skipped']);

export type CiStatus =
  | { state: 'missing'; conclusion: null; runs: 0; failed: [] }
  | { state: 'pending'; conclusion: null; runs: number; failed: string[] }
  | { state: 'done'; conclusion: string; runs: number; failed: string[] };

/**
 * The state of a required check on a head SHA, as GitHub branch protection reads it: EVERY check run with
 * that name (a workflow that runs on `push` and on `pull_request` yields two) must have completed and none
 * may have failed. Missing: no run yet. Pending: some run has not completed. Done: all completed, and the
 * conclusion is `success` only when all of them passed, else the first bad one (`failure`, `cancelled`,
 * `timed_out`, `action_required`, ...). `failed` lists the bad runs' conclusions.
 */
export function ciStatusOf(checks: CheckRun[], name = 'ci'): CiStatus {
  const runs = checks.filter((c) => c.name === name);
  if (runs.length === 0) return { state: 'missing', conclusion: null, runs: 0, failed: [] };
  const bad = runs.filter((c) => c.status === 'completed' && !PASSING_CONCLUSIONS.has(c.conclusion ?? ''));
  const failed = bad.map((c) => c.conclusion ?? 'unknown');
  if (runs.some((c) => c.status !== 'completed')) return { state: 'pending', conclusion: null, runs: runs.length, failed };
  return { state: 'done', conclusion: failed[0] ?? 'success', runs: runs.length, failed };
}

// ---------------------------------------------------------------------------------- artifacts

/** The text of every *.xml entry of a zip (stored and deflate entries), concatenated. */
export function unzipXml(zip: Buffer): string {
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0 && i >= zip.length - 22 - 65535; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new DomainError('validation', 'The artifact is not a valid zip.');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  const parts: string[] = [];
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new DomainError('validation', 'The artifact zip is corrupt.');
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const name = zip.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (!name.toLowerCase().endsWith('.xml')) continue;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + compSize);
    if (method === 0) parts.push(raw.toString('utf8'));
    else if (method === 8) parts.push(inflateRawSync(raw).toString('utf8'));
    else throw new DomainError('validation', `The artifact zip uses an unsupported compression (${method}).`);
  }
  return parts.join('\n');
}

/** The id of the workflow run a check run belongs to, from its details URL (`…/actions/runs/<id>/job/<id>`). */
export const workflowRunIdOf = (detailsUrl: string | null): string | null => /\/actions\/runs\/(\d+)/.exec(detailsUrl ?? '')?.[1] ?? null;

/**
 * The JUnit XML from the artifact named `junit` of EVERY workflow run that produced a `ci` check of a head
 * SHA, concatenated (the same test failing in one run and passing in another shows as both cases), or, when
 * the checks do not say which run, of the latest run. Null without any.
 */
export async function junitArtifactFor(cfg: GithubConfig, owner: string, repo: string, headSha: string): Promise<string | null> {
  const checks = (await checkRunsFor(cfg, owner, repo, headSha)).filter((c) => c.name === 'ci');
  const runIds = [...new Set(checks.map((c) => workflowRunIdOf(c.detailsUrl)).filter((id): id is string => id !== null))];
  if (runIds.length === 0) {
    const runs = await call(cfg, 'GET', `/repos/${owner}/${repo}/actions/runs?head_sha=${encodeURIComponent(headSha)}&per_page=1`);
    const latest = runs.data?.workflow_runs?.[0];
    if (!latest) return null;
    runIds.push(String(latest.id));
  }
  const parts: string[] = [];
  for (const runId of runIds) {
    const list = await call(cfg, 'GET', `/repos/${owner}/${repo}/actions/runs/${runId}/artifacts`);
    const artifact = (list.data?.artifacts ?? []).find((a: any) => a.name === 'junit' && !a.expired);
    if (!artifact) continue;
    const res = await call(cfg, 'GET', `/repos/${owner}/${repo}/actions/artifacts/${artifact.id}/zip`, { raw: true });
    parts.push(unzipXml(Buffer.from(await (res.data as Response).arrayBuffer())));
  }
  return parts.length > 0 ? parts.join('\n') : null;
}
