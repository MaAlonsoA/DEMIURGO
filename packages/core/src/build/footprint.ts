// The footprint of a merged task: the merge commit and the files its pull request changed. DEMIURGO
// keeps it on the merge step (detail.footprint) so later briefs can name the code earlier tasks left
// (Aider's repo map, aider.chat/docs/repomap.html; Nx "affected": files changed per git mapped to
// projects). Read back with `taskFootprints`.

import type { Db } from '../db/connection.ts';
import type { GithubConfig, PullRequestFile } from '../github/client.ts';

export type FootprintFile = PullRequestFile;
export type Footprint = { merge_commit: string | null; files: FootprintFile[] };

/** The GitHub calls the footprint needs (a subset of the build's GithubApi). */
export type FootprintApi = {
  pullRequest: (cfg: GithubConfig, owner: string, repo: string, number: number) => Promise<{ mergeCommitSha: string | null }>;
  pullRequestFiles: (cfg: GithubConfig, owner: string, repo: string, number: number) => Promise<FootprintFile[]>;
};

export async function pullRequestFootprint(
  github: FootprintApi,
  cfg: GithubConfig,
  repo: { owner: string; repo: string },
  prNumber: number,
): Promise<Footprint> {
  const [pull, files] = await Promise.all([
    github.pullRequest(cfg, repo.owner, repo.repo, prNumber),
    github.pullRequestFiles(cfg, repo.owner, repo.repo, prNumber),
  ]);
  return {
    merge_commit: pull.mergeCommitSha ?? null,
    files: files.map((f) => ({ path: f.path, additions: f.additions, deletions: f.deletions, status: f.status })),
  };
}

/** Lockfiles, snapshots and generated files say nothing about what to reuse (our convention). */
const NOISE = [/(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock)$/, /\.snap$/, /(^|\/)__snapshots__\//, /(^|\/)generated\//, /\.generated\.[a-z]+$/, /\.min\.(js|css)$/, /(^|\/)dist\//];

export const isReusableFile = (path: string): boolean => !NOISE.some((re) => re.test(path));

export type TaskFootprint = { code: string; title: string; merge_commit: string | null; files: FootprintFile[] };

/**
 * The footprint of each merged task: its code and the files its merged pull request changed. It reads
 * `detail.footprint` of the merge step (written by the flow) or of a `footprint` step (written by the
 * backfill command); the latest merged request of a task wins.
 */
export async function taskFootprints(db: Db, projectId: string): Promise<TaskFootprint[]> {
  const rows = await db
    .selectFrom('build_requests as b')
    .innerJoin('records as r', 'r.id', 'b.task_id')
    .innerJoin('build_steps as s', 's.build_request_id', 'b.id')
    .select(['r.code', 'b.id as request', 'b.done_at', 's.stage', 's.detail', 's.created_at', 's.id as step'])
    .where('b.project_id', '=', projectId)
    .where('b.state', '=', 'done')
    .where('s.outcome', '=', 'ok')
    .where('s.stage', 'in', ['merge', 'footprint'])
    .orderBy('s.created_at')
    .orderBy('s.id')
    .execute();
  const titles = new Map<string, string>();
  const byTask = new Map<string, { done: string; fp: Footprint }>();
  for (const row of rows) {
    const raw = (row.detail as { footprint?: Footprint } | null)?.footprint;
    if (!raw || !Array.isArray(raw.files)) continue;
    const done = String(row.done_at ?? '');
    const prev = byTask.get(row.code);
    if (prev && prev.done > done) continue;
    byTask.set(row.code, { done, fp: { merge_commit: raw.merge_commit ?? null, files: raw.files } });
  }
  if (byTask.size > 0) {
    const t = await db
      .selectFrom('records')
      .innerJoin('record_versions as v', 'v.record_id', 'records.id')
      .select(['records.code', 'v.title', 'v.n'])
      .where('records.project_id', '=', projectId)
      .where('records.code', 'in', [...byTask.keys()])
      .where('v.state', '=', 'approved')
      .orderBy('v.n')
      .execute();
    for (const x of t) titles.set(x.code, x.title);
  }
  return [...byTask.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([code, { fp }]) => ({ code, title: titles.get(code) ?? code, merge_commit: fp.merge_commit, files: fp.files }));
}
