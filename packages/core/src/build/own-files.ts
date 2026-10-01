// Backfill of `own_files` for commit steps recorded before the builder stored it (harness health B17): the files an
// attempt changed on its own, from git. Same meaning as the orchestrator: the attempt's commit against the previous
// attempt's ok commit; the first attempt changed the whole branch (its diff against main). Pure planning over the
// journal plus read-only git; the command records the rows (append-only, stage `footprint`, like the footprint backfill).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Db } from '../db/connection.ts';

const run = promisify(execFile);
const git = (dir: string, args: string[]) => run('git', ['-c', 'safe.directory=*', '-C', dir, ...args], { maxBuffer: 16 * 1024 * 1024 });
const MAX_FILES = 300;

export type OwnFilesRow = { requestId: string; attempt: number; commitStepId: string; sha: string; ownFiles: string[] };
export type OwnFilesPlan = { commits: number; already: number; missing: number; rows: OwnFilesRow[] };

const objectOf = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

async function hasCommit(dir: string, sha: string): Promise<boolean> {
  try {
    await git(dir, ['cat-file', '-e', `${sha}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

async function names(dir: string, args: string[]): Promise<string[] | null> {
  try {
    return (await git(dir, ['diff', '--name-only', ...args])).stdout.split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

/** The files changed between two commits, or null when git cannot tell. */
export const filesBetween = (dir: string, from: string, to: string) => names(dir, [from, to]);

/**
 * The files the first attempt changed: the commit against its merge-base with main. A branch already merged by merge
 * commit has its tip as merge-base (an empty diff), so then the whole-branch `files` the step stored stand in.
 */
async function firstAttemptFiles(dir: string, sha: string, stored: string[] | null, branch: string): Promise<string[] | null> {
  for (const ref of [branch, `origin/${branch}`]) {
    try {
      const base = (await git(dir, ['merge-base', ref, sha])).stdout.trim();
      if (!base) continue;
      if (base === sha) return stored;
      return await filesBetween(dir, base, sha);
    } catch {
      /* try the next ref */
    }
  }
  return stored;
}

/** Plans the `own_files` of every ok commit step of the project that lacks them and has no backfilled row yet. */
export async function planOwnFilesBackfill(db: Db, projectId: string, repoDir: string, branch = 'main'): Promise<OwnFilesPlan> {
  const steps = await db
    .selectFrom('build_steps')
    .select(['id', 'build_request_id', 'attempt', 'stage', 'outcome', 'detail', 'created_at'])
    .where('project_id', '=', projectId)
    .where((eb) => eb.or([eb.and([eb('stage', '=', 'commit'), eb('outcome', '=', 'ok')]), eb('stage', '=', 'footprint')]))
    .orderBy('build_request_id')
    .orderBy('attempt')
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  const done = new Set<string>();
  const byRequest = new Map<string, typeof steps>();
  for (const s of steps) {
    if (s.stage === 'footprint') {
      const d = objectOf(s.detail);
      if (d.backfilled === true && Array.isArray(d.own_files) && typeof d.commit_step_id === 'string') done.add(d.commit_step_id);
      continue;
    }
    byRequest.set(s.build_request_id, [...(byRequest.get(s.build_request_id) ?? []), s]);
  }
  const plan: OwnFilesPlan = { commits: 0, already: 0, missing: 0, rows: [] };
  for (const [requestId, commits] of byRequest) {
    for (const [k, s] of commits.entries()) {
      const d = objectOf(s.detail);
      if (typeof d.sha !== 'string' || !d.sha) continue;
      plan.commits++;
      if (Array.isArray(d.own_files) || done.has(s.id)) {
        plan.already++;
        continue;
      }
      // The latest ok commit of an earlier attempt (the orchestrator's previousCommitSha).
      const previous = commits.slice(0, k).filter((p) => p.attempt < s.attempt).at(-1);
      const previousSha = previous ? objectOf(previous.detail).sha : null;
      const stored = Array.isArray(d.files) ? d.files.filter((f): f is string => typeof f === 'string') : null;
      let own: string[] | null = null;
      if (await hasCommit(repoDir, d.sha)) {
        if (typeof previousSha === 'string' && previousSha) own = (await hasCommit(repoDir, previousSha)) ? await filesBetween(repoDir, previousSha, d.sha) : null;
        else if (!previous) own = await firstAttemptFiles(repoDir, d.sha, stored, branch);
      }
      if (!own) {
        plan.missing++;
        continue;
      }
      plan.rows.push({ requestId, attempt: s.attempt, commitStepId: s.id, sha: d.sha, ownFiles: own.slice(0, MAX_FILES) });
    }
  }
  return plan;
}
