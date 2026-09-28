import { DIMENSIONS } from './knowledge-inputs.ts';
import { DEFAULT_THRESHOLDS, type ChoiceResponse, type ItemChoice, type Thresholds } from './classifier.ts';

export type Effect = 'preserve' | 'relation' | 'conflict' | 'assumption' | 'duplicate' | 'review' | 'invalidate' | 'pending';
export type Task = 'change' | 'idea';
export const POLICY_VERSION = 'knowledge-policy-2-draft-1';

/** Errors are explicit and poison the affected batch; no fallback class is manufactured. */
export function validateResponses(
  items: readonly ItemChoice[],
  responses: readonly ChoiceResponse[],
): { valid: ChoiceResponse[]; errors: string[] } {
  const errors: string[] = [];
  const known = new Map(items.map((i) => [i.id, i]));
  if (known.size !== items.length) errors.push('Duplicate input IDs.');
  for (const r of responses) if (!known.has(r?.id)) errors.push(`Unexpected response: ${r?.id}.`);
  const valid: ChoiceResponse[] = [];
  for (const item of items) {
    const found = responses.filter((r) => r?.id === item.id);
    if (found.length !== 1) {
      errors.push(`${item.id}: expected one response, got ${found.length}.`);
      continue;
    }
    const r = found[0]!;
    if (
      !item.options.includes(r.choice) ||
      !Number.isFinite(r.confidence) ||
      r.confidence < 0 ||
      r.confidence > 1 ||
      typeof r.justification !== 'string'
    ) {
      errors.push(`${item.id}: invalid response.`);
      continue;
    }
    valid.push(r);
  }
  return { valid, errors };
}
export type Dimensions = { relation: string; compatibility: string; action?: string };
export function separatedEffects(
  task: Task,
  d: Dimensions,
  confidence: number,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): { effects: Effect[]; invalid: boolean } {
  const unknown =
    !Object.hasOwn(DIMENSIONS.relation, d.relation) ||
    !Object.hasOwn(DIMENSIONS.compatibility, d.compatibility) ||
    (task === 'change' && !Object.hasOwn(DIMENSIONS.action, d.action ?? ''));
  if (unknown) return { effects: ['pending'], invalid: true };
  const contradiction =
    (d.relation === 'unrelated' &&
      ((d.compatibility !== 'compatible' && d.compatibility !== 'insufficient_context') ||
        (d.action && !['none', 'insufficient_context'].includes(d.action)))) ||
    (d.relation === 'equivalent' && (d.compatibility !== 'compatible' || (d.action && d.action !== 'none'))) ||
    (task === 'idea' && d.action !== undefined) ||
    (d.compatibility === 'direct_conflict' && (d.action === 'extend' || d.action === 'none'));
  if (contradiction) return { effects: ['pending'], invalid: true };
  if (Object.values(d).includes('insufficient_context') || !Number.isFinite(confidence) || confidence < thresholds.high)
    return { effects: ['pending'], invalid: false };
  const effects: Effect[] = [];
  if (d.compatibility === 'direct_conflict') effects.push('conflict');
  if (d.compatibility === 'assumption_mismatch') effects.push('assumption');
  if (task === 'change' && d.action !== 'none') effects.push('review');
  if (task === 'idea' && d.relation === 'equivalent') effects.push('duplicate');
  if (!effects.length && d.relation === 'related') effects.push('relation');
  return { effects: effects.length ? effects : ['preserve'], invalid: false };
}
