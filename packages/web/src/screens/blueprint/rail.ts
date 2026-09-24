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
