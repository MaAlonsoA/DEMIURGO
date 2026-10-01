// Git worktrees for the builder: each build gets its own branch and folder under
// DEMIURGO_PROJECTS_DIR/.worktrees, so the project's main checkout is never touched while an agent
// edits code. DEMIURGO commits after the agent exits; the agent never sees git credentials.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { projectsDir } from '../repo/repo.ts';
import { runGit } from '../github/client.ts';

const run = promisify(execFile);
// The repositories under /projects are DEMIURGO's own: git must not refuse them for ownership
// ("dubious ownership" after an image or volume change stopped a build).
const git = (dir: string, args: string[]) => run('git', ['-c', 'safe.directory=*', '-C', dir, ...args], { maxBuffer: 16 * 1024 * 1024 });

export const BUILDER_AUTHOR = 'DEMIURGO builder <builder@demiurgo.local>';

/** `conflicts`: files of an origin/main merge left in progress for the builder to resolve. */
export type Worktree = { path: string; branch: string; conflicts?: string[] };

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
 * Fast-forwards the worktree's branch to origin's copy of it when GitHub moved it (its «Update branch» merges the
 * base into the pull request's branch), so a later push stays a fast-forward. Best effort: anything else is left alone.
 */
async function followRemoteBranch(repoDir: string, worktree: string, branch: string): Promise<void> {
  try {
    await runGit(repoDir, ['fetch', 'origin', branch], { network: true });
    const ahead = Number((await git(worktree, ['rev-list', '--count', 'HEAD..FETCH_HEAD'])).stdout.trim());
    if (ahead) await git(worktree, ['merge', '--ff-only', 'FETCH_HEAD']);
  } catch {
    // no remote copy yet, or the histories diverged: the integration below decides
  }
}

const conflictedFiles = async (worktree: string): Promise<string[]> =>
  (await git(worktree, ['diff', '--name-only', '--diff-filter=U'])).stdout.split('\n').map((l) => l.trim()).filter(Boolean);

/**
 * Merges origin's main into the worktree's branch (a merge commit, like the one the project's main
 * gets before it is pushed), so «Address the review» builds on the code merged meanwhile. When the merge
 * conflicts with files of the branch, it is left in progress with its conflict markers and the files are
 * returned: the builder resolves them (the next commit concludes the merge). Any other failure aborts the
 * merge, leaving the branch as it was, and fails the step.
 */
async function integrateOriginMain(repoDir: string, worktree: string): Promise<string[]> {
  try {
    await runGit(repoDir, ['fetch', 'origin', 'main'], { network: true });
  } catch (e) {
    // A remote with no main yet: nothing to integrate.
    if (/couldn't find remote ref/i.test(e instanceof Error ? e.message : String(e))) return [];
    throw e;
  }
  // A merge a previous attempt left in progress: its conflicts are still the builder's to resolve.
  if (await git(worktree, ['rev-parse', '-q', '--verify', 'MERGE_HEAD']).then(() => true, () => false)) return conflictedFiles(worktree);
  const behind = Number((await git(worktree, ['rev-list', '--count', 'HEAD..origin/main'])).stdout.trim());
  if (!behind) return [];
  try {
    await git(worktree, ['-c', 'user.name=DEMIURGO', '-c', 'user.email=demiurgo@demiurgo.local', '-c', 'commit.gpgsign=false', 'merge', '--no-edit', 'origin/main']);
    return [];
  } catch (e) {
    const conflicts = await conflictedFiles(worktree);
    if (conflicts.length > 0) return conflicts;
    await git(worktree, ['merge', '--abort']).catch(() => undefined);
    throw new Error(`Could not merge origin/main into the task branch (the merge was aborted, the branch is unchanged): ${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * Creates the branch from `main` (or `origin/main` after fetching it) in a new worktree. With an
 * `existingBranch` (a second attempt on the same pull request) it reuses the worktree if it is still
 * there, else checks the branch out (from the local branch, or from origin's).
 */
export async function prepareWorktree(input: { repoDir: string; taskCode: string; buildId: string; existingBranch?: string | null; skipIntegrate?: boolean }): Promise<Worktree> {
  const root = projectsDir();
  if (!root) throw new Error('DEMIURGO_PROJECTS_DIR is not set.');
  const path = join(root, '.worktrees', input.buildId);
  await mkdir(join(root, '.worktrees'), { recursive: true });
  const origin = await hasOrigin(input.repoDir);
  if (input.existingBranch) {
    const branch = input.existingBranch;
    if (existsSync(path)) {
      if (origin && !input.skipIntegrate) {
        await followRemoteBranch(input.repoDir, path, branch);
        const conflicts = await integrateOriginMain(input.repoDir, path);
        return { path, branch, ...(conflicts.length > 0 ? { conflicts } : {}) };
      }
      return { path, branch };
    }
    await git(input.repoDir, ['worktree', 'prune']);
    if (origin) await runGit(input.repoDir, ['fetch', 'origin', branch], { network: true }).catch(() => undefined);
    if (await branchExists(input.repoDir, `refs/heads/${branch}`)) {
      await git(input.repoDir, ['worktree', 'add', path, branch]);
    } else {
      await git(input.repoDir, ['worktree', 'add', '-b', branch, path, `origin/${branch}`]);
    }
    // A second attempt on the same pull request starts from what main has now (other tasks merged since).
    if (origin) {
      const conflicts = await integrateOriginMain(input.repoDir, path);
      if (conflicts.length > 0) return { path, branch, conflicts };
    }
    return { path, branch };
  }
  const branch = branchName(input.taskCode, input.buildId);
  // A step that repeats after a crash finds its worktree already made.
  if (existsSync(path)) return { path, branch };
  let base = 'main';
  if (origin) {
    await runGit(input.repoDir, ['fetch', 'origin', 'main'], { network: true });
    base = 'origin/main';
  }
  await git(input.repoDir, ['worktree', 'add', '-b', branch, path, base]);
  return { path, branch };
}

// The CI «paved road»: files DEMIURGO ships into every project (convención nuestra; platform teams provide the
// golden path, Skelton and Pais, «Team Topologies»). They are managed: rewritten on every build, never reviewed
// as the task's own change.
export const MANAGED_SELECT_E2E = '.demiurgo/select-e2e.mjs';
const MANAGED_HEADER = '// Managed by DEMIURGO: do not edit; it is replaced on every build.\n';
const SELECT_E2E_TEMPLATE = fileURLToPath(new URL('../../templates/ci/select-e2e.mjs', import.meta.url));

/** The content of the managed selector: the header and the template. */
export async function managedSelectE2eContent(): Promise<string> {
  return MANAGED_HEADER + (await readFile(SELECT_E2E_TEMPLATE, 'utf8'));
}

/** Writes `.demiurgo/select-e2e.mjs` into the worktree when it is missing or differs. True when it wrote. */
export async function ensureManagedFiles(path: string): Promise<boolean> {
  const content = await managedSelectE2eContent();
  const file = join(path, MANAGED_SELECT_E2E);
  if ((await readFile(file, 'utf8').catch(() => null)) === content) return false;
  await mkdir(join(file, '..'), { recursive: true });
  await writeFile(file, content);
  return true;
}

const notManaged = (p: string): boolean => p !== MANAGED_SELECT_E2E;

/** `git diff --stat` of everything the builder changed, new files included. */
export async function diffStat(path: string): Promise<string> {
  await writeExcludes(path);
  await git(path, ['add', '-A', '--intent-to-add']);
  const { stdout } = await git(path, ['diff', '--stat', 'HEAD']);
  return stdout.trim();
}

/** `git diff <from> <to>`: what changed between two commits; throws when either is not in the worktree. */
export async function diffBetween(path: string, from: string, to: string): Promise<string> {
  const { stdout } = await git(path, ['diff', from, to]);
  return stdout;
}

/** Names of the files that differ between two commits. */
export async function changedBetween(path: string, from: string, to: string): Promise<string[]> {
  const { stdout } = await git(path, ['diff', '--name-only', from, to]);
  return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** `git diff --numstat` between two commits (renames off, so every row is one path). */
export async function numstatBetween(path: string, from: string, to: string): Promise<string> {
  return (await git(path, ['diff', '--numstat', '--no-renames', from, to, '--', '.', `:(exclude)${MANAGED_SELECT_E2E}`])).stdout;
}

/** `git diff --name-status` between two commits (renames off: a move shows as a delete plus an add). */
export async function nameStatusBetween(path: string, from: string, to: string): Promise<string> {
  return (await git(path, ['diff', '--name-status', '--no-renames', from, to, '--', '.', `:(exclude)${MANAGED_SELECT_E2E}`])).stdout;
}

/** `git diff -U0` between two commits: the hunk headers say where each change sits. */
export async function unifiedZeroBetween(path: string, from: string, to: string): Promise<string> {
  return (await git(path, ['diff', '-U0', '--no-renames', '--no-color', from, to])).stdout;
}

/** A file's content at a revision (`git show <rev>:<file>`), or null when it does not exist there. */
export async function showAt(path: string, rev: string, file: string): Promise<string | null> {
  try {
    return (await git(path, ['show', `${rev}:${file}`])).stdout;
  } catch {
    return null;
  }
}

/** Tool caches that never belong in a commit (DEMIURGO's own ignore list, our convention). */
export const EXCLUDED_PATHS = ['.pw-browsers/', '.cache/', 'playwright-report/', 'test-results/', 'node_modules/', '.next/', '*.tsbuildinfo', 'core', 'core.[0-9]*', '*.core', '.demiurgo/'];

/** GitHub warns above 50 MB and refuses files above 100 MB (docs.github.com, «About large files on GitHub»); a build never commits a file above the warning. */
export const MAX_COMMITTED_FILE_BYTES = 50 * 1024 * 1024;
const EXCLUDE_MARKER = '# DEMIURGO: tool caches that are never committed';

/**
 * Writes DEMIURGO's ignore list into the worktree's git exclude file (local to the clone, never
 * committed), so `git add -A` skips caches the builder may have left (and cannot even read).
 * Idempotent. Returns the path of the exclude file.
 */
export async function writeExcludes(path: string): Promise<string> {
  const { stdout } = await git(path, ['rev-parse', '--git-path', 'info/exclude']);
  const raw = stdout.trim();
  const file = isAbsolute(raw) ? raw : join(path, raw);
  const current = await readFile(file, 'utf8').catch(() => '');
  const lines = new Set(current.split('\n').map((l) => l.trim()));
  // Only what is missing: an exclude file written by an older list gets the new entries too.
  const missing = EXCLUDED_PATHS.filter((p) => !lines.has(p));
  if (missing.length === 0) return file;
  await mkdir(join(file, '..'), { recursive: true });
  const header = lines.has(EXCLUDE_MARKER) ? '' : `${EXCLUDE_MARKER}\n`;
  await appendFile(file, `${current === '' || current.endsWith('\n') ? '' : '\n'}${header}${missing.join('\n')}\n`);
  return file;
}

/** Takes out of the index every staged file above MAX_COMMITTED_FILE_BYTES (a crash dump, a cache): GitHub would refuse the push. */
export async function unstageLargeFiles(path: string): Promise<string[]> {
  const { stdout } = await git(path, ['diff', '--cached', '--name-only', '--diff-filter=AM', '-z']);
  const large: string[] = [];
  for (const name of stdout.split('\0').filter(Boolean)) {
    const size = await stat(join(path, name)).then((s) => s.size).catch(() => 0);
    if (size > MAX_COMMITTED_FILE_BYTES) large.push(name);
  }
  if (large.length > 0) {
    await git(path, ['rm', '--cached', '-q', '--', ...large]);
    console.warn(`[build] left out of the commit, above ${MAX_COMMITTED_FILE_BYTES} bytes: ${large.join(', ')}`);
  }
  return large;
}

/** Commits every change; returns the sha, or null when nothing changed. */
export async function commitAll(path: string, message: string, author: string = BUILDER_AUTHOR): Promise<string | null> {
  await writeExcludes(path);
  await git(path, ['add', '-A']);
  await unstageLargeFiles(path);
  if (!(await git(path, ['status', '--porcelain'])).stdout.trim()) return null;
  // `.demiurgo/` is excluded, but the managed selector travels with the task's work so the project's CI can run it.
  if (existsSync(join(path, MANAGED_SELECT_E2E))) await git(path, ['add', '-f', '--', MANAGED_SELECT_E2E]);
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

/**
 * HEAD when the branch already holds this task's work (commits ahead of main): an earlier attempt committed it,
 * whether it got pushed or stopped before (at the design guard, or a restart that cut the attempt), so the next
 * attempt can go on with it even if the builder changes nothing more. Null when the branch has nothing of its own.
 */
export async function headWithWork(path: string): Promise<string | null> {
  try {
    const head = (await git(path, ['rev-parse', 'HEAD'])).stdout.trim();
    let base = '';
    for (const main of ['refs/remotes/origin/main', 'main']) {
      base = await git(path, ['merge-base', 'HEAD', main]).then((r) => r.stdout.trim()).catch(() => '');
      if (base) break;
    }
    if (!base) return null;
    const ahead = Number((await git(path, ['rev-list', '--count', '--no-merges', `${base}..HEAD`])).stdout.trim());
    return ahead > 0 ? head : null;
  } catch {
    return null;
  }
}

/** Files that still hold merge conflict markers or are unmerged, after staging (empty when clean). */
export async function unresolvedConflicts(path: string): Promise<string[]> {
  await git(path, ['add', '-A']);
  const { stdout: unmerged } = await git(path, ['diff', '--name-only', '--diff-filter=U']);
  const files = new Set(unmerged.split('\n').map((l) => l.trim()).filter(Boolean));
  try {
    const { stdout } = await git(path, ['grep', '--cached', '-l', '-E', '^(<{7}|>{7})( |$)']);
    for (const f of stdout.split('\n').map((l) => l.trim()).filter(Boolean)) files.add(f);
  } catch {
    // git grep exits 1 when nothing matches
  }
  return [...files].sort();
}

/** The files a commit touched. */
export async function commitFiles(path: string, sha: string): Promise<string[]> {
  const { stdout } = await git(path, ['show', '--name-only', '--pretty=format:', sha]);
  return stdout.split('\n').map((l) => l.trim()).filter((l) => l !== '').filter(notManaged);
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

/** Files the branch changes against main (`git diff --name-only <main>...HEAD`); [] when there is no main to compare. */
export async function changedOnBranch(path: string): Promise<string[]> {
  for (const base of ['refs/remotes/origin/main', 'main']) {
    try {
      const { stdout } = await git(path, ['diff', '--name-only', `${base}...HEAD`]);
      return stdout.split('\n').map((l) => l.trim()).filter(Boolean).filter(notManaged);
    } catch {
      // try the next base
    }
  }
  return [];
}

/** Files the branch changes against main plus the ones not committed yet (what a commit made now would carry). */
export async function changedWithPending(path: string): Promise<string[]> {
  const files = new Set(await changedOnBranch(path));
  try {
    const { stdout } = await git(path, ['status', '--porcelain', '-uall']);
    for (const line of stdout.split('\n')) {
      const rest = line.slice(3).trim();
      if (rest) files.add(rest.includes(' -> ') ? rest.split(' -> ')[1]!.replace(/^"|"$/g, '') : rest.replace(/^"|"$/g, ''));
    }
  } catch {
    // the committed files are what we have
  }
  return [...files].filter(notManaged);
}

/** Files the branch ADDS against main (`git diff --diff-filter=A`); [] when there is no main to compare. */
export async function addedOnBranch(path: string): Promise<string[]> {
  for (const base of ['refs/remotes/origin/main', 'main']) {
    try {
      const { stdout } = await git(path, ['diff', '--name-only', '--diff-filter=A', `${base}...HEAD`]);
      return stdout.split('\n').map((l) => l.trim()).filter(Boolean).filter(notManaged);
    } catch {
      // try the next base
    }
  }
  return [];
}

/** One file of the worktree, or null if it is not there. */
export async function readWorktreeFile(path: string, file: string): Promise<string | null> {
  return readFile(join(path, file), 'utf8').catch(() => null);
}
