// «Containment» of design (harness/containment.ts): PCE per design phase against its target, the series recomputed from
// the stored escapes, and the contained and escaped rows side by side to be audited. One escapes rules version at a time.

import { sql } from 'kysely';
import type { Db } from '../db/connection.ts';
import {
  containmentOf,
  containmentSeries,
  DESIGN_PHASES,
  isContained,
  PCE_MIN_N,
  PCE_TARGET,
  type ContainmentPoint,
  type PhaseContainment,
} from '../harness/containment.ts';

/** Audit rows returned per call (convención nuestra); the counts always cover all of them. */
export const CONTAINMENT_ROWS_MAX = 2000;

export type ContainmentAuditRow = {
  id: string;
  kind: 'contained' | 'escaped';
  rule: string;
  introduced_phase: string;
  found_phase: string;
  record_code: string | null;
  criterion_code: string | null;
  build_request_id: string | null;
  subject: string | null;
  occurred_at: string | null;
};

export type HarnessContainment = {
  /** The rules version shown (the latest stored unless asked) and all the stored ones. */
  rules_version: string | null;
  rules_versions: string[];
  target: number;
  min_n: number;
  phases: readonly string[];
  /** All the stored escapes of the version, per design phase. */
  current: PhaseContainment[];
  /** One point per stored check window, oldest first, recomputed now. */
  series: ContainmentPoint[];
  total: number;
  rows: ContainmentAuditRow[];
};

const iso = (d: unknown): string => new Date(d as Date | string).toISOString();

export async function harnessContainment(db: Db, projectId: string, opts: { rules?: string } = {}): Promise<HarnessContainment> {
  const versions = (await db.selectFrom('harness_escapes').select('rules_version').distinct().where('project_id', '=', projectId).execute())
    .map((r) => r.rules_version)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const rules = opts.rules && versions.includes(opts.rules) ? opts.rules : (versions[0] ?? null);
  const base = { rules_versions: versions, target: PCE_TARGET, min_n: PCE_MIN_N, phases: DESIGN_PHASES };
  if (rules === null) return { rules_version: null, ...base, current: [], series: [], total: 0, rows: [] };
  const stored = await db
    .selectFrom('harness_escapes')
    .select(['id', 'rule', 'introduced_phase', 'found_phase', 'record_code', 'criterion_code', 'build_request_id', 'subject', 'evidence', 'occurred_at'])
    .where('project_id', '=', projectId)
    .where('rules_version', '=', rules)
    .orderBy(sql`occurred_at desc nulls last`)
    .orderBy('id', 'desc')
    .execute();
  const checks = await db
    .selectFrom('harness_checks')
    .select(['id', 'computed_at', 'window_from', 'window_to'])
    .where('project_id', '=', projectId)
    .orderBy('computed_at', 'desc')
    .orderBy('id', 'desc')
    .limit(30)
    .execute();
  const rows = stored.map((r) => ({ ...r, occurred_at: r.occurred_at === null ? null : iso(r.occurred_at) }));
  const audited: ContainmentAuditRow[] = rows
    .filter((r) => (DESIGN_PHASES as readonly string[]).includes(r.introduced_phase) && (isContained(r) || r.introduced_phase !== r.found_phase))
    .map((r) => ({
      id: r.id,
      kind: isContained(r) ? 'contained' : 'escaped',
      rule: r.rule,
      introduced_phase: r.introduced_phase,
      found_phase: r.found_phase,
      record_code: r.record_code,
      criterion_code: r.criterion_code,
      build_request_id: r.build_request_id,
      subject: r.subject,
      occurred_at: r.occurred_at,
    }));
  return {
    rules_version: rules,
    ...base,
    current: containmentOf(rows),
    series: containmentSeries(
      rows,
      checks.map((c) => ({ id: c.id, computed_at: iso(c.computed_at), window_from: iso(c.window_from), window_to: iso(c.window_to) })),
    ),
    total: audited.length,
    rows: audited.slice(0, CONTAINMENT_ROWS_MAX),
  };
}
