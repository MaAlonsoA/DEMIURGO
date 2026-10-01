// How long a kind of run usually takes, from the durations of its last completed runs. Pure.
// Percentiles use the nearest-rank method (the smallest value with at least p % of the sample at or
// below it); the window of 20 runs and the 50 % margin applied by the UI are our convention.

export type TypicalDuration = {
  /** Median duration in seconds. */
  median_s: number;
  /** 80th percentile in seconds. */
  p80_s: number;
  /** How many completed runs the figures come from. */
  n: number;
};

/** How many of the latest completed runs of an action count (convention nuestra). */
export const TYPICAL_WINDOW = 20;

function nearestRank(sorted: readonly number[], p: number): number {
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[Math.min(sorted.length, rank) - 1]!;
}

/** Median and p80 of durations in seconds; null with no usable duration. Negatives and NaN are ignored. */
export function typicalDuration(durationsS: readonly number[]): TypicalDuration | null {
  const sorted = durationsS.filter((d) => Number.isFinite(d) && d >= 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = sorted.length / 2;
  const median = sorted.length % 2 === 1 ? sorted[Math.floor(mid)]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return { median_s: Math.round(median), p80_s: Math.round(nearestRank(sorted, 80)), n: sorted.length };
}
