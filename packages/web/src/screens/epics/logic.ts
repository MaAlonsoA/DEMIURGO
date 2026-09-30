// An epic and its features (spec «Entrega por épicas», 1c). The epic's list is its planned features:
// records from the moment it lists them, each with its reserved code, in order; designing one makes
// the feature record with that code. A feature belongs to the epic it is based on; without that
// link, to the epic of its domain.

import type { ExplorationSummary, PlannedFeatureRow, ProductRow, ProductState } from '../../api/types.ts';
import { isFeatureThread } from '../../components/ask.ts';

export type EpicGroup = { epic: ProductRow; features: ProductRow[] };

const isEpicCode = (code: string | null): code is string => !!code && code.startsWith('EPC-');

/** The epic a feature belongs to: the one it is based on, else the one of its domain. */
export function epicOf(feature: ProductRow, epics: readonly ProductRow[]): ProductRow | undefined {
  if (isEpicCode(feature.based_on)) {
    const linked = epics.find((e) => e.code === feature.based_on);
    if (linked) return linked;
  }
  return epics.find((e) => e.domain === feature.domain);
}

/** The epics with the features that belong to each, and the features of no epic. */
export function epicGroups(rows: ProductRow[]): { groups: EpicGroup[]; loose: ProductRow[] } {
  // The person's backlog order; the epics not placed yet go last, by code.
  const epics = rows
    .filter((r) => r.type === 'epic')
    .sort((a, b) => (a.epic_position ?? Infinity) - (b.epic_position ?? Infinity) || a.code.localeCompare(b.code));
  const features = rows.filter((r) => r.type === 'fdr');
  return {
    groups: epics.map((epic) => ({ epic, features: features.filter((f) => epicOf(f, epics)?.code === epic.code) })),
    loose: features.filter((f) => !epicOf(f, epics)),
  };
}

/** Lowercase, without accents, quotes or trailing punctuation, single spaces: how names are matched. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/["'“”‘’«»*_`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s.:;,]+$/, '')
    .trim();
}

/** A feature of an epic's list: its name and the sentence that says what it does. */
export type PlannedFeature = { name: string; phrase: string };

export type LineState = 'built' | 'ready' | 'approved' | 'designing' | 'unstarted';

export type EpicLine = PlannedFeature & {
  /** The planned feature: its id and reserved code (its record's code once designed). */
  id: string;
  code: string;
  /** The feature record, once designed. */
  row: ProductRow | null;
  /** The active thread where it is being designed, if any. */
  thread: ExplorationSummary | null;
  state: LineState;
  /** Features it needs that are not built yet. */
  blockedBy: string[];
};

export type EpicPlan = {
  lines: EpicLine[];
  /** Features of the epic its list doesn't have (designed apart): the list can add them. */
  outside: ProductRow[];
  /** The first line not started, when the epic is approved: what "Design the next one" opens. */
  next: EpicLine | null;
  counts: Record<LineState, number>;
};

/** Purpose of the thread where a feature of an epic is designed: the explorer reads the code from it. */
export function featurePurpose(line: PlannedFeature & { code: string }, epicCode: string): string {
  return `Design "${line.name}" (${line.code}, ${epicCode})${line.phrase ? `: ${line.phrase}` : ''}`;
}

/** The name a thread's purpose cites between quotes (`Design "Name" (…)`), normalized. */
const citedName = (purpose: string): string | null => {
  const m = /"([^"]+)"/.exec(purpose);
  return m?.[1] ? normalizeName(m[1]) : null;
};

/** The planned features of an epic, in order. */
export function plannedOf(state: Pick<ProductState, 'planned'>, epicCode: string): PlannedFeatureRow[] {
  return (state.planned ?? []).filter((p) => p.epic_code === epicCode).sort((a, b) => a.position - b.position);
}

export function epicPlan(
  epic: ProductRow,
  planned: readonly PlannedFeatureRow[],
  features: readonly ProductRow[],
  rows: readonly ProductRow[],
  threads: readonly ExplorationSummary[],
): EpicPlan {
  const built = (code: string) => rows.find((r) => r.code === code)?.implementation === 'implemented';
  const lines = planned.map((p): EpicLine => {
    const row = rows.find((r) => r.code === p.code) ?? null;
    const thread =
      threads.find(
        (t) => t.state === 'active' && (t.purpose.includes(`(${p.code},`) || citedName(t.purpose) === normalizeName(p.name)),
      ) ?? null;
    const state: LineState =
      row?.implementation === 'implemented'
        ? 'built'
        : row?.readiness?.ready
          ? 'ready'
          : row && row.current !== null
            ? 'approved'
            : row || thread
              ? 'designing'
              : 'unstarted';
    return {
      id: p.id,
      code: p.code,
      name: row?.title ?? p.name,
      phrase: p.summary,
      row,
      thread,
      state,
      blockedBy: (row?.needs ?? []).filter((c) => !built(c)),
    };
  });
  const listed = new Set(planned.map((p) => p.code));
  const counts: Record<LineState, number> = { built: 0, ready: 0, approved: 0, designing: 0, unstarted: 0 };
  for (const l of lines) counts[l.state]++;
  return {
    lines,
    outside: features.filter((f) => !listed.has(f.code)),
    next: epic.current !== null ? (lines.find((l) => l.state === 'unstarted') ?? null) : null,
    counts,
  };
}

export type EpicStatus = 'not_started' | 'in_progress' | 'done';

/** Where the epic's delivery is: done once every listed feature is built; in progress once any is designed or being built. */
export function epicStatus(plan: EpicPlan): EpicStatus {
  if (plan.lines.length > 0 && plan.counts.built === plan.lines.length) return 'done';
  return plan.lines.some((l) => l.state !== 'unstarted') ? 'in_progress' : 'not_started';
}

/** The epic's own active thread: born from one of its versions, not a feature's; the latest. */
export function epicThread(
  threads: readonly ExplorationSummary[],
  versionIds: readonly (string | null)[],
): ExplorationSummary | undefined {
  return threads
    .filter(
      (t) =>
        t.state === 'active' &&
        t.origin_type === 'record_version' &&
        versionIds.includes(t.origin_id) &&
        !isFeatureThread(t.purpose),
    )
    .at(-1);
}

/**
 * The threads of an epic: born from any of its versions, hanging from those, or born from a
 * version of one of its features.
 */
export function epicThreads(
  threads: readonly ExplorationSummary[],
  epicVersionIds: readonly string[],
  features: readonly ProductRow[],
): ExplorationSummary[] {
  const featureVersions = new Set(features.flatMap((f) => [f.latest_id, f.current_id]).filter((x): x is string => !!x));
  const own = new Set(
    threads.filter((t) => t.origin_type === 'record_version' && epicVersionIds.includes(t.origin_id ?? '')).map((t) => t.id),
  );
  return threads.filter(
    (t) =>
      own.has(t.id) ||
      (t.parent_id !== null && own.has(t.parent_id)) ||
      (t.origin_type === 'record_version' && featureVersions.has(t.origin_id ?? '')),
  );
}

/** The active thread of a feature's epic, where asking about the feature hangs a new thread. */
export function featureEpicThread(state: ProductState, code: string): string | null {
  const rows = [...state.designs, ...state.decisions];
  const feature = rows.find((r) => r.code === code);
  const epic = feature ? epicOf(feature, rows.filter((r) => r.type === 'epic')) : undefined;
  return epic ? (epicThread(state.explorations, [epic.current_id, epic.latest_id])?.id ?? null) : null;
}
