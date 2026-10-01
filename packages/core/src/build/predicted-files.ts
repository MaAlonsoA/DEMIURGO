// The files a task is predicted to change, for the queue (it must not build two tasks that touch the same
// hotspot or module together). Layered, as schema-risk.ts: the footprint of an earlier merged version of
// the task (what Nx "affected" derives from git), otherwise the top files of the code map for the task text
// (Aider's repo map ranking, aider.chat/docs/repomap.html). The number of files is our convention.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Db } from '../db/connection.ts';
import { buildCodeMap, rankCodeMap, type CodeMap } from './code-map.ts';
import { isReusableFile, taskFootprints } from './footprint.ts';
import { repositoryOf } from './queue.ts';

const run = promisify(execFile);

/** Files taken from the code map ranking for a task that was never built (our convention). */
export const PREDICTED_FILES = 10;

export type Predictions = { files: Map<string, string[]>; map: CodeMap | null };

/** Predictions by project, task and main commit: the code map is cached by sha, the ranking is cached here. */
const cache = new Map<string, string[]>();
const CACHE_LIMIT = 500;

async function mainMap(repoPath: string): Promise<CodeMap | null> {
  try {
    let ref = 'main';
    try {
      await run('git', ['-c', 'safe.directory=*', '-C', repoPath, 'rev-parse', '--verify', '--quiet', 'refs/remotes/origin/main']);
      ref = 'refs/remotes/origin/main';
    } catch {
      // no remote copy: the local main
    }
    return await buildCodeMap(repoPath, ref);
  } catch {
    return null;
  }
}

/** The text of the task the ranking reads: its approved title and the content of its sections. */
async function taskTexts(db: Db, projectId: string, codes: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (codes.length === 0) return out;
  const rows = await db
    .selectFrom('records')
    .innerJoin('record_versions as v', 'v.record_id', 'records.id')
    .select(['records.code', 'v.title', 'v.sections', 'v.n'])
    .where('records.project_id', '=', projectId)
    .where('records.code', 'in', codes)
    .where('v.state', '=', 'approved')
    .orderBy('v.n')
    .execute();
  for (const r of rows) {
    const sections = (r.sections as { title?: string; content?: string }[] | null) ?? [];
    out.set(r.code, [r.title, ...sections.map((s) => s.content ?? '')].join('\n'));
  }
  return out;
}

/** The predicted files of each task among `codes`, and the code map they were ranked in (null without repository). */
export async function predictedFiles(db: Db, projectId: string, codes: string[]): Promise<Predictions> {
  const files = new Map<string, string[]>();
  if (codes.length === 0) return { files, map: null };
  const footprints = new Map((await taskFootprints(db, projectId)).map((f) => [f.code, f]));
  const missing: string[] = [];
  for (const code of codes) {
    const fp = footprints.get(code);
    if (fp) files.set(code, fp.files.filter((f) => f.status !== 'removed' && isReusableFile(f.path)).map((f) => f.path));
    else missing.push(code);
  }
  const repo = await repositoryOf(db, projectId);
  const map = repo.path ? await mainMap(repo.path) : null;
  if (map && missing.length > 0) {
    const texts = await taskTexts(db, projectId, missing);
    for (const code of missing) {
      const key = `${projectId}\u0000${code}\u0000${map.commit}`;
      let predicted = cache.get(key);
      if (!predicted) {
        predicted = rankCodeMap(map, texts.get(code) ?? code, { limit: PREDICTED_FILES }).map((r) => r.file.path);
        cache.set(key, predicted);
        while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
      }
      files.set(code, predicted);
    }
  }
  return { files, map };
}
