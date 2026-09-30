// Git worktrees for the builder: each build gets its own branch and folder under
// DEMIURGO_PROJECTS_DIR/.worktrees, so the project's main checkout is never touched while an agent
// edits code. DEMIURGO commits after the agent exits; the agent never sees git credentials.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { projectsDir } from '../repo/repo.ts';

const run = promisify(execFile);
const git = (dir: string, args: string[]) => run('git', ['-C', dir, ...args], { maxBuffer: 16 * 1024 * 1024 });

export const BUILDER_AUTHOR = 'DEMIURGO builder <builder@demiurgo.local>';

export type Worktree = { path: string; branch: string };

const parseAuthor = (author: string): { name: string; email: string } => {
  const m = /^(.*?)\s*<([^>]+)>$/.exec(author.trim());
  return m ? { name: m[1] || 'DEMIURGO builder', email: m[2] as string } : { name: author, email: 'builder@demiurgo.local' };
};

/** Branch name for a task build: `task/<code lowercase>-<last 8 hex of the build id>` (a uuidv7 starts with its timestamp: the tail is the random part). */
export function branchName(taskCode: string, buildId: string): string {
  return `task/${taskCode.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-${buildId.replace(/-/g, '').slice(-8)}`;
}

async function hasOrigin(repoDir: string): Promise<boolean> {
  const { stdout } = await git(repoDir, ['remote']);
  return stdout.split('\n').map((l) => l.trim()).includes('origin');
}

async function branchExists(repoDir: string, ref: string): Promise<boolean> {
  try {
    await git(repoDir, ['rev-parse', '--verify', '--quiet', ref]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Creates the branch from `main` (or `origin/main` after fetching it) in a new worktree. With an
 * `existingBranch` (a second attempt on the same pull request) it reuses the worktree if it is still
 * there, else checks the branch out (from the local branch, or from origin's).
 */
export async function prepareWorktree(input: { repoDir: string; taskCode: string; buildId: string; existingBranch?: string | null }): Promise<Worktree> {
  const root = projectsDir();
  if (!root) throw new Error('DEMIURGO_PROJECTS_DIR is not set.');
  const path = join(root, '.worktrees', input.buildId);
  await mkdir(join(root, '.worktrees'), { recursive: true });
  const origin = await hasOrigin(input.repoDir);
  if (input.existingBranch) {
    const branch = input.existingBranch;
    if (existsSync(path)) return { path, branch };
    await git(input.repoDir, ['worktree', 'prune']);
    if (origin) await git(input.repoDir, ['fetch', 'origin', branch]).catch(() => undefined);
    if (await branchExists(input.repoDir, `refs/heads/${branch}`)) {
      await git(input.repoDir, ['worktree', 'add', path, branch]);
    } else {
      await git(input.repoDir, ['worktree', 'add', '-b', branch, path, `origin/${branch}`]);
    }
    return { path, branch };
  }
  const branch = branchName(input.taskCode, input.buildId);
  // A step that repeats after a crash finds its worktree already made.
  if (existsSync(path)) return { path, branch };
  let base = 'main';
  if (origin) {
    await git(input.repoDir, ['fetch', 'origin', 'main']);
    base = 'origin/main';
  }
  await git(input.repoDir, ['worktree', 'add', '-b', branch, path, base]);
  return { path, branch };
}

/** `git diff --stat` of everything the builder changed, new files included. */
export async function diffStat(path: string): Promise<string> {
  await git(path, ['add', '-A', '--intent-to-add']);
  const { stdout } = await git(path, ['diff', '--stat', 'HEAD']);
  return stdout.trim();
}

/** Commits every change; returns the sha, or null when nothing changed. */
export async function commitAll(path: string, message: string, author: string = BUILDER_AUTHOR): Promise<string | null> {
  await git(path, ['add', '-A']);
  const { stdout: status } = await git(path, ['status', '--porcelain']);
  if (!status.trim()) return null;
  const { name, email } = parseAuthor(author);
  await git(path, [
    '-c', `user.name=${name}`,
    '-c', `user.email=${email}`,
    '-c', 'commit.gpgsign=false',
    'commit', '-q', '-m', message,
  ]);
  const { stdout } = await git(path, ['rev-parse', 'HEAD']);
  return stdout.trim();
}

/** Removes the worktree (the branch stays, it holds the work). */
export async function removeWorktree(repoDir: string, path: string): Promise<void> {
  await git(repoDir, ['worktree', 'remove', '--force', path]);
}

/** The host path of a path inside this container (`/projects/x` becomes `${HOST_DIR}/x`). */
export function hostPathOf(containerPath: string): string {
  const root = projectsDir();
  const host = process.env.DEMIURGO_PROJECTS_HOST_DIR?.trim();
  if (!root || !host) throw new Error('DEMIURGO_PROJECTS_DIR and DEMIURGO_PROJECTS_HOST_DIR must be set.');
  const trimmed = root.replace(/\/+$/, '');
  if (containerPath !== trimmed && !containerPath.startsWith(`${trimmed}/`)) {
    throw new Error(`${containerPath} is not inside ${trimmed}.`);
  }
  return host.replace(/\/+$/, '') + containerPath.slice(trimmed.length);
}

/** Text files this large or larger are skipped by the design check (bundles, generated files). */
const MAX_CHECKED_BYTES = 512 * 1024;

/**
 * The tracked files of the worktree (after the commit) that `keep` selects, with their content,
 * for the deterministic design check. Paths are relative and use `/`.
 */
export async function readWorktreeFiles(path: string, keep: (file: string) => boolean): Promise<{ path: string; content: string }[]> {
  const { stdout } = await git(path, ['ls-files', '-z']);
  const out: { path: string; content: string }[] = [];
  for (const file of stdout.split('\0').filter((f) => f && keep(f))) {
    const full = join(path, file);
    const info = await stat(full).catch(() => null);
    if (!info?.isFile() || info.size >= MAX_CHECKED_BYTES) continue;
    out.push({ path: file, content: await readFile(full, 'utf8') });
  }
  return out;
}

/** One file of the worktree, or null if it is not there. */
export async function readWorktreeFile(path: string, file: string): Promise<string | null> {
  return readFile(join(path, file), 'utf8').catch(() => null);
}
