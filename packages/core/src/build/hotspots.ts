// The project's hotspots: files that many merged tasks changed. They are where two tasks built at once most
// often collide. Practice: Google's large-scale changes ("As the number of files in a change increases, the
// probability of encountering a merge conflict also grows", Software Engineering at Google, ch. 22,
// abseil.io/resources/swe-book/html/ch22.html) and hotspot analysis by change frequency (Adam Tornhill,
// "Your Code as a Crime Scene"; CodeScene). The footprint of each merged task is what Nx "affected" calls the
// files a change touches. The thresholds below are our convention.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Db } from '../db/connection.ts';
import { isReusableFile, taskFootprints, type TaskFootprint } from './footprint.ts';
import { repositoryOf } from './queue.ts';

export type Hotspot = { path: string; tasks: number; of: number };

/** A file is a hotspot when at least this share of the merged tasks changed it (our convention). */
export const HOTSPOT_SHARE = 0.3;
/** ...and at least this many tasks did (our convention: two tasks touching a file is no pattern yet). */
export const HOTSPOT_MIN_TASKS = 3;

/** Files whose changes say nothing about code collisions: docs, config of the environment, tests and noise (our convention). */
const NOT_SOURCE = [/\.mdx?$/i, /(^|\/)docs?\//, /(^|\/)\.env[^/]*$/, /(^|\/)README[^/]*$/i, /\.(test|spec)\.[a-z]+$/, /(^|\/)(__tests__|tests?|e2e)\//];

/** Source and style files count; docs, environment files, lockfiles, generated files and tests do not. */
export const isHotspotCandidate = (path: string): boolean => isReusableFile(path) && !NOT_SOURCE.some((re) => re.test(path));

/** Pure: how many tasks changed each candidate file, most changed first (ties by path). */
export function hotspotCounts(footprints: readonly Pick<TaskFootprint, 'files'>[]): Hotspot[] {
  const counts = new Map<string, number>();
  for (const fp of footprints) {
    for (const path of new Set(fp.files.map((f) => f.path).filter(isHotspotCandidate))) counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return [...counts.entries()].map(([path, tasks]) => ({ path, tasks, of: footprints.length })).sort((a, b) => b.tasks - a.tasks || (a.path < b.path ? -1 : 1));
}

export const isHotspot = (entry: { path?: string; tasks: number; of: number }, of = entry.of): boolean => entry.tasks >= HOTSPOT_MIN_TASKS && of > 0 && entry.tasks / of >= HOTSPOT_SHARE;

/** The files changed by merged tasks, with how many of the merged tasks changed each (all files, not only hotspots). */
export async function hotspotsOf(db: Db, projectId: string): Promise<{ path: string; tasks: number; of: number }[]> {
  return hotspotCounts(await taskFootprints(db, projectId));
}

const run = promisify(execFile);

/**
 * A barrel: a file whose only statements are `export … from '…'` or `export * from '…'` (comments aside). Two tasks
 * that each add an export line to it merge mechanically, so it is no hotspot (convención nuestra; audit
 * mision-comidas/auditoria-cola.md: `src/design-system/index.ts` caused 55 wasted build-minutes). Pure.
 */
export function isBarrelSource(content: string): boolean {
  const code = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1').trim();
  if (code === '') return false;
  const statement = String.raw`export\s+(?:type\s+)?(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s+from\s+(?:'[^']*'|"[^"]*")\s*;?`;
  return new RegExp(String.raw`^(?:\s*${statement})+\s*$`).test(code);
}

/** Fallback when the content cannot be read (convención nuestra): an `index.ts(x)` under `src/` is assumed to be a barrel. */
export const looksLikeBarrelPath = (path: string): boolean => /(^|\/)src\/(.*\/)?index\.tsx?$/.test(path);

/** Which of `paths` are barrels, read from the main branch of the project's repository (the path heuristic when it cannot be read). */
export async function barrelsAmong(db: Db, projectId: string, paths: readonly string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const candidates = [...new Set(paths)].filter((p) => /\.(ts|tsx|js|jsx|mjs|mts)$/.test(p));
  if (candidates.length === 0) return out;
  let repoPath: string | null = null;
  try {
    repoPath = (await repositoryOf(db, projectId)).path ?? null;
  } catch {
    // no repository: the path heuristic
  }
  let ref = 'main';
  if (repoPath) {
    try {
      await run('git', ['-c', 'safe.directory=*', '-C', repoPath, 'rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main']);
      ref = 'refs/remotes/origin/main';
    } catch {
      // no remote copy: the local main
    }
  }
  for (const path of candidates) {
    if (!repoPath) {
      if (looksLikeBarrelPath(path)) out.add(path);
      continue;
    }
    try {
      const { stdout } = await run('git', ['-c', 'safe.directory=*', '-C', repoPath, 'show', `${ref}:${path}`], { maxBuffer: 2_000_000 });
      if (isBarrelSource(stdout)) out.add(path);
    } catch {
      if (looksLikeBarrelPath(path)) out.add(path);
    }
  }
  return out;
}
