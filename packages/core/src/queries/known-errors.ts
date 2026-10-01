// Reads of the known-error vault for the API and the CLI: every entry (latest version) with how often it was seen and
// whether it came back after its fix, and one entry with all its versions and occurrences. Occurrences of a forensic
// that a later forensic of the same task replaced are listed in the detail (marked) but not counted.

import { DomainError, type KnownErrorStatus } from '@demiurgo/domain';
import type { Db } from '../db/connection.ts';
import { type KnownErrorFix, type KnownErrorRow, knownErrorVersions, latestForensicIds, latestKnownError, latestKnownErrors, occurrencesOf } from '../forensics/vault.ts';

export type KnownErrorSummary = {
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
  origin_project_id: string;
  created_at: string;
  /** Occurrences in the latest forensic of each task (an analysis a later one replaced no longer counts). */
  occurrences: number;
  last_seen: string | null;
  /** Tasks that ran with the fix in place and hit the error, in any forensic: the fix failing is not forgotten when the task is analysed again. */
  after_fix_recurrences: number;
  /** Codes of the tasks it appears in, in their latest forensic. */
  tasks: string[];
};

export type KnownErrorsOverview = { total: number; by_status: Record<KnownErrorStatus, number>; entries: KnownErrorSummary[] };

const iso = (d: Date) => d.toISOString();

function entryOf(k: KnownErrorRow) {
  return {
    code: k.code,
    version: k.version,
    title: k.title,
    description: k.description,
    error_class: k.error_class,
    phase: k.phase,
    dimension: k.dimension,
    signature: k.signature,
    pieces: k.pieces,
    status: k.status,
    fix: k.fix,
    origin_project_id: k.origin_project_id,
    created_by: k.created_by,
    created_at: iso(k.created_at),
  };
}

async function taskCodes(db: Db, ids: string[]): Promise<Map<string, { code: string; project_id: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await db.selectFrom('records').select(['id', 'code', 'project_id']).where('id', 'in', ids).execute();
  return new Map(rows.map((r) => [r.id, { code: r.code, project_id: r.project_id }]));
}

/** Every entry, latest version, most recently seen first within each status (`GET /api/observability/known-errors.json`). */
export async function knownErrorsOverview(db: Db, filter: { status?: string } = {}): Promise<KnownErrorsOverview> {
  const all = await latestKnownErrors(db);
  const current = await latestForensicIds(db);
  const history = await occurrencesOf(db);
  const occurrences = history.filter((o) => current.has(o.forensic_id));
  const codes = await taskCodes(db, [...new Set(occurrences.map((o) => o.task_id))]);
  const by_status: Record<KnownErrorStatus, number> = { open: 0, fix_claimed: 0, validated: 0, recurred: 0 };
  for (const k of all) by_status[k.status]++;
  const entries = all
    .filter((k) => !filter.status || k.status === filter.status)
    .map((k): KnownErrorSummary => {
      const mine = occurrences.filter((o) => o.ke_code === k.code);
      const last = mine.map((o) => o.occurred_at.getTime()).toSorted((a, b) => b - a)[0];
      return {
        ...entryOf(k),
        occurrences: mine.length,
        last_seen: last === undefined ? null : new Date(last).toISOString(),
        after_fix_recurrences: new Set(history.filter((o) => o.ke_code === k.code && o.after_fix).map((o) => o.task_id)).size,
        tasks: [...new Set(mine.map((o) => codes.get(o.task_id)?.code ?? o.task_id))].toSorted(),
      };
    })
    .toSorted((a, b) => (b.last_seen ?? '').localeCompare(a.last_seen ?? '') || a.code.localeCompare(b.code));
  return { total: all.length, by_status, entries };
}

export type KnownErrorDetail = {
  entry: ReturnType<typeof entryOf>;
  versions: ReturnType<typeof entryOf>[];
  occurrences: {
    id: string;
    project: { id: string; name: string };
    task: { id: string; code: string };
    forensic_id: string;
    went_wrong_index: number;
    occurred_at: string;
    piece_versions: Record<string, string>;
    after_fix: boolean;
    recurrence_why: string | null;
    created_at: string;
    /** False when a later forensic of the same task replaced the one this comes from. */
    current: boolean;
  }[];
};

/** One entry with every version and every occurrence, oldest first (`GET /api/observability/known-errors/:code`). */
export async function knownErrorDetail(db: Db, code: string): Promise<KnownErrorDetail> {
  const latest = await latestKnownError(db, code);
  if (!latest) throw new DomainError('not_found', `The known error ${code} does not exist.`);
  const versions = await knownErrorVersions(db, code);
  const occurrences = await occurrencesOf(db, code);
  const current = await latestForensicIds(db);
  const tasks = await taskCodes(db, [...new Set(occurrences.map((o) => o.task_id))]);
  const projectIds = [...new Set(occurrences.map((o) => o.project_id))];
  const projects = projectIds.length > 0 ? await db.selectFrom('projects').select(['id', 'name']).where('id', 'in', projectIds).execute() : [];
  const name = new Map(projects.map((p) => [p.id, p.name]));
  return {
    entry: entryOf(latest),
    versions: versions.map(entryOf),
    occurrences: occurrences.map((o) => ({
      id: o.id,
      project: { id: o.project_id, name: name.get(o.project_id) ?? o.project_id },
      task: { id: o.task_id, code: tasks.get(o.task_id)?.code ?? o.task_id },
      forensic_id: o.forensic_id,
      went_wrong_index: o.went_wrong_index,
      occurred_at: iso(o.occurred_at),
      piece_versions: o.piece_versions,
      after_fix: o.after_fix,
      recurrence_why: o.recurrence_why,
      created_at: iso(o.created_at),
      current: current.has(o.forensic_id),
    })),
  };
}
