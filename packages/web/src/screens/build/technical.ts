// Technical tasks (enablers, SAFe: work that improves how the product is built, tested or run, not a user
// feature) rest on a decision, a quality requirement or the product definition instead of a feature. Pure.

import type { QueueTask } from '../../api/types.ts';

export type WorkKind = 'feature' | 'technical' | 'unbased';

/** Where a queued task belongs: under a feature, as technical work, or on nothing yet. */
export function workKind(task: Pick<QueueTask, 'feature' | 'technical'>): WorkKind {
  if (task.feature) return 'feature';
  return task.technical ? 'technical' : 'unbased';
}
