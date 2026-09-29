// An epic and its features (spec «Entrega por épicas», 1c). A feature belongs to the epic it is
// based on; without that link, to the epic of its domain. The epic's "Features" section is the plan:
// each line "Name: phrase" is matched to a feature by title, and gets the state of its delivery.

import type { ExplorationSummary, ProductRow, ProductState } from '../../api/types.ts';
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
  const epics = rows.filter((r) => r.type === 'epic');
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

export type PlannedFeature = { name: string; phrase: string };

/** The lines of an epic's "Features" section: "Name: phrase" (or "Name — phrase"), list marks off. */
export function plannedFeatures(content: string): PlannedFeature[] {
  const out: PlannedFeature[] = [];
  for (const raw of content.split('\n')) {
    const line = raw
      .trim()
      .replace(/^(?:[-*+]|\d+[.)])\s+/, '')
      .replace(/\*\*/g, '')
      .trim();
    if (line === '') continue;
    const m = /^(.+?)\s*(?::|\s—\s|\s–\s|\s-\s)\s*(.+)$/.exec(line);
    const name = (m?.[1] ?? line).trim();
    if (name.length > 120) continue;
    out.push({ name, phrase: (m?.[2] ?? '').trim() });
  }
  return out;
}

/** The "Features" section of a version's sections, or empty. */
export function featuresSection(sections: readonly { title: string; content: string }[]): string {
  return sections.find((s) => normalizeName(s.title) === 'features')?.content ?? '';
}

export type LineState = 'built' | 'ready' | 'approved' | 'designing' | 'unstarted';

export type EpicLine = PlannedFeature & {
  /** The feature record the line names, if designed. */
  row: ProductRow | null;
  /** The active thread where it is being designed, if any. */
  thread: ExplorationSummary | null;
  state: LineState;
  /** Features it needs that are not built yet. */
  blockedBy: string[];
};

export type EpicPlan = {
  lines: EpicLine[];
  /** Features of the epic that no line names: the epic needs a new version that does. */
  outside: ProductRow[];
  /** The first line not started, when the epic is approved: what "Design the next one" opens. */
  next: EpicLine | null;
  counts: Record<LineState, number>;
};

/** Purpose of the thread where a feature of an epic is designed. */
export function featurePurpose(line: PlannedFeature, epicCode: string): string {
  return `Design "${line.name}" (${epicCode})${line.phrase ? `: ${line.phrase}` : ''}`;
}


/** The name a thread's purpose cites between quotes (`Design "Name" (EPC-…)`), normalized. */
const citedName = (purpose: string): string | null => {
  const m = /"([^"]+)"/.exec(purpose);
  return m?.[1] ? normalizeName(m[1]) : null;
};

const matches = (title: string, name: string): boolean => {
  const t = normalizeName(title);
  const n = normalizeName(name);
  return n !== '' && (t === n || t.startsWith(n));
};

export function epicPlan(
  epic: ProductRow,
  section: string,
  features: readonly ProductRow[],
  rows: readonly ProductRow[],
  threads: readonly ExplorationSummary[],
): EpicPlan {
  const used = new Set<string>();
  const built = (code: string) => rows.find((r) => r.code === code)?.implementation === 'implemented';
  const lines = plannedFeatures(section).map((p): EpicLine => {
    const row = features.find((f) => !used.has(f.code) && matches(f.title, p.name)) ?? null;
    if (row) used.add(row.code);
    const thread = threads.find((t) => t.state === 'active' && citedName(t.purpose) === normalizeName(p.name)) ?? null;
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
    return { ...p, row, thread, state, blockedBy: (row?.needs ?? []).filter((c) => !built(c)) };
  });
  const counts: Record<LineState, number> = { built: 0, ready: 0, approved: 0, designing: 0, unstarted: 0 };
  for (const l of lines) counts[l.state]++;
  return {
    lines,
    outside: features.filter((f) => !used.has(f.code)),
    next: epic.current !== null ? (lines.find((l) => l.state === 'unstarted') ?? null) : null,
    counts,
  };
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
