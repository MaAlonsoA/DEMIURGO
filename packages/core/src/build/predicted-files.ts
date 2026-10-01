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

/** A file with Jev's probability at least this is a strong prediction (convención nuestra). Audit mision-comidas/auditoria-cola.md: Jev p ≥ 0.5 gave precision 0.48 against 0.17 for the code map's top 10. */
export const STRONG_FILE_P = 0.5;

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

/**
 * Predictions with evidence for a task never built: the files Jev rated with p ≥ STRONG_FILE_P (its `task_code_opinions`
 * for the latest attempt) and the files the task's own text names by path. Pure.
 */
export function strongFiles(opinions: readonly { path: string; jev_p: number | null }[], text: string, repoPaths: readonly string[]): string[] {
  const named = repoPaths.filter((p) => p.length > 3 && text.includes(p));
  return [...new Set([...opinions.filter((o) => (o.jev_p ?? 0) >= STRONG_FILE_P).map((o) => o.path), ...named])];
}

/** Jev's file opinions of the latest attempt of each task's latest build request. */
async function latestOpinions(db: Db, projectId: string, codes: string[]): Promise<Map<string, { path: string; jev_p: number | null }[]>> {
  const out = new Map<string, { path: string; jev_p: number | null }[]>();
  if (codes.length === 0) return out;
  const rows = await db
    .selectFrom('task_code_opinions as o')
    .innerJoin('build_requests as r', 'r.id', 'o.build_request_id')
    .innerJoin('records', 'records.id', 'r.task_id')
    .select(['records.code', 'o.build_request_id', 'o.attempt', 'o.path', 'o.jev_p'])
    .where('o.project_id', '=', projectId)
    .where('records.code', 'in', codes)
    .where('o.jev_p', 'is not', null)
    .orderBy('o.created_at', 'desc')
    .execute();
  const latest = new Map<string, string>();
  for (const r of rows) {
    const key = `${r.build_request_id}:${r.attempt}`;
    if (!latest.has(r.code)) latest.set(r.code, key);
    if (latest.get(r.code) !== key) continue;
    out.set(r.code, [...(out.get(r.code) ?? []), { path: r.path, jev_p: r.jev_p }]);
  }
  return out;
}

/**
 * The predicted files of each task among `codes`, and the code map they were ranked in (null without repository).
 * With `evidenceOnly` a task never built gets only `strongFiles` (empty = unknown, which means no collision) instead of
 * the code map's top files, whose precision is 0.17 (audit mision-comidas/auditoria-cola.md).
 */
export async function predictedFiles(db: Db, projectId: string, codes: string[], opts: { evidenceOnly?: boolean } = {}): Promise<Predictions> {
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
  if (opts.evidenceOnly && missing.length > 0) {
    const texts = await taskTexts(db, projectId, missing);
    const opinions = await latestOpinions(db, projectId, missing);
    const repoPaths = map?.files.map((f) => f.path) ?? [];
    for (const code of missing) files.set(code, strongFiles(opinions.get(code) ?? [], texts.get(code) ?? '', repoPaths));
  } else if (map && missing.length > 0) {
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
