// The periodic check of the harness (salud-del-harness §8): a deterministic job that recomputes the scorecards over the
// last 7 days, records the escapes found since the previous check, compares with that check and stores the result in
// `harness_checks` (append-only). Regressions are the one thing that reaches the person: a check with at least one
// opens one `harness_regression` issue (Needs you), unless an earlier one is still open. No model call anywhere.
//
// Thresholds are «convención nuestra» (no standard fixes them; the Scrum Guide 2020 only says the retrospective closes
// each sprint, at most one month): a window of 7 days, a check every 24 hours or every 5 merged tasks, a cost per merged
// task up by more than 25 %, a containment drop of more than 0.2. They live here, in code, so changing one is visible.
// Containment (Daskalantonakis 1992, Motorola; Kan, ch. 4) counts here only the errors the escapes table stores as found
// in the phase that introduced them (introduced = found, e.g. E06); a phase without such rows reads as 0.

import { createHash } from 'node:crypto';
import { system } from '@demiurgo/domain';
import { sql } from 'kysely';
import { executeCommand } from '../bus/bus.ts';
import type { Db } from '../db/connection.ts';
import { worthIt, type WorthIt } from '../queries/attention.ts';
import { harnessScorecards, type PieceHealth, type Verdict } from '../queries/harness-health.ts';
import type { Services } from '../services.ts';
import { detectEscapes, ESCAPES_RULES_VERSION } from './escapes.ts';
import { PIECE_NAMES } from './pieces.ts';
import { serialized } from './postmortem.ts';

export const CHECK_WINDOW_DAYS = 7;
export const CHECK_EVERY_HOURS = 24;
export const CHECK_EVERY_MERGES = 5;
/** A cost per merged task up by more than this share against the previous check is a regression. */
export const COST_RISE = 0.25;
/** A phase whose containment falls by more than this (absolute, 0..1) is a regression, from at least `PCE_MIN_ITEMS` items. */
export const PCE_DROP = 0.2;
export const PCE_MIN_ITEMS = 5;
/** Escape ids stored per check; the total always counts all of them. */
export const NEW_ESCAPE_IDS_MAX = 500;
export const REGRESSION_SOURCE_PREFIX = 'harness_check:';

const HARNESS = system('harness', '1');
const DAY_MS = 86_400_000;

export type CheckTrigger = 'schedule' | 'merges' | 'manual';

export type RegressionKind = 'verdict_worse' | 'containment_drop' | 'cost_per_task_up';
/** The closed list of §8.3: {kind, piece|phase, before, after, threshold}. */
export type Regression = {
  kind: RegressionKind;
  piece?: string;
  phase?: string;
  unit?: string;
  before: string | number | null;
  after: string | number | null;
  threshold: number | null;
};

export type CheckScorecard = {
  piece: string;
  name: string | null;
  n: number;
  counts: PieceHealth['counts'];
  precision: number | null;
  recall: number | null;
  benefit: Record<string, number>;
  cost: Record<string, number>;
  verdict: Verdict;
  /** The verdict in the previous check; null when there was none or the piece was not in it. */
  previous_verdict: Verdict | null;
};

export type PhaseContainment = { phase: string; contained: number; escaped: number; pce: number | null };

export type CheckEscapes = {
  rules_version: string;
  /** Escapes recorded since the previous check (all of them when there was none). */
  new_total: number;
  new_ids: string[];
  by_rule: Record<string, number>;
  pce: PhaseContainment[];
};

/** What a check keeps of itself to be compared with by the next one. */
export type CheckSnapshot = {
  verdicts: Record<string, Verdict>;
  pce: Record<string, { pce: number | null; items: number }>;
  units: { usd_per_merged_task: number | null; tokens_per_merged_task: number | null };
};

const RANK: Record<Verdict, number | null> = { helps: 2, neutral: 1, hurts: 0, no_data: null };

/** Regressions of one check against the previous one. Pure; with no previous check there is nothing to compare. */
export function regressionsOf(previous: CheckSnapshot | null, current: CheckSnapshot): Regression[] {
  if (!previous) return [];
  const out: Regression[] = [];
  for (const [piece, after] of Object.entries(current.verdicts).sort(([a], [b]) => a.localeCompare(b))) {
    const before = previous.verdicts[piece];
    const b = before ? RANK[before] : null;
    const a = RANK[after];
    if (before && b !== null && a !== null && a < b) out.push({ kind: 'verdict_worse', piece, before, after, threshold: null });
  }
  for (const [phase, now] of Object.entries(current.pce).sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
    const was = previous.pce[phase];
    if (!was || was.pce === null || now.pce === null || now.items < PCE_MIN_ITEMS) continue;
    if (was.pce - now.pce > PCE_DROP) out.push({ kind: 'containment_drop', phase, before: was.pce, after: now.pce, threshold: PCE_DROP });
  }
  for (const unit of ['usd_per_merged_task', 'tokens_per_merged_task'] as const) {
    const before = previous.units[unit];
    const after = current.units[unit];
    if (before !== null && before > 0 && after !== null && after > before * (1 + COST_RISE)) out.push({ kind: 'cost_per_task_up', unit, before, after, threshold: COST_RISE });
  }
  return out;
}

const ms = (d: unknown): number => new Date(d as Date | string).getTime();
const round = (n: number, digits = 3): number => Math.round(n * 10 ** digits) / 10 ** digits;

/**
 * Containment per introducing phase from escape rows. Contained is only a row the rule marked (`evidence.contained`: a
 * problem the design itself caught, e.g. a contradiction resolved before building); found in a later phase is escaped;
 * a row found in its own phase and not marked is neither (a confirmation or an operation is not a caught error). Pure.
 */
export function containmentOf(rows: readonly { introduced_phase: string; found_phase: string; evidence?: unknown }[]): PhaseContainment[] {
  const by = new Map<string, { contained: number; escaped: number }>();
  for (const r of rows) {
    const marked = (r.evidence as { contained?: unknown } | null | undefined)?.contained === true;
    if (!marked && r.introduced_phase === r.found_phase) continue;
    const cell = by.get(r.introduced_phase) ?? { contained: 0, escaped: 0 };
    if (marked) cell.contained += 1;
    else cell.escaped += 1;
    by.set(r.introduced_phase, cell);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([phase, c]) => ({ phase, ...c, pce: c.contained + c.escaped > 0 ? round(c.contained / (c.contained + c.escaped)) : null }));
}

type StoredCheck = {
  id: string;
  computed_at: unknown;
  inputs_hash: string;
  scorecards: unknown;
  escapes: unknown;
  worth: unknown;
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/** The snapshot the next check compares against, read back from a stored check. */
export function snapshotOf(check: Pick<StoredCheck, 'scorecards' | 'escapes' | 'worth'>): CheckSnapshot {
  const verdicts: Record<string, Verdict> = {};
  for (const c of Array.isArray(check.scorecards) ? (check.scorecards as CheckScorecard[]) : []) verdicts[c.piece] = c.verdict;
  const pce: CheckSnapshot['pce'] = {};
  const stored = obj(check.escapes).pce;
  for (const p of Array.isArray(stored) ? (stored as PhaseContainment[]) : []) pce[p.phase] = { pce: p.pce, items: p.contained + p.escaped };
  const units = obj(obj(check.worth).units);
  const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
  return { verdicts, pce, units: { usd_per_merged_task: num(units.usd_per_merged_task), tokens_per_merged_task: num(units.tokens_per_merged_task) } };
}

async function latestCheck(db: Db, projectId: string): Promise<StoredCheck | null> {
  return (
    (await db
      .selectFrom('harness_checks')
      .select(['id', 'computed_at', 'inputs_hash', 'scorecards', 'escapes', 'worth'])
      .where('project_id', '=', projectId)
      .orderBy('computed_at', 'desc')
      .orderBy('id', 'desc')
      .limit(1)
      .executeTakeFirst()) ?? null
  );
}

/**
 * Whether a check is due: a project with some post-mortem and no check yet is; after that, one every 24 hours or every 5
 * tasks merged since the last one (whichever comes first). Returns the trigger or null.
 */
export async function dueCheck(db: Db, projectId: string, now: Date = new Date()): Promise<CheckTrigger | null> {
  const any = await db.selectFrom('harness_postmortems').select('id').where('project_id', '=', projectId).limit(1).executeTakeFirst();
  if (!any) return null;
  const last = await latestCheck(db, projectId);
  if (!last) return 'schedule';
  const merged = Number(
    (
      await db
        .selectFrom('build_requests')
        .select(sql<string>`count(*)`.as('n'))
        .where('project_id', '=', projectId)
        .where('state', '=', 'done')
        .where('done_at', '>', new Date(last.computed_at as Date | string))
        .executeTakeFirstOrThrow()
    ).n,
  );
  if (merged >= CHECK_EVERY_MERGES) return 'merges';
  if (now.getTime() - ms(last.computed_at) >= CHECK_EVERY_HOURS * 3_600_000) return 'schedule';
  return null;
}

export type CheckResult =
  | { status: 'recorded'; id: string; regressions: Regression[]; issue: string | null }
  | { status: 'unchanged'; id: string };

/** One line per regression, for the issue and the CLI. */
export function describeRegression(r: Regression): string {
  const name = r.piece ? `${r.piece}${PIECE_NAMES[r.piece] ? ` (${PIECE_NAMES[r.piece]})` : ''}` : (r.phase ?? r.unit ?? '');
  if (r.kind === 'verdict_worse') return `${name}: verdict went from ${r.before} to ${r.after}.`;
  if (r.kind === 'containment_drop') return `Phase ${name}: containment fell from ${r.before} to ${r.after} (more than ${r.threshold}).`;
  return `Cost ${name}: went from ${r.before} to ${r.after} (more than ${Math.round((r.threshold ?? 0) * 100)} % up).`;
}

/** Opens the one `harness_regression` issue of a check; none when an earlier one is still open. Returns its code. */
async function openRegressionIssue(services: Services, projectId: string, checkId: string, regressions: readonly Regression[]): Promise<string | null> {
  const open = await services.db
    .selectFrom('issues')
    .select('id')
    .where('project_id', '=', projectId)
    .where('kind', '=', 'harness_regression')
    .where('state', '=', 'open')
    .limit(1)
    .executeTakeFirst();
  if (open) return null;
  const done = await executeCommand(services, {
    command: 'issue.open',
    actor: HARNESS,
    projectId,
    data: {
      kind: 'harness_regression',
      title: `The harness got worse: ${regressions.length} regression${regressions.length === 1 ? '' : 's'} in the latest check`,
      body: [...regressions.map(describeRegression), '', 'See Observability, Harness health, Checks.'].join('\n'),
      source_key: `${REGRESSION_SOURCE_PREFIX}${checkId}`,
    },
  });
  return (done.result as { code?: string } | undefined)?.code ?? null;
}

/**
 * Runs one check and stores it. Idempotent: when the inputs equal those of the latest check (same hash) nothing is
 * written. Serialized per project with the post-mortems.
 */
export async function runCheck(services: Services, projectId: string, trigger: CheckTrigger, now: Date = services.clock()): Promise<CheckResult> {
  return serialized(projectId, async () => {
    const db = services.db;
    const windowFrom = new Date(now.getTime() - CHECK_WINDOW_DAYS * DAY_MS);
    const previous = await latestCheck(db, projectId);
    await detectEscapes(db, projectId);

    const health = await harnessScorecards(db, projectId, { from: windowFrom, to: now });
    const prevSnapshot = previous ? snapshotOf(previous) : null;
    const scorecards: CheckScorecard[] = health.pieces.map((p) => ({
      piece: p.piece,
      name: p.name,
      n: p.n,
      counts: p.counts,
      precision: p.precision,
      recall: p.recall,
      benefit: p.benefit,
      cost: p.cost,
      verdict: p.verdict,
      previous_verdict: prevSnapshot?.verdicts[p.piece] ?? null,
    }));

    const rows = await db
      .selectFrom('harness_escapes')
      .select(['id', 'rule', 'introduced_phase', 'found_phase', 'evidence', 'detected_at', 'occurred_at'])
      .where('project_id', '=', projectId)
      .where('rules_version', '=', ESCAPES_RULES_VERSION)
      .orderBy('detected_at')
      .orderBy('id')
      .execute();
    const inWindow = rows.filter((r) => r.occurred_at === null || ms(r.occurred_at) >= windowFrom.getTime());
    const fresh = previous ? rows.filter((r) => ms(r.detected_at) > ms(previous.computed_at)) : rows;
    const byRule: Record<string, number> = {};
    for (const r of fresh) byRule[r.rule] = (byRule[r.rule] ?? 0) + 1;
    const escapes: CheckEscapes = {
      rules_version: ESCAPES_RULES_VERSION,
      new_total: fresh.length,
      new_ids: fresh.slice(0, NEW_ESCAPE_IDS_MAX).map((r) => r.id),
      by_rule: byRule,
      pce: containmentOf(inWindow),
    };

    const worth: WorthIt = await worthIt(db, projectId);
    const current: CheckSnapshot = {
      verdicts: Object.fromEntries(scorecards.map((c) => [c.piece, c.verdict])),
      pce: Object.fromEntries(escapes.pce.map((p) => [p.phase, { pce: p.pce, items: p.contained + p.escaped }])),
      units: { usd_per_merged_task: worth.units.usd_per_merged_task, tokens_per_merged_task: worth.units.tokens_per_merged_task },
    };
    const regressions = regressionsOf(prevSnapshot, current);

    // The hash covers the state the check read (not the previous check, nor what is «new» against it): the same state
    // never writes a second row.
    const state = {
      rules: health.rules_version,
      scorecards: scorecards.map(({ previous_verdict: _, ...card }) => card),
      escapes: { rules_version: ESCAPES_RULES_VERSION, ids: rows.map((r) => r.id), pce: escapes.pce },
      worth,
    };
    const inputsHash = createHash('sha256').update(JSON.stringify(state)).digest('hex');
    if (previous?.inputs_hash === inputsHash) return { status: 'unchanged', id: previous.id };

    const { id } = await db
      .insertInto('harness_checks')
      .values({
        project_id: projectId,
        window_from: windowFrom,
        window_to: now,
        previous_check_id: previous?.id ?? null,
        rules_version: health.rules_version ?? 'none',
        harness_version_id: null,
        trigger,
        scorecards: JSON.stringify(scorecards),
        escapes: JSON.stringify(escapes),
        regressions: JSON.stringify(regressions),
        worth: JSON.stringify(worth),
        inputs_hash: inputsHash,
      })
      .returning('id')
      .executeTakeFirstOrThrow();

    let issue: string | null = null;
    if (regressions.length > 0) {
      try {
        issue = await openRegressionIssue(services, projectId, id, regressions);
      } catch (e) {
        services.logger.error('The harness regression issue could not be opened', { check: id, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return { status: 'recorded', id, regressions, issue };
  });
}

/** A project whose check was attempted is not attempted again for this long (a check that changed nothing stays «due»). */
export const CHECK_RETRY_MS = 3_600_000;
const attempted = new Map<string, number>();

/** Runs the due checks of every project. Never throws: a failure is logged and the next project goes on. */
export async function runDueChecks(services: Services): Promise<number> {
  let written = 0;
  for (const p of await services.db.selectFrom('projects').select('id').execute()) {
    const at = services.clock().getTime();
    if (at - (attempted.get(p.id) ?? -Infinity) < CHECK_RETRY_MS) continue;
    try {
      const trigger = await dueCheck(services.db, p.id, services.clock());
      if (!trigger) continue;
      attempted.set(p.id, at);
      if ((await runCheck(services, p.id, trigger)).status === 'recorded') written++;
    } catch (e) {
      services.logger.error('The harness check could not be run', { project: p.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return written;
}
