// Does what entered main since the pull request's CI ran make it worth running CI again before merging?
//
// Practice: Google's TAP runs the tests affected by a change before submit (presubmit) and the full set after it
// (postsubmit), instead of everything every time (Winters, Manshreck and Wright, "Software Engineering at Google",
// ch. 23 "Continuous Integration"). DEMIURGO does the same: when what main got is disjoint from the task, it merges
// without the second run, and the `main` stage (CI on main after the merge, which stops the queue when red) is the
// postsubmit. The exact rule below (which files count as "can affect everything") is our convention.

import { runGit } from '../github/client.ts';
import { assemble, buildCodeMap, type CodeFile, type CodeMap } from './code-map.ts';

export type RecheckDecision = { recheck: boolean; reason: string };

const MIGRATION = /(^|\/)(migrations?|drizzle|prisma)\//i;
const SCHEMA = /(^|\/)(schema\.prisma|schema\.ts|schema\.sql|drizzle\.config\.[cm]?[jt]s)$|\.sql$/i;
const MANIFEST = /(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|pnpm-workspace\.yaml)$/;
const CI_WORKFLOW = /^\.github\/(workflows|actions)\//;
const CONFIG = /(^|\/)(next\.config\.[cm]?[jt]s|playwright\.config\.[cm]?[jt]s|vitest(\.[\w-]+)?\.config\.[cm]?[jt]s|vite\.config\.[cm]?[jt]s|tsconfig(\.[\w-]+)?\.json|\.env(\.[\w.-]+)?)$/;

/** The rule that makes a file "can affect everything" (schema, dependencies, CI, config), or null. */
export function sharedSurface(file: string): string | null {
  if (MIGRATION.test(file) || SCHEMA.test(file)) return 'schema';
  if (MANIFEST.test(file)) return 'dependencies';
  if (CI_WORKFLOW.test(file)) return 'ci_workflow';
  if (CONFIG.test(file)) return 'config';
  return null;
}

/** Files reachable by following imports from `from` (the files themselves excluded unless imported back). */
function importClosure(map: CodeMap, from: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const queue = [...from];
  for (let i = 0; i < queue.length; i++) {
    for (const dep of map.byPath.get(queue[i] as string)?.imports ?? []) {
      if (!seen.has(dep)) {
        seen.add(dep);
        queue.push(dep);
      }
    }
  }
  return seen;
}

/**
 * Whether the pull request must be brought up to date and go through CI again.
 * Recheck when: a file is in both sets; either side imports the other (transitively, by the code map); either side
 * touches the schema, the dependencies, the CI workflow or a config file; or there is no map (fail safe).
 */
export function needsRecheck(input: { taskFiles: readonly string[]; mainFiles: readonly string[]; map: CodeMap | null }): RecheckDecision {
  const { taskFiles, mainFiles, map } = input;
  const main = new Set(mainFiles);
  if (taskFiles.some((f) => main.has(f))) return { recheck: true, reason: 'same_file' };
  for (const f of [...taskFiles, ...mainFiles]) {
    const surface = sharedSurface(f);
    if (surface) return { recheck: true, reason: surface };
  }
  if (!map) return { recheck: true, reason: 'no_code_map' };
  const task = new Set(taskFiles);
  // The task imports (transitively) something main changed.
  if ([...importClosure(map, taskFiles)].some((f) => main.has(f))) return { recheck: true, reason: 'task_imports_main_change' };
  // What main changed imports (transitively) something the task changed.
  if ([...importClosure(map, mainFiles)].some((f) => task.has(f))) return { recheck: true, reason: 'main_change_imports_task' };
  return { recheck: false, reason: 'disjoint' };
}

/** One map with the files of both sides (the branch's version wins) so imports of either side are followed. */
export function combineMaps(branch: CodeMap, main: CodeMap): CodeMap {
  const files = new Map<string, CodeFile>();
  for (const f of main.files) files.set(f.path, f);
  for (const f of branch.files) {
    const other = files.get(f.path);
    files.set(f.path, other ? { ...f, imports: [...new Set([...f.imports, ...other.imports])] } : f);
  }
  return assemble(`${branch.commit}+${main.commit}`, [...files.values()]);
}

const lines = (s: string) => s.split('\n').map((l) => l.trim()).filter(Boolean);

/**
 * Decides for a pull request head against the current main of a local clone: fetches main, lists both sides' files
 * from the merge base, and checks that the branch merges with main without a conflict (`git merge-tree`). Any failure
 * means recheck (the current behavior: update the branch and run CI again). Conflicts are left to `updateBranch`.
 */
export async function decideRecheck(repoDir: string, headSha: string): Promise<RecheckDecision & { mainFiles: number; mergeable: boolean }> {
  try {
    await runGit(repoDir, ['fetch', 'origin', 'main'], { network: true });
    const mainRef = 'refs/remotes/origin/main';
    const base = (await runGit(repoDir, ['merge-base', headSha, mainRef])).trim();
    const taskFiles = lines(await runGit(repoDir, ['diff', '--name-only', `${base}..${headSha}`]));
    const mainFiles = lines(await runGit(repoDir, ['diff', '--name-only', `${base}..${mainRef}`]));
    let mergeable = true;
    try {
      await runGit(repoDir, ['merge-tree', '--write-tree', headSha, mainRef]);
    } catch {
      mergeable = false;
    }
    if (!mergeable) return { recheck: true, reason: 'conflict', mainFiles: mainFiles.length, mergeable };
    const map = combineMaps(await buildCodeMap(repoDir, headSha), await buildCodeMap(repoDir, mainRef));
    return { ...needsRecheck({ taskFiles, mainFiles, map }), mainFiles: mainFiles.length, mergeable };
  } catch {
    return { recheck: true, reason: 'no_code_map', mainFiles: 0, mergeable: false };
  }
}
