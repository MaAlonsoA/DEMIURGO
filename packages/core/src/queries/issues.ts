// Issue queries: the list of a project and one issue by code, with what it points to.

import { DomainError } from '@demiurgo/domain';
import { sql } from 'kysely';
import type { Db } from '../db/connection.ts';

export type IssueComment = { path: string; line: number | null; severity: string; body: string; needs_person: boolean };

export type IssueView = {
  id: string;
  code: string;
  kind: 'bug' | 'review_escalation';
  title: string;
  body: string;
  state: 'open' | 'resolved' | 'closed';
  task: { code: string; title: string } | null;
  feature: { code: string; title: string } | null;
  criterion_code: string | null;
  build_request_id: string | null;
  attempt: number | null;
  pr_number: number | null;
  pr_url: string | null;
  review: { summary: string; comments: IssueComment[] } | null;
  resolution: { task_code: string; task_title: string; version_n: number | null } | null;
  close_reason: string | null;
  opened_by: string;
  opened_at: string;
  resolved_by: string | null;
  resolved_at: string | null;
  closed_by: string | null;
  closed_at: string | null;
};

const iso = (d: unknown): string | null => (d ? new Date(d as Date).toISOString() : null);

/** The title of a record: its latest version's. */
async function titleOf(db: Db, recordId: string): Promise<string> {
  const v = await db
    .selectFrom('record_versions')
    .select('title')
    .where('record_id', '=', recordId)
    .orderBy('n', 'desc')
    .executeTakeFirst();
  return v?.title ?? '';
}

async function codeAndTitle(db: Db, recordId: string | null) {
  if (!recordId) return null;
  const r = await db.selectFrom('records').select('code').where('id', '=', recordId).executeTakeFirst();
  return r ? { code: r.code, title: await titleOf(db, recordId) } : null;
}

async function view(db: Db, row: Awaited<ReturnType<typeof rows>>[number]): Promise<IssueView> {
  const request = row.build_request_id
    ? await db
        .selectFrom('build_requests')
        .select(['pr_number', 'pr_url'])
        .where('id', '=', row.build_request_id)
        .executeTakeFirst()
    : undefined;
  const review = row.pr_review_id
    ? await db.selectFrom('pr_reviews').select(['summary', 'comments']).where('id', '=', row.pr_review_id).executeTakeFirst()
    : undefined;
  const fix = await codeAndTitle(db, row.resolution_task_id);
  const version = row.resolution_version_id
    ? await db.selectFrom('record_versions').select('n').where('id', '=', row.resolution_version_id).executeTakeFirst()
    : undefined;
  return {
    id: row.id,
    code: row.code,
    kind: row.kind,
    title: row.title,
    body: row.body,
    state: row.state,
    task: await codeAndTitle(db, row.task_id),
    feature: await codeAndTitle(db, row.feature_id),
    criterion_code: row.criterion_code,
    build_request_id: row.build_request_id,
    attempt: row.attempt,
    pr_number: request?.pr_number ?? null,
    pr_url: request?.pr_url ?? null,
    review: review
      ? {
          summary: review.summary,
          comments: ((review.comments ?? []) as Partial<IssueComment>[]).map((c) => ({
            path: c.path ?? '',
            line: c.line ?? null,
            severity: c.severity ?? '',
            body: c.body ?? '',
            needs_person: c.needs_person === true,
          })),
        }
      : null,
    resolution: fix ? { task_code: fix.code, task_title: fix.title, version_n: version?.n ?? null } : null,
    close_reason: row.close_reason,
    opened_by: row.opened_by,
    opened_at: iso(row.opened_at) as string,
    resolved_by: row.resolved_by,
    resolved_at: iso(row.resolved_at),
    closed_by: row.closed_by,
    closed_at: iso(row.closed_at),
  };
}

const rows = (db: Db, projectId: string, code?: string) => {
  let q = db.selectFrom('issues').selectAll().where('project_id', '=', projectId);
  if (code) q = q.where('code', '=', code);
  return q.orderBy('opened_at', 'desc').orderBy(sql`code`, 'desc').execute();
};

/** The issues of a project, newest first. */
export async function issuesList(db: Db, projectId: string): Promise<{ issues: IssueView[] }> {
  const found = await rows(db, projectId);
  return { issues: await Promise.all(found.map((r) => view(db, r))) };
}

/** One issue by its code (ISS-NNN). */
export async function issueDetail(db: Db, projectId: string, code: string): Promise<IssueView> {
  const [row] = await rows(db, projectId, code);
  if (!row) throw new DomainError('not_found', `Issue ${code} does not exist.`);
  return view(db, row);
}

/** Open issues for «Needs you». */
export async function openIssuesOf(db: Db, projectId: string) {
  const open = await db
    .selectFrom('issues')
    .leftJoin('records', 'records.id', 'issues.task_id')
    .select(['issues.code', 'issues.kind', 'issues.title', 'records.code as task_code', 'issues.opened_at'])
    .where('issues.project_id', '=', projectId)
    .where('issues.state', '=', 'open')
    .orderBy('issues.opened_at')
    .execute();
  return open.map((i) => ({
    code: i.code,
    kind: i.kind,
    title: i.title,
    task_code: i.task_code,
    opened_at: iso(i.opened_at) as string,
  }));
}
