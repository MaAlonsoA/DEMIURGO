// Task effort size (FDR-DEL-006): a relative estimate, never a duration. Ordered XS < S < M < L < XL,
// worth 1, 2, 3, 5 and 8 points. A task created from now on has exactly one; a task from before has
// none ("No size") until a person sets it, and no points are invented for it.

import { z } from 'zod';

export const TASK_SIZES = ['XS', 'S', 'M', 'L', 'XL'] as const;
export type TaskSize = (typeof TASK_SIZES)[number];
export const taskSizeSchema = z.enum(TASK_SIZES);

export const SIZE_POINTS: Readonly<Record<TaskSize, number>> = { XS: 1, S: 2, M: 3, L: 5, XL: 8 };

/** What a size means, for Jev's ordered levels and the explorer. */
export const SIZE_DESCRIPTIONS: Readonly<Record<TaskSize, string>> = {
  XS: 'trivial: a one-line or configuration change',
  S: 'small: one function or one small screen change',
  M: 'medium: touches one screen and one command, or a few files',
  L: 'large: several modules, a migration or a new screen',
  XL: 'very large: many modules and layers; better split into smaller tasks',
};

export const isTaskSize = (v: unknown): v is TaskSize => typeof v === 'string' && (TASK_SIZES as readonly string[]).includes(v);

/** Positions between two sizes on the ordered scale. */
export const sizeDistance = (a: TaskSize, b: TaskSize): number => Math.abs(TASK_SIZES.indexOf(a) - TASK_SIZES.indexOf(b));

/** A second opinion disputes the size when it is two or more positions away. */
export const DISPUTE_DISTANCE = 2;

export type SizeDispute = 'none' | 'disputed' | 'dismissed';

/** The dispute state of a task: none without size or opinion, dismissed when the person kept this opinion's size. */
export function sizeDisputeOf(size: TaskSize | null, opinion: TaskSize | null, dismissed: boolean): SizeDispute {
  if (!size || !opinion || sizeDistance(size, opinion) < DISPUTE_DISTANCE) return 'none';
  return dismissed ? 'dismissed' : 'disputed';
}

/** The build brief's size line: "Size: M (3 points)", or "Size: No size" for a legacy task (no number). */
export function sizeLine(size: TaskSize | null): string {
  return size ? `Size: ${size} (${SIZE_POINTS[size]} points)` : 'Size: No size';
}

export type SizedTask = { size: TaskSize | null; built: boolean; dropped?: boolean };

/** A feature's effort: tasks per size (XS–XL order), total points and points not built yet. Dropped and unsized tasks add nothing. */
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
