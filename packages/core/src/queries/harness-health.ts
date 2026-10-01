// Harness health (salud-del-harness §1.2, §9): one scorecard per piece of the harness over the latest post-mortem of
// every build request (latest `computed_at` per request, for one rules version: the newest one unless asked), and the
// cases behind each scorecard. Derived on read; nothing is stored. The verdict thresholds (0.7 precision, 0.5 recall,
// at least 10 decisions) are «convención nuestra»: no standard fixes them (scikit-learn defines the measures, not their
// cuts; TypeSafe's confidence guide says thresholds depend on the cost of being wrong and are tuned on one's own data).
// They live here, in code, so changing one is a visible change, not a discussion.

import { sql } from 'kysely';
import { queueDecisionRows as storedQueueDecisionRows, type QueueDecisionRow } from '../build/queue-decisions.ts';
import type { Db } from '../db/connection.ts';
import { PIECE_NAMES } from '../harness/pieces.ts';
import { PENDING_ESCAPE_RULES } from '../harness/rules/escapes/index.ts';

export const MIN_DECISIONS = 10;
export const PRECISION_HELPS = 0.7;
export const PRECISION_HURTS = 0.5;
export const RECALL_HELPS = 0.5;
/** Ground truths whose false negatives do harm: a failure on main after the merge (G03) and a later issue (G10). */
export const HARMFUL_GROUND_TRUTHS: ReadonlySet<string> = new Set(['G03', 'G10']);
/** Cases listed per piece (convención nuestra); the counts always cover all of them. */
export const CASES_PER_PIECE = 50;

export type Verdict = 'helps' | 'neutral' | 'hurts' | 'no_data';
export type FindingClass = 'tp' | 'fp' | 'fn' | 'tn' | 'benefit' | 'cost' | 'info';
const CLASSES: readonly FindingClass[] = ['tp', 'fp', 'fn', 'tn', 'benefit', 'cost', 'info'];

/** The columns the scorecard reads from a finding. */
export type FindingFact = {
  piece: string;
  class: FindingClass;
  ground_truth: string | null;
  value: number | null;
  unit: string | null;
};

export type ScorecardInput = {
  counts: Record<FindingClass, number>;
  benefit: Record<string, number>;
  cost: Record<string, number>;
  /** Whether some false negative has a harmful ground truth. */
  harmful_fn: boolean;
};

export type Scorecard = ScorecardInput & {
  piece: string;
  /** Decisions: every finding except `info` (a TP, FP, FN, TN, a benefit or a cost). */
  n: number;
  precision: number | null;
  recall: number | null;
  verdict: Verdict;
};

export type HarnessCase = {
  finding_id: string;
  piece: string;
  finding: string;
  class: FindingClass;
  ground_truth: string | null;
  value: number | null;
  unit: string | null;
  subject: string | null;
  attempt: number | null;
  build_request_id: string;
  task_code: string;
  pr_url: string | null;
  postmortem_id: string;
  computed_at: string;
};

/** `name` is the English name of the piece in the inventory of the design (harness/pieces.ts); null when it has none. */
export type PieceHealth = Scorecard & { name: string | null; cases: HarnessCase[]; cases_total: number };

export type HarnessHealth = {
  rules_version: string | null;
  /** Requests with a post-mortem under that rules version. */
  requests: number;
  thresholds: { min_decisions: number; precision_helps: number; precision_hurts: number; recall_helps: number };
  pieces: PieceHealth[];
};

const emptyCounts = (): Record<FindingClass, number> => ({ tp: 0, fp: 0, fn: 0, tn: 0, benefit: 0, cost: 0, info: 0 });

const sumOf = (m: Record<string, number>): number => Object.values(m).reduce((a, b) => a + b, 0);

/**
 * The verdict of §1.2. «sin datos» under 10 decisions. «estorba»: precision < 0.5, or cost without any TP, or a harmful
 * FN while the cost is not zero. «ayuda»: precision ≥ 0.7 and recall ≥ 0.5 (each only when measurable) and, per unit
 * with both benefit and cost, benefit above cost; it needs something measurable to compare. «neutra»: the rest.
 */
export function verdictOf(card: ScorecardInput & { n: number; precision: number | null; recall: number | null }): Verdict {
  if (card.n < MIN_DECISIONS) return 'no_data';
  const costed = sumOf(card.cost) > 0;
  if ((card.precision !== null && card.precision < PRECISION_HURTS) || (costed && card.counts.tp === 0) || (card.harmful_fn && costed)) return 'hurts';
  const shared = Object.keys(card.benefit).filter((u) => u in card.cost);
  const measurable = card.precision !== null || card.recall !== null || shared.length > 0;
  const precisionOk = card.precision === null || card.precision >= PRECISION_HELPS;
  const recallOk = card.recall === null || card.recall >= RECALL_HELPS;
  const balanceOk = shared.every((u) => (card.benefit[u] ?? 0) > (card.cost[u] ?? 0));
  return measurable && precisionOk && recallOk && balanceOk ? 'helps' : 'neutral';
}

/** Scorecards (without cases), one per piece, ordered by piece code. Pure. */
export function scorecardsOf(facts: readonly FindingFact[]): Scorecard[] {
  const byPiece = new Map<string, FindingFact[]>();
  for (const f of facts) byPiece.set(f.piece, [...(byPiece.get(f.piece) ?? []), f]);
  return [...byPiece.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([piece, list]) => {
      const counts = emptyCounts();
      const benefit: Record<string, number> = {};
      const cost: Record<string, number> = {};
      let harmful = false;
      for (const f of list) {
        counts[f.class] += 1;
        if (f.class === 'fn' && f.ground_truth !== null && HARMFUL_GROUND_TRUTHS.has(f.ground_truth)) harmful = true;
        if ((f.class === 'benefit' || f.class === 'cost') && f.unit !== null && f.value !== null) {
          const into = f.class === 'benefit' ? benefit : cost;
          into[f.unit] = (into[f.unit] ?? 0) + f.value;
        }
      }
      const n = counts.tp + counts.fp + counts.fn + counts.tn + counts.benefit + counts.cost;
      const precision = counts.tp + counts.fp > 0 ? counts.tp / (counts.tp + counts.fp) : null;
      const recall = counts.tp + counts.fn > 0 ? counts.tp / (counts.tp + counts.fn) : null;
      const base = { counts, benefit, cost, harmful_fn: harmful, n, precision, recall };
      return { piece, ...base, verdict: verdictOf(base) };
    });
}

export type HealthOptions = {
  /** Rules version to read; the newest by computation time when omitted. */
  rules?: string;
  from?: string | Date;
  to?: string | Date;
  piece?: string;
};

export type FindingRow = {
  id: string;
  postmortem_id: string;
  build_request_id: string;
  task_code: string;
  attempt: number | null;
  piece: string;
  finding: string;
  class: FindingClass;
  ground_truth: string | null;
  value: number | null;
  unit: string | null;
  subject: string | null;
  evidence: unknown;
  harness_version: string | null;
  rules_version: string;
  pr_url: string | null;
  computed_at: string;
  created_at: string;
};

const iso = (d: unknown): string => new Date(d as Date | string).toISOString();

/** The rules version to read: the asked one, or the version of the latest post-mortem of the project. */
async function rulesVersionOf(db: Db, projectId: string, asked: string | undefined): Promise<string | null> {
  if (asked) return asked;
  const row = await db
    .selectFrom('harness_postmortems')
    .select('rules_version')
    .where('project_id', '=', projectId)
    .orderBy('computed_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row?.rules_version ?? null;
}

/** Every finding of the latest post-mortem of each request, for one rules version (the rows the scorecards read). */
export async function harnessFindingRows(db: Db, projectId: string, opts: HealthOptions = {}): Promise<{ rules_version: string | null; requests: number; rows: FindingRow[] }> {
  const rules = await rulesVersionOf(db, projectId, opts.rules);
  if (rules === null) return { rules_version: null, requests: 0, rows: [] };
  const latest = sql`(select distinct on (build_request_id) id from harness_postmortems where project_id = ${projectId} and rules_version = ${rules} order by build_request_id, computed_at desc, id desc)`;
  let q = db
    .selectFrom('harness_findings as f')
    .innerJoin('harness_postmortems as p', 'p.id', 'f.postmortem_id')
    .innerJoin('build_requests as r', 'r.id', 'f.build_request_id')
    .innerJoin('records as rec', 'rec.id', 'r.task_id')
    .select([
      'f.id',
      'f.postmortem_id',
      'f.build_request_id',
      'rec.code as task_code',
      'f.attempt',
      'f.piece',
      'f.finding',
      'f.class',
      'f.ground_truth',
      'f.value',
      'f.unit',
      'f.subject',
      'f.evidence',
      'p.harness_version_id',
      'p.rules_version',
      'r.pr_url',
      'p.computed_at',
      'f.created_at',
    ])
    .where('f.project_id', '=', projectId)
    .where(sql<boolean>`p.id in ${latest}`);
  if (opts.from) q = q.where(sql<boolean>`p.computed_at >= ${new Date(opts.from)}`);
  if (opts.to) q = q.where(sql<boolean>`p.computed_at <= ${new Date(opts.to)}`);
  if (opts.piece) q = q.where('f.piece', '=', opts.piece);
  const found = await q.orderBy('f.created_at', 'desc').orderBy('f.id', 'desc').execute();
  const rows = found.map(
    (r): FindingRow => ({
      id: r.id,
      postmortem_id: r.postmortem_id,
      build_request_id: r.build_request_id,
      task_code: r.task_code,
      attempt: r.attempt,
      piece: r.piece,
      finding: r.finding,
      class: r.class,
      ground_truth: r.ground_truth,
      value: r.value === null ? null : Number(r.value),
      unit: r.unit,
      subject: r.subject,
      evidence: r.evidence,
      harness_version: r.harness_version_id,
      rules_version: r.rules_version,
      pr_url: r.pr_url,
      computed_at: iso(r.computed_at),
      created_at: iso(r.created_at),
    }),
  );
  const requests = Number(
    (
      await db
        .selectFrom('harness_postmortems')
        .select(sql<string>`count(distinct build_request_id)`.as('n'))
        .where('project_id', '=', projectId)
        .where('rules_version', '=', rules)
        .executeTakeFirstOrThrow()
    ).n,
  );
  return { rules_version: rules, requests, rows };
}

/** The scorecards per piece with their cases (newest first, capped per piece). */
export async function harnessScorecards(db: Db, projectId: string, opts: HealthOptions = {}): Promise<HarnessHealth> {
  const { rules_version, requests, rows } = await harnessFindingRows(db, projectId, opts);
  const cases = new Map<string, HarnessCase[]>();
  for (const r of rows) {
    if (r.class === 'info') continue;
    cases.set(r.piece, [
      ...(cases.get(r.piece) ?? []),
      {
        finding_id: r.id,
        piece: r.piece,
        finding: r.finding,
        class: r.class,
        ground_truth: r.ground_truth,
        value: r.value,
        unit: r.unit,
        subject: r.subject,
        attempt: r.attempt,
        build_request_id: r.build_request_id,
        task_code: r.task_code,
        pr_url: r.pr_url,
        postmortem_id: r.postmortem_id,
        computed_at: r.computed_at,
      },
    ]);
  }
  return {
    rules_version,
    requests,
    thresholds: { min_decisions: MIN_DECISIONS, precision_helps: PRECISION_HELPS, precision_hurts: PRECISION_HURTS, recall_helps: RECALL_HELPS },
    pieces: scorecardsOf(rows).map((card) => {
      const all = cases.get(card.piece) ?? [];
      return { ...card, name: PIECE_NAMES[card.piece] ?? null, cases: all.slice(0, CASES_PER_PIECE), cases_total: all.length };
    }),
  };
}

// CSV: the same cell rules as `factsToCsv` (RFC 4180 quoting; a text a spreadsheet would read as a formula gets a
// leading quote, OWASP «CSV injection»).
function cell(v: string | number | null): string {
  if (v === null) return '';
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const FINDING_COLUMNS: { key: string; value: (r: FindingRow) => string | number | null }[] = [
  { key: 'id', value: (r) => r.id },
  { key: 'postmortem_id', value: (r) => r.postmortem_id },
  { key: 'build_request_id', value: (r) => r.build_request_id },
  { key: 'task_code', value: (r) => r.task_code },
  { key: 'attempt', value: (r) => r.attempt },
  { key: 'piece', value: (r) => r.piece },
  { key: 'finding', value: (r) => r.finding },
  { key: 'class', value: (r) => r.class },
  { key: 'ground_truth', value: (r) => r.ground_truth },
  { key: 'value', value: (r) => r.value },
  { key: 'unit', value: (r) => r.unit },
  { key: 'subject', value: (r) => r.subject },
  { key: 'evidence', value: (r) => JSON.stringify(r.evidence ?? null) },
  { key: 'harness_version', value: (r) => r.harness_version },
  { key: 'rules_version', value: (r) => r.rules_version },
  { key: 'pr_url', value: (r) => r.pr_url },
  { key: 'computed_at', value: (r) => r.computed_at },
  { key: 'created_at', value: (r) => r.created_at },
];

/** The findings as CSV (header, then one line per finding), CRLF line ends. */
export function findingsToCsv(rows: readonly FindingRow[]): string {
  const lines = [FINDING_COLUMNS.map((c) => c.key).join(',')];
  for (const r of rows) lines.push(FINDING_COLUMNS.map((c) => cell(c.value(r))).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/** Passthrough: the stored queue decisions (build/queue-decisions.ts), exported next to the findings. */
export const queueDecisionRows = (db: Db, projectId: string, opts: { since?: Date | string } = {}): Promise<QueueDecisionRow[]> => storedQueueDecisionRows(db, projectId, opts);

const DECISION_KEYS = ['plan_id', 'decided_at', 'trigger', 'parallel_limit', 'running', 'started', 'ready_count', 'stopped_kind', 'stopped_code', 'task_code', 'decision', 'item', 'with_task', 'with_source', 'evidence'] as const;

/** The queue decisions as CSV (header, then one line per decision), CRLF line ends; lists and evidence as JSON text. */
export function queueDecisionsToCsv(rows: readonly QueueDecisionRow[]): string {
  const lines: string[] = [DECISION_KEYS.join(',')];
  for (const r of rows) {
    lines.push(
      DECISION_KEYS.map((k) => {
        const v = r[k];
        return cell(v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : (v as string | number));
      }).join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}


// --- Escapes (salud-del-harness §4): what design did not see and building found later, stored by harness/escapes.ts ---

/** Escapes returned per call (convención nuestra); the counts by rule always cover all of them. */
export const ESCAPE_ROWS_MAX = 2000;

export type EscapeRow = {
  id: string;
  rule: string;
  introduced_phase: string;
  found_phase: string;
  record_code: string | null;
  criterion_code: string | null;
  build_request_id: string | null;
  pr_review_id: string | null;
  comment_index: number | null;
  subject: string | null;
  evidence: unknown;
  occurred_at: string | null;
  detected_at: string;
  rules_version: string;
};

export type HarnessEscapes = {
  rules_version: string | null;
  /** Rules whose data is not stored yet (listed, not faked). */
  pending_rules: readonly string[];
  total: number;
  by_rule: { rule: string; n: number }[];
  rows: EscapeRow[];
};

/** The stored escapes of the project for one rules version (the newest one unless asked), newest fact first. */
export async function harnessEscapes(db: Db, projectId: string, opts: { rules?: string; from?: Date | string; to?: Date | string } = {}): Promise<HarnessEscapes> {
  const rules =
    opts.rules ??
    (
      await db
        .selectFrom('harness_escapes')
        .select('rules_version')
        .where('project_id', '=', projectId)
        .orderBy('detected_at', 'desc')
        .orderBy('id', 'desc')
        .limit(1)
        .executeTakeFirst()
    )?.rules_version ??
    null;
  if (rules === null) return { rules_version: null, pending_rules: PENDING_ESCAPE_RULES, total: 0, by_rule: [], rows: [] };
  let q = db.selectFrom('harness_escapes').where('project_id', '=', projectId).where('rules_version', '=', rules);
  if (opts.from) q = q.where((eb) => eb.or([eb('occurred_at', 'is', null), eb('occurred_at', '>=', new Date(opts.from as Date | string))]));
  if (opts.to) q = q.where((eb) => eb.or([eb('occurred_at', 'is', null), eb('occurred_at', '<=', new Date(opts.to as Date | string))]));
  const counts = await q.select(['rule', (eb) => eb.fn.countAll<string>().as('n')]).groupBy('rule').orderBy('rule').execute();
  const rows = await q
    .select(['id', 'rule', 'introduced_phase', 'found_phase', 'record_code', 'criterion_code', 'build_request_id', 'pr_review_id', 'comment_index', 'subject', 'evidence', 'occurred_at', 'detected_at', 'rules_version'])
    .orderBy('rule')
    .orderBy(sql`occurred_at desc nulls last`)
    .orderBy('id', 'desc')
    .limit(ESCAPE_ROWS_MAX)
    .execute();
  return {
    rules_version: rules,
    pending_rules: PENDING_ESCAPE_RULES,
    total: counts.reduce((a, c) => a + Number(c.n), 0),
    by_rule: counts.map((c) => ({ rule: c.rule, n: Number(c.n) })),
    rows: rows.map((r) => ({ ...r, occurred_at: r.occurred_at === null ? null : iso(r.occurred_at), detected_at: iso(r.detected_at) })),
  };
}

const ESCAPE_COLUMNS = ['rule', 'introduced_phase', 'found_phase', 'record_code', 'criterion_code', 'build_request_id', 'pr_review_id', 'comment_index', 'subject', 'evidence', 'occurred_at', 'detected_at', 'rules_version'] as const;

/** The escapes as CSV (header, then one line per escape), CRLF line ends; evidence as JSON text. */
export function escapesToCsv(rows: readonly EscapeRow[]): string {
  const lines: string[] = [ESCAPE_COLUMNS.join(',')];
  for (const r of rows) {
    lines.push(
      ESCAPE_COLUMNS.map((k) => {
        const v = r[k];
        return cell(v === null || v === undefined ? null : typeof v === 'object' ? JSON.stringify(v) : (v as string | number));
      }).join(','),
    );
  }
  return `${lines.join('\r\n')}\r\n`;
}

// ------------------------------------------------------------------------------------ cohorts by harness version

/** Label of a comparison that is not an experiment (Kohavi, Tang and Xu, «Trustworthy Online Controlled Experiments»). */
export const NOT_COMPARABLE = 'observational, not comparable';

export type VersionCohort = {
  /** The harness version id, or null for the builds tagged with none (from before versions existed). */
  harness_version_id: string | null;
  demiurgo_sha: string | null;
  first_seen_at: string | null;
  /** Build requests of the cohort with a post-mortem, and when the first and the last of them started. */
  requests: number;
  from: string | null;
  to: string | null;
  scorecards: Scorecard[];
  /** The other cohorts whose time span overlaps this one. */
  overlaps: (string | null)[];
  /** `observational` always (no random or alternating assignment); not comparable when no other cohort overlaps in time. */
  label: 'observational' | typeof NOT_COMPARABLE;
};

export type VersionCohorts = { rules_version: string | null; cohorts: VersionCohort[] };

type Span = { key: string | null; from: Date | null; to: Date | null };

/** The keys of the spans that overlap each other's (closed intervals). A span without dates overlaps nothing. Pure. */
export function overlapsOf(spans: readonly Span[]): Map<string | null, (string | null)[]> {
  const out = new Map<string | null, (string | null)[]>();
  for (const a of spans) {
    out.set(
      a.key,
      spans
        .filter((b) => b.key !== a.key && a.from && a.to && b.from && b.to && a.from <= b.to && b.from <= a.to)
        .map((b) => b.key),
    );
  }
  return out;
}

/** Scorecards per harness version (§9.3): the cohorts, each with its time span, and which of them can be compared. */
export async function scorecardsByVersion(db: Db, projectId: string, opts: HealthOptions = {}): Promise<VersionCohorts> {
  const { rules_version, rows } = await harnessFindingRows(db, projectId, opts);
  if (rules_version === null || rows.length === 0) return { rules_version, cohorts: [] };
  const groups = new Map<string | null, FindingRow[]>();
  for (const r of rows) groups.set(r.harness_version, [...(groups.get(r.harness_version) ?? []), r]);
  const requestIds = [...new Set(rows.map((r) => r.build_request_id))];
  const starts = await db
    .selectFrom('build_steps')
    .select(['build_request_id', sql<Date>`min(created_at)`.as('started')])
    .where('build_request_id', 'in', requestIds)
    .where('stage', '=', 'repo')
    .where('outcome', '=', 'started')
    .groupBy('build_request_id')
    .execute();
  const startOf = new Map(starts.map((s) => [s.build_request_id, new Date(s.started)]));
  const ids = [...groups.keys()].filter((k): k is string => k !== null);
  const versions = ids.length === 0 ? [] : await db.selectFrom('harness_versions').select(['id', 'demiurgo_sha', 'first_seen_at']).where('id', 'in', ids).execute();
  const spans: Span[] = [...groups.entries()].map(([key, list]) => {
    const dates = [...new Set(list.map((r) => r.build_request_id))].map((id) => startOf.get(id)).filter((d): d is Date => d !== undefined).toSorted((a, b) => a.getTime() - b.getTime());
    return { key, from: dates[0] ?? null, to: dates.at(-1) ?? null };
  });
  const overlaps = overlapsOf(spans);
  const cohorts = spans.map((span): VersionCohort => {
    const list = groups.get(span.key) ?? [];
    const v = versions.find((x) => x.id === span.key);
    const others = overlaps.get(span.key) ?? [];
    return {
      harness_version_id: span.key,
      demiurgo_sha: v?.demiurgo_sha ?? null,
      first_seen_at: v ? iso(v.first_seen_at) : null,
      requests: new Set(list.map((r) => r.build_request_id)).size,
      from: span.from ? span.from.toISOString() : null,
      to: span.to ? span.to.toISOString() : null,
      scorecards: scorecardsOf(list),
      overlaps: others,
      label: spans.length > 1 && others.length === 0 ? NOT_COMPARABLE : 'observational',
    };
  });
  cohorts.sort((a, b) => (a.from ?? '').localeCompare(b.from ?? ''));
  return { rules_version, cohorts };
}


// --- Checks (salud-del-harness §8): the periodic checks stored by harness/check.ts, newest first ---

/** Checks returned per call (convención nuestra). */
export const CHECK_ROWS_MAX = 30;

export type CheckRow = {
  id: string;
  window_from: string;
  window_to: string;
  previous_check_id: string | null;
  rules_version: string;
  trigger: 'schedule' | 'merges' | 'manual';
  scorecards: unknown;
  escapes: unknown;
  regressions: unknown;
  worth: unknown;
  inputs_hash: string;
  computed_at: string;
};

export type HarnessChecks = { total: number; latest: CheckRow | null; checks: CheckRow[] };

/** The stored checks of the project: the latest with its content, and the series (newest first, capped). */
export async function harnessChecks(db: Db, projectId: string, opts: { limit?: number } = {}): Promise<HarnessChecks> {
  const total = Number(
    (await db.selectFrom('harness_checks').select(sql<string>`count(*)`.as('n')).where('project_id', '=', projectId).executeTakeFirstOrThrow()).n,
  );
  const rows = await db
    .selectFrom('harness_checks')
    .select(['id', 'window_from', 'window_to', 'previous_check_id', 'rules_version', 'trigger', 'scorecards', 'escapes', 'regressions', 'worth', 'inputs_hash', 'computed_at'])
    .where('project_id', '=', projectId)
    .orderBy('computed_at', 'desc')
    .orderBy('id', 'desc')
    .limit(Math.min(Math.max(opts.limit ?? CHECK_ROWS_MAX, 1), CHECK_ROWS_MAX))
    .execute();
  const checks = rows.map((r): CheckRow => ({ ...r, window_from: iso(r.window_from), window_to: iso(r.window_to), computed_at: iso(r.computed_at) }));
  return { total, latest: checks[0] ?? null, checks };
}
