// A knowledge conflict in plain words (pure, so the list, the detail and the tests say the same
// thing): which record is the one to review (A) and which approved change triggered it (B), the two
// exact sentences, which side is older, and the build state of a task.

import type { ProductRow, TaskBuildState } from '../../api/types.ts';
import { rowOfVersion } from '../batch/model.ts';

export type ConflictReview = {
  record?: { code?: string; version?: number };
  change?: { id?: string; version?: number | null };
  verdict?: string;
  reason?: string;
  confidence?: number;
  other?: { code?: string; version?: number };
  quotes?: { record?: string; other?: string };
  epic?: string;
};

/**
 * The two statements a conflict verdict quotes, as `Change: "…" Candidate: "…"`. The same reading as
 * quotesOf in packages/domain/src/knowledge.ts, which the web cannot import (it pulls in node:crypto).
 */
export function quotesOf(justification: string): { change: string; candidate: string } | null {
  const pick = (label: string) =>
    new RegExp(`${label}\\s*:\\s*["“«]([^"”»]{8,})["”»]`, 'i').exec(justification)?.[1]?.trim() ?? null;
  const change = pick('Change');
  const candidate = pick('Candidate');
  return change && candidate ? { change, candidate } : null;
}

/** The sentence of each side: A is the record to review, B the change (or the other record of a coherence finding). */
export function sentencesOf(review: ConflictReview): { a: string | null; b: string | null } {
  if (review.quotes) return { a: review.quotes.record ?? null, b: review.quotes.other ?? null };
  const q = quotesOf(review.reason ?? '');
  return q ? { a: q.candidate, b: q.change } : { a: null, b: null };
}

/** Whole percentage the knowledge engine gives; null for a coherence finding (it has no real probability). */
export function surenessOf(review: ConflictReview): number | null {
  if (review.quotes || typeof review.confidence !== 'number') return null;
  return Math.round(review.confidence * 100);
}

export type Side = { code: string; when: string | null };

/** The two sides, older first. Unknown or equal times keep the record to review first. */
export function olderFirst<T extends { when: string | null }>(a: T, b: T): [T, T] {
  const ta = a.when ? Date.parse(a.when) : NaN;
  const tb = b.when ? Date.parse(b.when) : NaN;
  return !Number.isNaN(ta) && !Number.isNaN(tb) && tb < ta ? [b, a] : [a, b];
}

/** The number of a pull request from its URL (".../pull/30"), or null. */
export function prNumberOf(url: string | null | undefined): number | null {
  const m = /\/pull\/(\d+)/.exec(url ?? '');
  return m?.[1] ? Number(m[1]) : null;
}

/** The build state worth saying next to a task: merged or open pull request; nothing for the rest. */
export function buildFact(
  state: TaskBuildState | undefined,
  prUrl: string | null | undefined,
): { kind: 'merged' | 'open'; pr: number | null } | null {
  if (state === 'merged') return { kind: 'merged', pr: prNumberOf(prUrl) };
  if (state === 'in_pr') return { kind: 'open', pr: prNumberOf(prUrl) };
  return null;
}

/** "contradiction" (the default) or "duplicate": what the finding says about the two records. */
export function conflictNature(review: ConflictReview): 'different' | 'same' {
  return review.verdict === 'duplicate' ? 'same' : 'different';
}

/** Code of the approved change (B) that triggered the finding, if the product still has it. */
export function changeCodeOf(review: ConflictReview, rows: readonly ProductRow[]): string | null {
  if (review.other?.code) return review.other.code;
  return (review.change?.id ? rowOfVersion(rows, review.change.id)?.code : undefined) ?? null;
}
