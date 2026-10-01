// Phase containment effectiveness (PCE) of the design phases, pure. PCE of a phase = errors caught in the phase that
// introduced them / (those + errors that escaped it): Daskalantonakis 1992 (Motorola) and Kan, «Metrics and Models in
// Software Quality Engineering», ch. 6 (phase containment effectiveness; sin releer: the formula is quoted from memory).
//
// Decisions and conventions, all kept here in code so changing one is visible:
// - PCE_TARGET 0.9 per design phase: decisión de la persona (01-10). No standard fixes it.
// - A phase's PCE is only a number with its n (contained + escaped) and it reads «not enough data» below PCE_MIN_N
//   (convención nuestra: the same n >= 10 rule as the harness-health verdicts, MIN_DECISIONS).
// - Only rows the rule marked `evidence.contained` count as contained (esc-2), so the measure cannot be padded with
//   unmarked confirmations; every contained row is listed beside the escaped ones to be audited (convención nuestra).
// - A late discovery lowers past PCE: the series is recomputed from the stored escapes on read; the stored check rows
//   stay as they were, append-only (convención nuestra).
// - Only escapes of one rules version are ever compared (convención nuestra): never esc-1 with esc-2.

export const PCE_TARGET = 0.9;
export const PCE_MIN_N = 10;
/** P1..P7 are the design phases (P9 building, P10 review: those are where escapes are found, not contained). */
export const DESIGN_PHASES = ['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7'] as const;

export type PhaseContainment = {
  phase: string;
  contained: number;
  escaped: number;
  pce: number | null;
  /** contained + escaped. */
  n: number;
  /** Against PCE_TARGET; null while n < PCE_MIN_N («not enough data»). */
  target_met: boolean | null;
};

export type ContainmentRow = { introduced_phase: string; found_phase: string; evidence?: unknown; occurred_at?: Date | string | null };

const round = (n: number, digits = 3): number => Math.round(n * 10 ** digits) / 10 ** digits;
const ms = (d: Date | string): number => new Date(d).getTime();
export const isContained = (r: ContainmentRow): boolean => (r.evidence as { contained?: unknown } | null | undefined)?.contained === true;

/**
 * Containment per introducing design phase. Contained is only a row the rule marked; found in a later phase is escaped;
 * a row found in its own phase and not marked is neither (a confirmation or an operation is not a caught error).
 */
export function containmentOf(rows: readonly ContainmentRow[]): PhaseContainment[] {
  const by = new Map<string, { contained: number; escaped: number }>();
  for (const r of rows) {
    if (!(DESIGN_PHASES as readonly string[]).includes(r.introduced_phase)) continue;
    const marked = isContained(r);
    if (!marked && r.introduced_phase === r.found_phase) continue;
    const cell = by.get(r.introduced_phase) ?? { contained: 0, escaped: 0 };
    if (marked) cell.contained += 1;
    else cell.escaped += 1;
    by.set(r.introduced_phase, cell);
  }
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([phase, c]) => {
      const n = c.contained + c.escaped;
      const pce = n > 0 ? round(c.contained / n) : null;
      return { phase, ...c, pce, n, target_met: n < PCE_MIN_N || pce === null ? null : pce >= PCE_TARGET };
    });
}

export type CheckWindow = { id: string; computed_at: string; window_from: string; window_to: string };
export type ContainmentPoint = CheckWindow & { phases: PhaseContainment[] };

/**
 * The series recomputed from the stored escapes, one point per check window, oldest first. An escape found after the
 * check still counts in the window of the fact (`occurred_at`; none = every window), so history is recomputed, not frozen.
 */
export function containmentSeries(rows: readonly ContainmentRow[], checks: readonly CheckWindow[]): ContainmentPoint[] {
  return [...checks]
    .sort((a, b) => ms(a.computed_at) - ms(b.computed_at) || a.id.localeCompare(b.id))
    .map((c) => ({
      ...c,
      phases: containmentOf(rows.filter((r) => r.occurred_at == null || (ms(r.occurred_at) >= ms(c.window_from) && ms(r.occurred_at) <= ms(c.window_to)))),
    }));
}
