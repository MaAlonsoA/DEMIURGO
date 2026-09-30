// Task effort size (FDR-DEL-006), as the pages show it. Same scale as the domain's (domain/sizes.ts):
// ordered XS < S < M < L < XL, worth 1, 2, 3, 5, 8 points; a legacy task without size is "No size".

import type { TaskSize } from './api/types.ts';

export const TASK_SIZES: readonly TaskSize[] = ['XS', 'S', 'M', 'L', 'XL'];
export const SIZE_POINTS: Readonly<Record<TaskSize, number>> = { XS: 1, S: 2, M: 3, L: 5, XL: 8 };

/** The build brief's size line: "Size: M (3 points)", or "Size: No size" with no number for a legacy task. */
export function sizeLine(size: TaskSize | null | undefined): string {
  return size ? `Size: ${size} (${SIZE_POINTS[size]} points)` : 'Size: No size';
}

export type SizedTask = { size: TaskSize | null; built: boolean; dropped?: boolean };

/** A feature's effort: "2 S · 1 M · 1 L", total points and points not built yet; dropped and unsized tasks add nothing. */
export function effortTotals(tasks: readonly SizedTask[]) {
  const counts: Record<TaskSize, number> = { XS: 0, S: 0, M: 0, L: 0, XL: 0 };
  let total = 0;
  let remaining = 0;
  let unsized = 0;
  for (const t of tasks) {
    if (t.dropped) continue;
    if (!t.size) {
      unsized += 1;
      continue;
    }
    counts[t.size] += 1;
    total += SIZE_POINTS[t.size];
    if (!t.built) remaining += SIZE_POINTS[t.size];
  }
  const summary = TASK_SIZES.filter((s) => counts[s] > 0)
    .map((s) => `${counts[s]} ${s}`)
    .join(' · ');
  return { counts, total, remaining, unsized, summary };
}
