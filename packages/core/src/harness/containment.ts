// Phase containment effectiveness (PCE) of the design phases, pure. PCE of a phase = errors caught in the phase that
// introduced them / (those + errors that escaped it): Daskalantonakis 1992 (Motorola) and Kan, «Metrics and Models in
// Software Quality Engineering», chapter «Defect Removal Effectiveness» (sin comprobar el número de capítulo; sin releer: the
// formula is quoted from memory).
//
// Decisions and conventions, all kept here in code so changing one is visible:
// - PCE_TARGET 0.9 per design phase: decisión de la persona (01-10). No standard fixes it.
// - A phase's PCE is only a number with its n (contained + escaped) and it reads «not enough data» below PCE_MIN_N
//   (convención nuestra: the same n >= 10 rule as the harness-health verdicts, MIN_DECISIONS).
// - Only rows the rule marked `evidence.contained` count as contained (esc-2), so the measure cannot be padded with
//   unmarked confirmations; every contained row is listed beside the escaped ones to be audited (convención nuestra).
// - An escape belongs to the moment its defect was INTRODUCED (`evidence.introduced_at`, esc-3; `occurred_at` when the
//   rule could not derive it). A late discovery therefore lowers the past: a window counts every escape introduced up
//   to its end and discovered at any time up to now, recomputed from the stored escapes on read; the stored check rows
//   stay as they were, append-only. Anti-cheating rule: decisión de la persona (01-10).
// - esc-4: contained and escaped are counted per distinct DEFECT, not per row: rows carry `evidence.defect_key` (the record
//   plus the criterion or finding) and rows of the same phase and key are one defect; when any of them escaped, the
//   defect escaped. A row without a key is its own defect. Convención nuestra (the defect, not the row, is what Kan's
//   defect removal effectiveness counts).
// - Only escapes of one rules version are ever compared (convención nuestra): never esc-2 with esc-3.

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
/** The defect the row belongs to (`evidence.defect_key`), or null when the rule gave none (the row is its own defect). */
export const defectKeyOf = (r: ContainmentRow): string | null => {
  const k = (r.evidence as { defect_key?: unknown } | null | undefined)?.defect_key;
  return typeof k === 'string' && k !== '' ? k : null;
};
export const isContained = (r: ContainmentRow): boolean => (r.evidence as { contained?: unknown } | null | undefined)?.contained === true;

/**
 * Containment per introducing design phase. Contained is only a row the rule marked; found in a later phase is escaped;
 * a row found in its own phase and not marked is neither (a confirmation or an operation is not a caught error).
 */
export function containmentOf(rows: readonly ContainmentRow[]): PhaseContainment[] {
  const by = new Map<string, { contained: number; escaped: number }>();
  // Rows sharing a defect key in the same phase are one defect; an escaped row wins over a contained one.
  const keyed = new Map<string, { phase: string; contained: boolean }>();
  const cellOf = (phase: string) => {
    const cell = by.get(phase) ?? { contained: 0, escaped: 0 };
    by.set(phase, cell);
    return cell;
  };
  for (const r of rows) {
    if (!(DESIGN_PHASES as readonly string[]).includes(r.introduced_phase)) continue;
    const marked = isContained(r);
    if (!marked && r.introduced_phase === r.found_phase) continue;
    const key = defectKeyOf(r);
    if (key === null) {
      const cell = cellOf(r.introduced_phase);
      if (marked) cell.contained += 1;
      else cell.escaped += 1;
      continue;
    }
    const id = `${r.introduced_phase}|${key}`;
    const prior = keyed.get(id);
    keyed.set(id, { phase: r.introduced_phase, contained: (prior ? prior.contained : true) && marked });
  }
  for (const d of keyed.values()) {
    const cell = cellOf(d.phase);
    if (d.contained) cell.contained += 1;
    else cell.escaped += 1;
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

/** When the defect was introduced (`evidence.introduced_at`), else when the fact happened; null when neither is known. */
export const introducedOf = (r: ContainmentRow): Date | string | null => {
  const at = (r.evidence as { introduced_at?: unknown } | null | undefined)?.introduced_at;
  return typeof at === 'string' && Number.isFinite(ms(at)) ? at : (r.occurred_at ?? null);
};

/**
 * The series recomputed from the stored escapes, one point per check window, oldest first. A window counts every escape
 * introduced up to its end (`introduced_at ?? occurred_at`; none known = every window) however late it was discovered,
 * and the lower bound is not applied: a window is the state of the design up to its end, so history is recomputed.
 */
export function containmentSeries(rows: readonly ContainmentRow[], checks: readonly CheckWindow[]): ContainmentPoint[] {
  return [...checks]
    .sort((a, b) => ms(a.computed_at) - ms(b.computed_at) || a.id.localeCompare(b.id))
    .map((c) => ({
      ...c,
      phases: containmentOf(
        rows.filter((r) => {
          const at = introducedOf(r);
          return at == null || ms(at) <= ms(c.window_to);
        }),
      ),
    }));
}
