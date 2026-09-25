// Pure logic of the blueprint rail (canvas B2, left): the product's features with the status the
// person reads on the overview, its decisions and tech decisions with their marks, and the
// threads set aside. The record on screen is the current one.

import type { Inbox, ProductRow, ProductState } from '../../api/types.ts';
import { EPISTEMIC_MARK, type MarkKind } from '../../words.ts';
import { rowStage, type Waiting, waitingCount, waitingFor, waitingPhrase } from '../record/logic.ts';

export type FeatureStatus =
  | { kind: 'needs'; word: 'Needs you'; count: number; detail: string }
  | { kind: 'ready'; word: 'Ready to build' }
  | { kind: 'doubt'; word: 'In doubt' }
  | { kind: 'draft'; word: 'Draft' }
  | { kind: 'not-ready'; word: 'Not ready' };

/**
 * One word for a feature: what waits for the person comes first (the blue count), then how far it
 * is (the first bar: ready, in doubt), then whether it is still a draft.
 */
export function featureStatus(row: ProductRow, waiting: Waiting): FeatureStatus {
  const count = waitingCount(waiting);
  if (count > 0) return { kind: 'needs', word: 'Needs you', count, detail: waitingPhrase(waiting) };
  const stage = rowStage(row);
  if (stage === 'ready') return { kind: 'ready', word: 'Ready to build' };
  if (stage === 'doubt') return { kind: 'doubt', word: 'In doubt' };
  if (row.latest.state === 'draft') return { kind: 'draft', word: 'Draft' };
  return { kind: 'not-ready', word: 'Not ready' };
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

export function railOf(state: ProductState | undefined, inbox: Inbox | undefined, current: string): Rail {
  if (!state) return { project: '', features: [], decisions: [], tech: [], parked: [] };
  return {
    project: state.project.name,
    features: state.designs
      .filter((r) => r.type === 'fdr')
      .map((r) => ({
        code: r.code,
        title: r.title,
        current: r.code === current,
        status: featureStatus(r, waitingFor(r.code, inbox, r.origin_exploration)),
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
const NAV_GROUPS: { key: ProductRow['type']; title: string }[] = [
  { key: 'fdr', title: 'Features' },
  { key: 'decision', title: 'Decisions' },
  { key: 'adr', title: 'Tech decisions' },
  { key: 'requirement', title: 'Requirements' },
  { key: 'quality_requirement', title: 'Quality requirements' },
  { key: 'threat_model', title: 'Threat models' },
  { key: 'production_readiness', title: 'Production readiness' },
  { key: 'bug', title: 'Bugs' },
];

/**
 * Every record of the product grouped by type — bugs, requirements, quality, threat models and
 * production readiness included, which the old rail left out (INVENTORY INV-BP, UX problem) — the
 * features with their status and the rest with their certainty, and the threads set aside. Only
 * non-empty groups, except Features, which says when there is none.
 */
export function navigatorOf(state: ProductState | undefined, inbox: Inbox | undefined, current: string): Navigator {
  if (!state) return { project: '', groups: [], parked: [] };
  const rows = [...state.designs, ...state.decisions];
  const groups = NAV_GROUPS.map((g) => ({
    key: g.key,
    title: g.title,
    records: rows
      .filter((r) => r.type === g.key)
      .map((r) => ({
        ...node(r, current),
        ...(r.type === 'fdr' ? { status: featureStatus(r, waitingFor(r.code, inbox, r.origin_exploration)) } : {}),
      })),
  })).filter((g) => g.key === 'fdr' || g.records.length > 0);
  return {
    project: state.project.name,
    groups,
    parked: state.explorations.filter((e) => e.state === 'set_aside').map((e) => ({ id: e.id, purpose: e.purpose })),
  };
}
