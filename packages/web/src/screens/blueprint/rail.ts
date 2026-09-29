// Pure logic of the blueprint rail (canvas B2, left): the product's features with the status the
// person reads on the overview, its decisions and tech decisions with their marks, and the
// threads set aside. The record on screen is the current one.

import type { Inbox, ProductRow, ProductState } from '../../api/types.ts';
import { recordsByAspect } from '../../aspects.ts';
import { EPISTEMIC_MARK, type MarkKind } from '../../words.ts';
import { epicGroups, epicPlan, plannedOf } from '../epics/logic.ts';
import { rowStage, type Waiting, waitingCount, waitingFor, waitingPhrase } from '../record/logic.ts';
import { RAIL, type RailWords } from './words.i18n.ts';

export type FeatureStatus =
  | { kind: 'needs'; word: string; count: number; detail: string }
  | { kind: 'ready'; word: string }
  | { kind: 'doubt'; word: string }
  | { kind: 'draft'; word: string }
  | { kind: 'not-ready'; word: string }
  /** A feature of an epic's list not designed yet. */
  | { kind: 'planned'; word: string };

/**
 * One word for a feature: what waits for the person comes first (the blue count), then how far it
 * is (the first bar: ready, in doubt), then whether it is still a draft.
 */
export function featureStatus(row: ProductRow, waiting: Waiting, words: RailWords = RAIL.en): FeatureStatus {
  const count = waitingCount(waiting);
  if (count > 0) return { kind: 'needs', word: words.needsYou, count, detail: waitingPhrase(waiting) };
  const stage = rowStage(row);
  if (stage === 'ready') return { kind: 'ready', word: words.readyToBuild };
  if (stage === 'doubt') return { kind: 'doubt', word: words.inDoubt };
  if (row.latest.state === 'draft') return { kind: 'draft', word: words.draft };
  return { kind: 'not-ready', word: words.notReady };
}

export type RailFeature = { code: string; title: string; current: boolean; status: FeatureStatus };
export type RailNode = { code: string; title: string; current: boolean; mark: MarkKind };
export type Rail = {
  project: string;
  features: RailFeature[];
  decisions: RailNode[];
  tech: RailNode[];
  parked: { id: string; purpose: string }[];
};

const node = (row: ProductRow, current: string): RailNode => ({
  code: row.code,
  title: row.title,
  current: row.code === current,
  mark: EPISTEMIC_MARK[row.epistemic_status] ?? 'unknown',
});

export function railOf(
  state: ProductState | undefined,
  inbox: Inbox | undefined,
  current: string,
  words: RailWords = RAIL.en,
): Rail {
  if (!state) return { project: '', features: [], decisions: [], tech: [], parked: [] };
  return {
    project: state.project.name,
    features: state.designs
      .filter((r) => r.type === 'fdr')
      .map((r) => ({
        code: r.code,
        title: r.title,
        current: r.code === current,
        status: featureStatus(r, waitingFor(r.code, inbox, r.origin_exploration), words),
      })),
    decisions: state.decisions.map((r) => node(r, current)),
    tech: state.designs.filter((r) => r.type === 'adr').map((r) => node(r, current)),
    parked: state.explorations.filter((e) => e.state === 'set_aside').map((e) => ({ id: e.id, purpose: e.purpose })),
  };
}

export type NavRecord = {
  code: string;
  title: string;
  current: boolean;
  mark: MarkKind;
  status?: FeatureStatus;
  /** A feature listed under its epic, or a task under its feature. */
  nested?: boolean;
  /** A task of a feature that is itself under its epic. */
  deeper?: boolean;
};
export type NavGroup = { key: string; title: string; records: NavRecord[] };
export type Navigator = { project: string; groups: NavGroup[]; parked: { id: string; purpose: string }[] };

/**
 * Every record of the product: the product definition first, then one group per aspect in the fixed
 * order (Product, Epic, Feature, Quality, Architecture, Security, Operations, Other) and those
 * without a tag last — each epic with its features under it, the features with their status and the
 * rest with their certainty — and the threads set aside. Only non-empty groups, except Feature,
 * which says when there is none while there is no epic either.
 */
export function navigatorOf(
  state: ProductState | undefined,
  inbox: Inbox | undefined,
  current: string,
  words: RailWords = RAIL.en,
): Navigator {
  if (!state) return { project: '', groups: [], parked: [] };
  const rows = [...state.designs, ...state.decisions];
  const toNav = (r: ProductRow): NavRecord => ({
    ...node(r, current),
    ...(r.type === 'fdr' ? { status: featureStatus(r, waitingFor(r.code, inbox, r.origin_exploration), words) } : {}),
  });
  const definition = rows.filter((r) => r.type === 'product_definition');
  const epics = epicGroups(rows).groups;
  const inEpic = new Set(epics.flatMap((g) => g.features.map((f) => f.code)));
  // A task goes under its feature (the feature under its epic): never on its own while its feature is there.
  const features = new Set(rows.filter((r) => r.type === 'fdr').map((r) => r.code));
  const underFeature = (r: ProductRow) => r.type === 'task' && !!r.based_on && features.has(r.based_on);
  const tasksOf = (code: string, deeper: boolean): NavRecord[] =>
    rows
      .filter((t) => t.type === 'task' && t.based_on === code)
      .sort((a, b) => a.code.localeCompare(b.code))
      .map((t) => ({ ...toNav(t), nested: true, ...(deeper ? { deeper: true } : {}) }));
  const byAspect = recordsByAspect(
    rows.filter((r) => r.type !== 'product_definition' && !inEpic.has(r.code) && !underFeature(r)),
  );
  if (!byAspect.some((g) => g.key === 'epic' || g.key === 'feature')) {
    const at = byAspect.findIndex((g) => g.key !== 'product');
    byAspect.splice(at < 0 ? byAspect.length : at, 0, { key: 'feature', aspect: 'feature', rows: [] });
  }
  // An epic, then its list in order (a feature not designed yet has its own page too), then the features
  // that rest on it outside its list.
  const navOf = (r: ProductRow): NavRecord[] => {
    const group = r.type === 'epic' ? epics.find((g) => g.epic.code === r.code) : undefined;
    if (!group) return r.type === 'fdr' ? [toNav(r), ...tasksOf(r.code, false)] : [toNav(r)];
    const plan = epicPlan(r, plannedOf(state, r.code), group.features, rows, state.explorations);
    return [
      toNav(r),
      ...plan.lines.flatMap((l): NavRecord[] =>
        l.row
          ? [{ ...toNav(l.row), nested: true }, ...tasksOf(l.row.code, true)]
          : [
              {
                code: l.code,
                title: l.name,
                current: l.code === current,
                mark: 'open',
                status: { kind: 'planned', word: words.planned },
                nested: true,
              },
            ],
      ),
      ...plan.outside.flatMap((f) => [{ ...toNav(f), nested: true }, ...tasksOf(f.code, true)]),
    ];
  };
  const groups: NavGroup[] = [
    ...(definition.length > 0
      ? [{ key: 'product_definition', title: words.groupDefinition, records: definition.map(toNav) }]
      : []),
    ...byAspect.map((g) => ({
      key: g.key,
      title: g.aspect ? words.groupAspect(g.aspect) : words.groupNone,
      records: g.rows.flatMap(navOf),
    })),
  ];
  return {
    project: state.project.name,
    groups,
    parked: state.explorations.filter((e) => e.state === 'set_aside').map((e) => ({ id: e.id, purpose: e.purpose })),
  };
}
