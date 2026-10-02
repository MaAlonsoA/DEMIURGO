// The known-error vault (migration 0069): every defect DEMIURGO itself has suffered, recorded once, with how it was
// fixed, so each later task forensic can confirm it did not come back or say why it did. Practice: the Known Error
// Database of ITIL Problem Management and the regression test of each fixed defect; the classes come from Orthogonal
// Defect Classification (Chillarege et al. 1992). Reads of the append-only tables (the latest version of a code
// wins) and the pure rules; the writes go through the bus (commands/known-errors.ts).

import type { KnownErrorLiveStatus, KnownErrorStatus } from '@demiurgo/domain';
import { sql } from 'kysely';
import type { Db, Tx } from '../db/connection.ts';

/**
 * Later forensics that must show no occurrence before a claimed fix counts as validated. Convención nuestra: ITIL
 * Problem Management asks for the fix to be confirmed before a known error is closed but gives no number; three is
 * the smallest count that is not one lucky task.
 */
export const VALIDATION_CLEAN_FORENSICS = 3;

export type KnownErrorFix = { description: string; commits: string[]; piece_versions: Record<string, string>; claimed_at: string };

export type KnownErrorRow = {
  id: string;
  code: string;
  version: number;
  title: string;
  description: string;
  error_class: string;
  phase: string;
  dimension: string;
  signature: string;
  pieces: string[];
  status: KnownErrorStatus;
  fix: KnownErrorFix | null;
  /** The code this duplicate was merged into (status `merged`), else null. */
  merged_into: string | null;
  merge_note: string | null;
  origin_project_id: string;
  created_by: string;
  created_at: Date;
};

export type OccurrenceRow = {
  id: string;
  ke_code: string;
  project_id: string;
  task_id: string;
  forensic_id: string;
  went_wrong_index: number;
  occurred_at: Date;
  piece_versions: Record<string, string>;
  after_fix: boolean;
  recurrence_why: string | null;
  created_at: Date;
};

type Reader = Db | Tx;

function asKnownError(r: Record<string, unknown>): KnownErrorRow {
  return {
    id: r.id as string,
    code: r.code as string,
    version: r.version as number,
    title: r.title as string,
    description: r.description as string,
    error_class: r.error_class as string,
    phase: r.phase as string,
    dimension: r.dimension as string,
    signature: r.signature as string,
    pieces: (r.pieces as string[] | null) ?? [],
    status: r.status as KnownErrorStatus,
    fix: (r.fix as KnownErrorFix | null) ?? null,
    merged_into: (r.merged_into as string | null) ?? null,
    merge_note: (r.merge_note as string | null) ?? null,
    origin_project_id: r.origin_project_id as string,
    created_by: r.created_by as string,
    created_at: new Date(r.created_at as Date),
  };
}

function asOccurrence(r: Record<string, unknown>): OccurrenceRow {
  return {
    id: r.id as string,
    ke_code: r.ke_code as string,
    project_id: r.project_id as string,
    task_id: r.task_id as string,
    forensic_id: r.forensic_id as string,
    went_wrong_index: r.went_wrong_index as number,
    occurred_at: new Date(r.occurred_at as Date),
    piece_versions: (r.piece_versions as Record<string, string> | null) ?? {},
    after_fix: r.after_fix as boolean,
    recurrence_why: (r.recurrence_why as string | null) ?? null,
    created_at: new Date(r.created_at as Date),
  };
}

/** The latest version of every entry, merged ones included. */
export async function latestKnownErrorsAll(db: Reader): Promise<KnownErrorRow[]> {
  const rows = await db.selectFrom('known_errors').selectAll().orderBy('code').orderBy('version', 'desc').execute();
  const seen = new Set<string>();
  const out: KnownErrorRow[] = [];
  for (const r of rows) {
    if (seen.has(r.code)) continue;
    seen.add(r.code);
    out.push(asKnownError(r));
  }
  return out;
}

/** The latest version of every entry that stands on its own: the duplicates merged into another are left out. */
export async function latestKnownErrors(db: Reader): Promise<KnownErrorRow[]> {
  return (await latestKnownErrorsAll(db)).filter((k) => k.status !== 'merged');
}

/**
 * The code that stands for `code` once merges are followed (a target merged later hands on to its own target). Pure over
 * the latest rows; a cycle cannot happen (a merge refuses a merged target) but is cut anyway.
 */
export function mergeTarget(rows: readonly Pick<KnownErrorRow, 'code' | 'status' | 'merged_into'>[], code: string): string {
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const seen = new Set<string>();
  let at = code;
  for (;;) {
    const r = byCode.get(at);
    if (!r || r.status !== 'merged' || !r.merged_into || seen.has(at)) return at;
    seen.add(at);
    at = r.merged_into;
  }
}

/** The latest version of one entry, or null. */
export async function latestKnownError(db: Reader, code: string): Promise<KnownErrorRow | null> {
  const r = await db.selectFrom('known_errors').selectAll().where('code', '=', code).orderBy('version', 'desc').limit(1).executeTakeFirst();
  return r ? asKnownError(r) : null;
}

/** Every version of one entry, oldest first. */
export async function knownErrorVersions(db: Reader, code: string): Promise<KnownErrorRow[]> {
  return (await db.selectFrom('known_errors').selectAll().where('code', '=', code).orderBy('version').execute()).map(asKnownError);
}

/** Every occurrence, oldest first; of one code when given. */
export async function occurrencesOf(db: Reader, code?: string): Promise<OccurrenceRow[]> {
  let q = db.selectFrom('known_error_occurrences').selectAll();
  if (code) q = q.where('ke_code', '=', code);
  return (await q.orderBy('occurred_at').orderBy('id').execute()).map(asOccurrence);
}

/** The ids of the latest forensic of every task, across projects (a rerun of a task replaces the earlier analysis). */
export async function latestForensicIds(db: Reader): Promise<Set<string>> {
  const r = await sql<{ id: string }>`select distinct on (task_id) id from task_forensics order by task_id, created_at desc, id desc`.execute(db);
  return new Set(r.rows.map((x) => x.id));
}

/** A task that ran at or after the moment the fix was claimed ran with the fix in place. Pure. */
export function ranWithFix(fix: Pick<KnownErrorFix, 'claimed_at'> | null, occurredAt: Date | string): boolean {
  if (!fix) return false;
  const at = new Date(occurredAt).getTime();
  return Number.isFinite(at) && at >= new Date(fix.claimed_at).getTime();
}

/** The recurrence of a fixed error needs its why: the entry has a claimed or validated fix and the task ran with it. Pure. */
export function needsRecurrenceWhy(ke: { status: KnownErrorStatus; fix: Pick<KnownErrorFix, 'claimed_at'> | null }, occurredAt: Date | string): boolean {
  return (ke.status === 'fix_claimed' || ke.status === 'validated') && ranWithFix(ke.fix, occurredAt);
}

/** When a went_wrong item happened: its own time when valid, else the end of the task's activity, else when it was analysed. Pure. */
export function occurredAtOf(at: string | null | undefined, taskEndedAt: Date | string | null | undefined, analysedAt: Date | string): Date {
  for (const candidate of [at, taskEndedAt]) {
    if (candidate === null || candidate === undefined) continue;
    const d = new Date(candidate);
    if (Number.isFinite(d.getTime())) return d;
  }
  return new Date(analysedAt);
}

/** When a task's activity ended: its last build step or review, else the creation of its task version. */
export async function taskEndedAt(db: Reader, taskVersionId: string, requestIds: readonly string[]): Promise<Date | null> {
  if (requestIds.length > 0) {
    const r = await sql<{ at: Date | null }>`
      select greatest(
        (select max(created_at) from build_steps where build_request_id = any(${requestIds}::uuid[])),
        (select max(created_at) from pr_reviews where build_request_id = any(${requestIds}::uuid[]))) as at`.execute(db);
    const at = r.rows[0]?.at;
    if (at) return new Date(at);
  }
  const v = await db.selectFrom('record_versions').select('created_at').where('id', '=', taskVersionId).executeTakeFirst();
  return v ? new Date(v.created_at as unknown as Date) : null;
}

export type CompactKnownError = {
  code: string;
  title: string;
  error_class: string;
  signature: string;
  status: KnownErrorLiveStatus;
  pieces: string[];
  fix: { description: string; piece_versions: Record<string, string>; claimed_at: string } | null;
};

/** What an agent reads of the vault: the latest version of each entry, the open and recurred ones first. Bounded by `cap` characters. */
export function compactKnownErrors(rows: readonly KnownErrorRow[], cap: number): { entries: CompactKnownError[]; omitted: number } {
  const rank = { recurred: 0, open: 1, fix_claimed: 2, validated: 3 } as const;
  const sorted = rows
    .filter((k): k is KnownErrorRow & { status: KnownErrorLiveStatus } => k.status !== 'merged')
    .toSorted((a, b) => rank[a.status] - rank[b.status] || a.code.localeCompare(b.code));
  const entries: CompactKnownError[] = sorted.map((k) => ({
    code: k.code,
    title: k.title,
    error_class: k.error_class,
    signature: k.signature,
    status: k.status,
    pieces: k.pieces,
    fix: k.fix ? { description: k.fix.description, piece_versions: k.fix.piece_versions, claimed_at: k.fix.claimed_at } : null,
  }));
  let size = JSON.stringify(entries).length;
  let omitted = 0;
  while (size > cap && entries.length > 1) {
    entries.pop();
    omitted++;
    size = JSON.stringify(entries).length;
  }
  return { entries, omitted };
}

/**
 * The claimed fixes that have enough clean evidence to become validated: the latest forensic of at least
 * `VALIDATION_CLEAN_FORENSICS` different tasks, analysed after the fix was claimed, whose task ran after it, whose
 * checklist marks one of the error's pieces as involved and that record no occurrence of it. Pure over the rows read.
 */
export function validationsDue(
  errors: readonly KnownErrorRow[],
  forensics: readonly { id: string; task_id: string; created_at: Date; task_ended_at: Date | null; involved: ReadonlySet<string> }[],
  occurrences: readonly Pick<OccurrenceRow, 'ke_code' | 'forensic_id'>[],
): { code: string; forensic_ids: string[] }[] {
  const out: { code: string; forensic_ids: string[] }[] = [];
  for (const ke of errors) {
    if (ke.status !== 'fix_claimed' || !ke.fix || ke.pieces.length === 0) continue;
    const claimed = new Date(ke.fix.claimed_at).getTime();
    const had = new Set(occurrences.filter((o) => o.ke_code === ke.code).map((o) => o.forensic_id));
    const clean = forensics.filter(
      (f) => f.created_at.getTime() > claimed && f.task_ended_at !== null && f.task_ended_at.getTime() > claimed && !had.has(f.id) && ke.pieces.some((p) => f.involved.has(p)),
    );
    if (clean.length >= VALIDATION_CLEAN_FORENSICS) out.push({ code: ke.code, forensic_ids: clean.map((f) => f.id).toSorted() });
  }
  return out;
}

/** Reads what `validationsDue` needs: the latest forensic of every task with the pieces its checklist marks as involved. */
export async function dueValidations(db: Reader): Promise<{ code: string; forensic_ids: string[] }[]> {
  const errors = (await latestKnownErrors(db)).filter((k) => k.status === 'fix_claimed' && k.fix);
  if (errors.length === 0) return [];
  const latest = await latestForensicIds(db);
  if (latest.size === 0) return [];
  const rows = await db.selectFrom('task_forensics').select(['id', 'task_id', 'created_at', 'task_ended_at', 'analysis']).where('id', 'in', [...latest]).execute();
  const forensics = rows.map((r) => {
    const checklist = ((r.analysis as { checklist?: { piece_id: string; involved: string }[] }).checklist ?? []).filter((c) => c.involved === 'yes');
    return {
      id: r.id,
      task_id: r.task_id,
      created_at: new Date(r.created_at as unknown as Date),
      task_ended_at: r.task_ended_at ? new Date(r.task_ended_at as unknown as Date) : null,
      involved: new Set(checklist.map((c) => c.piece_id)),
    };
  });
  return validationsDue(errors, forensics, await occurrencesOf(db));
}
