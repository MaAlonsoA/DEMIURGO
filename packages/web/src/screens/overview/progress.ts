// The overview closer to the product blueprint (canvas B1, S6A and S6C): where each feature is
// (working, ready to build, needs you), the progress line under the title, what was decided most
// recently and what DEMIURGO is doing now. Pure part, from the product state and the runs.

import type { ProductRow, RunListItem } from '../../api/types.ts';

export const WORKING_STATES = ['queued', 'running'];

export type FeatureStatus = { kind: 'working'; run: RunListItem } | { kind: 'ready' } | { kind: 'needs' } | null;

export function workingRuns(runs: readonly RunListItem[]): RunListItem[] {
  return runs.filter((r) => WORKING_STATES.includes(r.state));
}

/** Runs drafting a new feature (design_proposal): the feature does not exist until its package is accepted. */
export function draftingRuns(runs: readonly RunListItem[]): RunListItem[] {
  return workingRuns(runs).filter((r) => r.action === 'design_proposal');
}

/**
 * One status per feature, the most telling first: DEMIURGO works in its thread, it is ready to build,
 * or something of it waits for the person. A draft run makes a new feature: it is not work on this one.
 */
export function featureStatus(row: ProductRow, waiting: number, runs: readonly RunListItem[]): FeatureStatus {
  const run = row.origin_exploration
    ? workingRuns(runs).find((r) => r.exploration_id === row.origin_exploration && r.action !== 'design_proposal')
    : undefined;
  if (run) return { kind: 'working', run };
  if (row.readiness?.ready) return { kind: 'ready' };
  if (waiting > 0) return { kind: 'needs' };
  return null;
}

export type Progress = { total: number; ready: number; needs: number; working: number };

/**
 * The progress line: how many features are ready to build (their readiness says so), and of the
 * rest how many are in progress or need the person. Features being drafted count as in progress.
 */
export function productProgress(
  rows: readonly ProductRow[],
  waitingOf: (code: string) => number,
  runs: readonly RunListItem[],
  drafting: number,
): Progress {
  const features = rows.filter((r) => r.type === 'fdr');
  const p: Progress = { total: features.length, ready: 0, needs: 0, working: drafting };
  for (const f of features) {
    const s = featureStatus(f, waitingOf(f.code), runs);
    if (f.readiness?.ready) p.ready += 1;
    else if (s?.kind === 'working') p.working += 1;
    else if (s?.kind === 'needs') p.needs += 1;
  }
  return p;
}

/** What a person decided most recently: records whose latest version is approved, newest first. */
export function recentlyDecided(rows: readonly ProductRow[], limit = 4): ProductRow[] {
  return rows
    .filter((r) => r.latest.state === 'approved')
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, limit);
}
