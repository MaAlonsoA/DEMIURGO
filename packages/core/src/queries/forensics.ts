// Reads of the task forensics for the API: all the forensics of one task (newest first) and the overview across tasks.

import { DomainError } from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';
import { forensicsOfTask, latestForensics, latestPlaybooks, overviewOf, type ForensicsOverview } from '../forensics/store.ts';

export type TaskForensicsView = {
  task: { id: string; code: string };
  forensics: {
    id: string;
    task_version_id: string;
    request_ids: string[];
    ai_run_id: string;
    evidence_hash: string;
    catalog_version: string;
    agent_version: string;
    engine: unknown;
    created_at: string;
    analysis: unknown;
  }[];
};

/** Every forensic of a task, newest first (`GET /api/projects/:projectId/tasks/:code/forensics`). */
export async function taskForensicsOf(db: Db, projectId: string, code: string): Promise<TaskForensicsView> {
  const task = await db.selectFrom('records').select(['id', 'code']).where('project_id', '=', projectId).where('code', '=', code).where('type', '=', 'task').executeTakeFirst();
  if (!task) throw new DomainError('not_found', 'The task does not exist.');
  const rows = await forensicsOfTask(db, projectId, task.id);
  return {
    task,
    forensics: rows.map((r) => ({
      id: r.id,
      task_version_id: r.task_version_id,
      request_ids: r.request_ids,
      ai_run_id: r.ai_run_id,
      evidence_hash: r.evidence_hash,
      catalog_version: r.catalog_version,
      agent_version: r.agent_version,
      engine: r.engine,
      created_at: r.created_at.toISOString(),
      analysis: r.analysis,
    })),
  };
}

/** What the latest forensics say all together (`GET /api/projects/:projectId/observability/forensics.json`). */
export async function forensicsOverview(db: Db, projectId: string): Promise<ForensicsOverview> {
  return overviewOf(await latestForensics(db, projectId), await latestPlaybooks(db, projectId));
}
