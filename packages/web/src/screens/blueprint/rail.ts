// Pure logic of the blueprint rail (canvas B2, left): the product's features with the status the
// person reads on the overview, its decisions and tech decisions with their marks, and the
// threads set aside. The record on screen is the current one.

import type { Inbox, ProductRow, ProductState } from '../../api/types.ts';
import { EPISTEMIC_MARK, type MarkKind } from '../../words.ts';
import { rowStage, type Waiting, waitingCount, waitingFor, waitingPhrase } from '../record/logic.ts';
import { RAIL, type RailWords } from './words.i18n.ts';

export type FeatureStatus =
  | { kind: 'needs'; word: string; count: number; detail: string }
  | { kind: 'ready'; word: string }
  | { kind: 'doubt'; word: string }
  | { kind: 'draft'; word: string }
  | { kind: 'not-ready'; word: string };

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

export type NavRecord = { code: string; title: string; current: boolean; mark: MarkKind; status?: FeatureStatus };
export type NavGroup = { key: string; title: string; records: NavRecord[] };
export type Navigator = { project: string; groups: NavGroup[]; parked: { id: string; purpose: string }[] };

/** The groups of the records navigator, in the order of the product: features first, bugs last. */
const NAV_GROUPS: { key: ProductRow['type']; titleKey: keyof RailWords }[] = [
  { key: 'fdr', titleKey: 'groupFeatures' },
  { key: 'decision', titleKey: 'groupDecisions' },
  { key: 'adr', titleKey: 'groupTech' },
  { key: 'requirement', titleKey: 'groupRequirements' },
  { key: 'quality_requirement', titleKey: 'groupQuality' },
  { key: 'threat_model', titleKey: 'groupThreatModels' },
  { key: 'production_readiness', titleKey: 'groupProductionReadiness' },
  { key: 'bug', titleKey: 'groupBugs' },
];

/**
 * Every record of the product grouped by type — bugs, requirements, quality, threat models and
 * production readiness included, which the old rail left out (INVENTORY INV-BP, UX problem) — the
 * features with their status and the rest with their certainty, and the threads set aside. Only
 * non-empty groups, except Features, which says when there is none.
 */
export function navigatorOf(
  state: ProductState | undefined,
  inbox: Inbox | undefined,
  current: string,
  words: RailWords = RAIL.en,
): Navigator {
  if (!state) return { project: '', groups: [], parked: [] };
  const rows = [...state.designs, ...state.decisions];
  const groups = NAV_GROUPS.map((g) => ({
    key: g.key,
    title: words[g.titleKey],
    records: rows
      .filter((r) => r.type === g.key)
      .map((r) => ({
        ...node(r, current),
        ...(r.type === 'fdr' ? { status: featureStatus(r, waitingFor(r.code, inbox, r.origin_exploration), words) } : {}),
      })),
  })).filter((g) => g.key === 'fdr' || g.records.length > 0);
  return {
    project: state.project.name,
    groups,
    parked: state.explorations.filter((e) => e.state === 'set_aside').map((e) => ({ id: e.id, purpose: e.purpose })),
  };
}
