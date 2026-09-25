// What the Activity page says about the runs as a whole (DESIGN.md §3.4, INV-ACT-01/03): the
// header line, the counts per state of the filter, and whether the server's 500-run limit was hit.
// Pure: the failed count is the sidebar's (D-011), so both say the same number.

import type { RunListItem } from '../../api/types.ts';
import { isActive, unresolvedFailures } from '../../components/runState.tsx';
import { RUN_STATES } from '../run/runs.ts';

/** The server returns at most this many runs, newest first. */
export const RUNS_LIMIT = 500;

export type RunState = (typeof RUN_STATES)[number];

export const isRunState = (s: string | undefined): s is RunState => !!s && (RUN_STATES as readonly string[]).includes(s);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "12 runs of DEMIURGO · 2 working · 1 failed (not retried)", or what the page is for when empty. */
export function activityLine(runs: readonly RunListItem[], now: number): string {
  if (runs.length === 0) return 'What DEMIURGO did and is doing, run by run.';
  const working = runs.filter((r) => isActive(r.state)).length;
  const failed = unresolvedFailures(runs, now).length;
  return [
    `${plural(runs.length, 'run', 'runs')} of DEMIURGO`,
    working > 0 ? `${working} working` : null,
    failed > 0 ? `${failed} failed (not retried)` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** How many runs are in each state (the filter's counts, from the unfiltered list). */
export function countsByState(runs: readonly RunListItem[]): Record<RunState, number> {
  const counts = Object.fromEntries(RUN_STATES.map((s) => [s, 0])) as Record<RunState, number>;
  for (const r of runs) if (isRunState(r.state)) counts[r.state] += 1;
  return counts;
}

/** The empty state of a filtered list: "No cancelled runs." */
export function emptyFilterWords(word: string): string {
  return `No ${word.toLowerCase()} runs.`;
}
