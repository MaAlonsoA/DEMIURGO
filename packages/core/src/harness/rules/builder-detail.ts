// Small readers shared by the TDD and review rules (1.4): they read the JSON the build steps and reviews stored, in
// the shapes the orchestrator writes (and the older ones: a JSON string where a value is now an object).

import type { Row } from '../../db/schema.ts';
import type { PostmortemInputs } from '../postmortem.ts';

export type Json = Record<string, unknown>;

function parsed(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export const asObject = (value: unknown): Json => {
  const v = parsed(value);
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {};
};
export const asArray = (value: unknown): unknown[] => {
  const v = parsed(value);
  return Array.isArray(v) ? v : [];
};
export const detailOf = (s: { detail: unknown }): Json => asObject(s.detail);
export const numberOf = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
export const timeOf = (d: unknown): number => (d === null || d === undefined ? 0 : new Date(d as Date | string).getTime());

/** Input plus output tokens of a stored `usage` (same shape as `ai_runs.usage`), or null when it reported none. */
export function tokensOf(usage: unknown): number | null {
  const u = asObject(usage);
  const input = numberOf(u.inputTokens);
  const output = numberOf(u.outputTokens);
  return input === null && output === null ? null : (input ?? 0) + (output ?? 0);
}

export const normalPath = (path: string): string => path.replace(/^\.\//, '');

/** The files a `commit ok` step recorded (an array, or the older JSON string). */
export const commitFiles = (s: { detail: unknown }): string[] => asArray(detailOf(s).files).filter((f): f is string => typeof f === 'string').map(normalPath);

export const stepsOf = (inputs: PostmortemInputs, stage: string): Row<'build_steps'>[] => inputs.steps.filter((s) => s.stage === stage);

/** The attempt a stored review belongs to: its `review` step names the run; else the latest attempt begun before it. */
export function attemptOfReview(inputs: PostmortemInputs, review: Row<'pr_reviews'>): number {
  const step = inputs.steps.find((s) => s.stage === 'review' && detailOf(s).run_id === review.run_id);
  if (step) return step.attempt;
  const at = timeOf(review.created_at);
  return inputs.steps.reduce((n, s) => (timeOf(s.created_at) <= at ? Math.max(n, s.attempt) : n), 1);
}

/** The first CI result of an attempt that says something about the code: not cancelled, not a missing report. */
export function firstDecisiveCi(inputs: PostmortemInputs, attempt: number): { step: Row<'build_steps'>; green: boolean } | null {
  for (const s of inputs.steps) {
    if (s.attempt !== attempt || s.stage !== 'ci' || (s.outcome !== 'ok' && s.outcome !== 'failed')) continue;
    const d = detailOf(s);
    if (d.cancelled === true || d.conclusion === 'cancelled' || (s.outcome === 'failed' && d.conclusion == null)) continue;
    return { step: s, green: s.outcome === 'ok' };
  }
  return null;
}
