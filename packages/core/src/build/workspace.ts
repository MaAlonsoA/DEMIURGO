// Git worktrees for the builder: each build gets its own branch and folder under
// DEMIURGO_PROJECTS_DIR/.worktrees, so the project's main checkout is never touched while an agent
// edits code. DEMIURGO commits after the agent exits; the agent never sees git credentials.

import { execFile } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
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

/** Branch name for a task build: `task/<code lowercase>-<first 8 of the build id>`. */
export function branchName(taskCode: string, buildId: string): string {
  return `task/${taskCode.toLowerCase().replace(/[^a-z0-9-]+/g, '-')}-${buildId.slice(0, 8)}`;
}

async function hasOrigin(repoDir: string): Promise<boolean> {
  const { stdout } = await git(repoDir, ['remote']);
  return stdout.split('\n').map((l) => l.trim()).includes('origin');
}

/** Creates the branch from `main` (or `origin/main` after fetching it) in a new worktree. */
export async function prepareWorktree(input: { repoDir: string; taskCode: string; buildId: string }): Promise<Worktree> {
  const root = projectsDir();
  if (!root) throw new Error('DEMIURGO_PROJECTS_DIR is not set.');
  const branch = branchName(input.taskCode, input.buildId);
  const path = join(root, '.worktrees', input.buildId);
  await mkdir(join(root, '.worktrees'), { recursive: true });
  let base = 'main';
  if (await hasOrigin(input.repoDir)) {
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
