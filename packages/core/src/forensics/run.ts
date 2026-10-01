// Running the forensics: one task at a time, one playbook per class, each waiting for its run to finish (the engine
// is a person's subscription: serial on purpose). Used by the `forensics` CLI and by the tests.

import { DomainError, isDomainError, system } from '@demiurgo/domain';
import { executeCommand } from '../bus/bus.ts';
import { waitForRun } from '../engine/engine.ts';
import type { Services } from '../services.ts';
import { catalogVersion, loadPieceCatalog } from './catalog.ts';
import { buildTaskEvidence } from './evidence.ts';
import { classesOf, latestForensics, latestPlaybooks } from './store.ts';

export type Progress = (line: string) => void;

export type TaskResult = {
  code: string;
  status: 'analyzed' | 'skipped' | 'failed' | 'refused';
  run_id?: string;
  forensic_id?: string;
  reason?: string;
};

const WAIT_FOR_KNOWLEDGE_MS = 10 * 60_000;

/** `run.request` as the system; while the project's knowledge updates it waits (the guard is a 409 for a non-person). */
async function requestRun(services: Services, projectId: string, data: Record<string, unknown>, waitMs = WAIT_FOR_KNOWLEDGE_MS): Promise<string> {
  const started = Date.now();
  for (;;) {
    try {
      const r = await executeCommand(services, { command: 'run.request', actor: system('cli'), projectId, data });
      return r.entityId;
    } catch (e) {
      const waiting = isDomainError(e) && e.type === 'guard' && /knowledge is not up to date/i.test([e.message, ...e.reasons].join(' '));
      if (!waiting || Date.now() - started > waitMs) throw e;
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}

const refusal = (e: unknown): string | null => (isDomainError(e) && e.type === 'guard' ? [e.message, ...e.reasons].join(' ') : null);

/** The tasks of the project (records of type task), by code; one when `code` is given. */
export async function forensicTasks(services: Services, projectId: string, code?: string): Promise<{ id: string; code: string }[]> {
  let q = services.db.selectFrom('records').select(['id', 'code']).where('project_id', '=', projectId).where('type', '=', 'task');
  if (code) q = q.where('code', '=', code);
  const rows = await q.orderBy('code').execute();
  if (code && rows.length === 0) throw new DomainError('not_found', `The task ${code} does not exist.`);
  return rows;
}

/** The forensic of one task: skipped when its latest has the same evidence and checklist (unless `force`), else a run that is waited for. */
export async function runTaskForensic(services: Services, projectId: string, task: { id: string; code: string }, opts: { force?: boolean } = {}): Promise<TaskResult> {
  const { db } = services;
  const bundle = await buildTaskEvidence(db, projectId, task.id);
  if (!opts.force) {
    const [latest] = await latestForensics(db, projectId, task.id);
    const version = catalogVersion(await loadPieceCatalog());
    if (latest && latest.evidence_hash === bundle.hash && latest.catalog_version === version) return { code: task.code, status: 'skipped', forensic_id: latest.id, reason: 'same evidence and checklist as the latest forensic' };
  }
  let runId: string;
  try {
    runId = await requestRun(services, projectId, { action: 'task_forensics', scope: { type: 'task', id: task.id }, input: {} });
  } catch (e) {
    const why = refusal(e);
    if (why) return { code: task.code, status: 'refused', reason: why };
    throw e;
  }
  await waitForRun(runId);
  const run = await db.selectFrom('ai_runs').select(['state', 'error', 'failure_kind']).where('id', '=', runId).executeTakeFirstOrThrow();
  const row = await db.selectFrom('task_forensics').select('id').where('ai_run_id', '=', runId).executeTakeFirst();
  if (run.state !== 'completed' || !row) return { code: task.code, status: 'failed', run_id: runId, reason: `${run.state}${run.failure_kind ? ` (${run.failure_kind})` : ''}${run.error ? `: ${run.error.slice(0, 300)}` : ''}` };
  return { code: task.code, status: 'analyzed', run_id: runId, forensic_id: row.id };
}

/** Runs the forensic of each task in turn, reporting each one; stops when the agent has no engine (every other task would be refused too). */
export async function runForensics(services: Services, projectId: string, opts: { code?: string; force?: boolean; progress?: Progress } = {}): Promise<TaskResult[]> {
  const progress = opts.progress ?? (() => undefined);
  const tasks = await forensicTasks(services, projectId, opts.code);
  const results: TaskResult[] = [];
  for (const [i, task] of tasks.entries()) {
    progress(`[${i + 1}/${tasks.length}] ${task.code} …`);
    const r = await runTaskForensic(services, projectId, task, opts.force !== undefined ? { force: opts.force } : {});
    results.push(r);
    progress(`[${i + 1}/${tasks.length}] ${task.code}: ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
    if (r.status === 'refused') break;
  }
  return results;
}

export type PlaybookResult = { class_key: string; status: 'written' | 'skipped' | 'failed' | 'refused'; run_id?: string; playbook_id?: string; reason?: string };

/** One playbook_write per class seen in the latest forensics; a class whose playbook already rests on the same forensics is skipped unless `force`. */
export async function runPlaybooks(services: Services, projectId: string, opts: { force?: boolean; progress?: Progress } = {}): Promise<PlaybookResult[]> {
  const progress = opts.progress ?? (() => undefined);
  const { db } = services;
  const forensics = await latestForensics(db, projectId);
  const classes = [...new Set(forensics.flatMap((f) => classesOf(f.analysis)))].toSorted();
  const playbooks = await latestPlaybooks(db, projectId);
  const results: PlaybookResult[] = [];
  for (const [i, key] of classes.entries()) {
    const ids = forensics.filter((f) => classesOf(f.analysis).includes(key)).map((f) => f.id).toSorted();
    const current = playbooks.find((p) => p.class_key === key);
    if (!opts.force && current && JSON.stringify([...current.based_on].toSorted()) === JSON.stringify(ids)) {
      results.push({ class_key: key, status: 'skipped', playbook_id: current.id, reason: 'already rests on the same forensics' });
      progress(`[${i + 1}/${classes.length}] ${key}: skipped`);
      continue;
    }
    progress(`[${i + 1}/${classes.length}] ${key} …`);
    let runId: string;
    try {
      runId = await requestRun(services, projectId, { action: 'playbook_write', scope: { type: 'project', id: projectId }, input: { class_key: key } });
    } catch (e) {
      const why = refusal(e);
      if (!why) throw e;
      results.push({ class_key: key, status: 'refused', reason: why });
      progress(`[${i + 1}/${classes.length}] ${key}: refused (${why})`);
      break;
    }
    await waitForRun(runId);
    const run = await db.selectFrom('ai_runs').select(['state', 'error']).where('id', '=', runId).executeTakeFirstOrThrow();
    const row = await db.selectFrom('forensic_playbooks').select('id').where('ai_run_id', '=', runId).executeTakeFirst();
    const r: PlaybookResult =
      run.state === 'completed' && row ? { class_key: key, status: 'written', run_id: runId, playbook_id: row.id } : { class_key: key, status: 'failed', run_id: runId, reason: `${run.state}${run.error ? `: ${run.error.slice(0, 300)}` : ''}` };
    results.push(r);
    progress(`[${i + 1}/${classes.length}] ${key}: ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
  }
  return results;
}
