// Reviewer rules (salud-del-harness §3.1 B16 and B17, §7.4, Annex B): did the comments change code, did the builder
// repeat what it was told, what escaped to main, did the LGTM waiver hold, and what each review cost. Pure functions
// over `pr_reviews`, the build steps and the optional `issues` / `reviewRuns` inputs.
// Practice: Sadowski et al., «Lessons from Building Static Analysis Tools at Google» (CACM 2018): measure which
// findings developers act on and retire those that do not; Google eng-practices («Speed of Code Reviews») for the
// «LGTM with comments» waiver. The trigram threshold 0.6 is our convention.

import type { Row } from '../../db/schema.ts';
import type { PostmortemInputs } from '../postmortem.ts';
import { type Json, asArray, asObject, attemptOfReview, commitFiles, detailOf, normalPath, numberOf, stepsOf, timeOf, tokensOf } from './builder-detail.ts';
import type { Finding, Rule } from './index.ts';

export const REPEAT_SIMILARITY = 0.6;

type Comment = { index: number; path: string; line: number | null; severity: string; body: string; needsPerson: boolean };

const commentsOf = (review: Row<'pr_reviews'>): Comment[] =>
  asArray(review.comments).map((raw, index) => {
    const c = asObject(raw);
    return { index, path: typeof c.path === 'string' ? normalPath(c.path) : '', line: numberOf(c.line), severity: String(c.severity ?? ''), body: typeof c.body === 'string' ? c.body : '', needsPerson: c.needs_person === true };
  });

const orderedReviews = (inputs: PostmortemInputs): Row<'pr_reviews'>[] => [...inputs.reviews].sort((a, b) => timeOf(a.created_at) - timeOf(b.created_at));

/** Trigrams as pg_trgm builds them: lowercase, words made of letters and digits, padded with two spaces before and one after. */
export function trigrams(text: string): Set<string> {
  const set = new Set<string>();
  for (const word of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i++) set.add(padded.slice(i, i + 3));
  }
  return set;
}

/** Jaccard similarity of the trigram sets (what pg_trgm's `similarity` computes), without the extension. */
export function trigramSimilarity(a: string, b: string): number {
  const x = trigrams(a);
  const y = trigrams(b);
  if (x.size === 0 && y.size === 0) return 0;
  let shared = 0;
  for (const t of x) if (y.has(t)) shared++;
  return shared / (x.size + y.size - shared);
}

/** G04: did a builder commit after the review touch the comment's path? G03 and G10 below read main and the issues. */
export const reviewFindingOutcome: Rule = (inputs) => {
  const out: Finding[] = [];
  const reviews = orderedReviews(inputs);
  const commits = stepsOf(inputs, 'commit').filter((s) => s.outcome === 'ok');
  reviews.forEach((review, i) => {
    const attempt = attemptOfReview(inputs, review);
    const later = reviews.slice(i + 1);
    const approvedLater = later.some((r) => r.verdict === 'approve') || (inputs.request.state === 'done' && later.length > 0);
    for (const c of commentsOf(review)) {
      if (c.severity !== 'blocking' && c.severity !== 'fix' && c.severity !== 'nit') continue;
      const base = { piece: 'B17', finding: 'review.finding_outcome', attempt, subject: c.path || null } as const;
      const ref = { pr_review: review.id, comment_index: c.index, severity: c.severity };
      if (c.severity === 'nit') {
        // A nit is never a costly false positive (Annex B): it is noted, not counted.
        out.push({ ...base, class: 'info', value: null, unit: null, evidence: ref });
        continue;
      }
      const touching = commits.find((s) => timeOf(s.created_at) > timeOf(review.created_at) && commitFiles(s).includes(c.path));
      if (touching && c.path) out.push({ ...base, class: 'tp', ground_truth: 'G04', value: 1, unit: 'person_actions', evidence: { ...ref, commit_step: touching.id } });
      else if (approvedLater) out.push({ ...base, class: 'fp', ground_truth: c.needsPerson ? 'G08' : 'G04', value: 1, unit: 'person_actions', evidence: { ...ref, needs_person: c.needsPerson } });
      else out.push({ ...base, class: 'info', ground_truth: 'G04', value: null, unit: null, evidence: { ...ref, unresolved: true } });
    }
  });
  return out;
};

/** B10 and B17: a blocking comment of one round that says the same, on the same path, as one of the round before. */
export const reviewRepeat: Rule = (inputs) => {
  const out: Finding[] = [];
  const reviews = orderedReviews(inputs).filter((r) => commentsOf(r).some((c) => c.severity === 'blocking'));
  for (let i = 1; i < reviews.length; i++) {
    const previous = reviews[i - 1]!;
    const current = reviews[i]!;
    const earlier = commentsOf(previous).filter((c) => c.severity === 'blocking');
    for (const c of commentsOf(current).filter((x) => x.severity === 'blocking')) {
      let best: { comment: Comment; similarity: number } | null = null;
      for (const e of earlier) {
        if (e.path !== c.path) continue;
        const similarity = trigramSimilarity(e.body, c.body);
        if (similarity >= REPEAT_SIMILARITY && (!best || similarity > best.similarity)) best = { comment: e, similarity };
      }
      if (!best) continue;
      out.push({
        piece: 'B10',
        finding: 'review.repeat',
        class: 'fn',
        ground_truth: 'G04',
        value: Math.round(best.similarity * 100) / 100,
        unit: null,
        subject: c.path || null,
        attempt: attemptOfReview(inputs, current),
        evidence: { pr_review: current.id, comment_index: c.index, repeats: { pr_review: previous.id, comment_index: best.comment.index }, similarity: best.similarity },
      });
    }
  }
  return out;
};

type Escape = { kind: 'main_failed' | 'issue'; ref: Json; subject: string };

/** What went wrong after the merge: main red (G03) or an issue opened on the task after it merged (G10). */
function escapesOf(inputs: PostmortemInputs): Escape[] {
  const found: Escape[] = [];
  for (const s of stepsOf(inputs, 'main')) {
    const d = detailOf(s);
    if (s.outcome === 'failed' && d.superseded !== true) found.push({ kind: 'main_failed', ref: { build_step: s.id, sha: d.sha ?? null, conclusion: d.conclusion ?? null }, subject: 'main' });
  }
  const mergedAt = timeOf(inputs.request.done_at);
  for (const issue of inputs.issues ?? []) {
    if (issue.kind !== 'bug' || timeOf(issue.opened_at) <= mergedAt) continue;
    // A red main already counts as G03; the reviewer's own escalations are not escapes.
    if (issue.source_key?.startsWith('main_red:') || issue.source_key?.startsWith('flaky:')) continue;
    found.push({ kind: 'issue', ref: { issue: issue.id, code: issue.code }, subject: issue.code });
  }
  return found;
}

/** B17: a review approved what broke main or opened an issue (FN of the reviewer). Only for a merged request. */
export const reviewEscape: Rule = (inputs) => {
  if (inputs.request.state !== 'done') return [];
  const approval = orderedReviews(inputs).filter((r) => r.verdict === 'approve').at(-1);
  if (!approval) return [];
  const attempt = attemptOfReview(inputs, approval);
  const escapes = escapesOf(inputs);
  if (escapes.length === 0) {
    // No escape counts as a TN only once main was seen green: absence of data is not absence of defects.
    const seen = stepsOf(inputs, 'main').some((s) => s.outcome === 'ok');
    return seen ? [{ piece: 'B17', finding: 'review.escape', class: 'tn', ground_truth: 'G03', value: 1, unit: null, subject: inputs.taskCode, attempt, evidence: { pr_review: approval.id } }] : [];
  }
  return escapes.map((e) => ({
    piece: 'B17',
    finding: 'review.escape',
    class: 'fn' as const,
    ground_truth: e.kind === 'main_failed' ? 'G03' : 'G10',
    value: 1,
    unit: null,
    subject: e.subject,
    attempt,
    evidence: { pr_review: approval.id, ...e.ref },
  }));
};

/** B16: the «LGTM with comments» waiver: waived and held (TP), waived and escaped (FP), refused and the review found nothing (FN) or something (TN). */
export const reviewWaiver: Rule = (inputs) => {
  const out: Finding[] = [];
  const reviewSteps = stepsOf(inputs, 'review');
  for (const s of reviewSteps) {
    const d = detailOf(s);
    const base = { piece: 'B16', finding: 'review.waiver', attempt: s.attempt, subject: inputs.taskCode } as const;
    if (s.outcome === 'ok' && typeof d.waived === 'string') {
      if (inputs.request.state !== 'done') continue;
      const escapes = escapesOf(inputs);
      out.push({ ...base, class: escapes.length === 0 ? 'tp' : 'fp', ground_truth: escapes[0]?.kind === 'issue' ? 'G10' : 'G03', value: 1, unit: null, evidence: { build_step: s.id, waiver: d.waiver ?? null, escapes: escapes.map((e) => e.ref) } });
    } else if (s.outcome === 'waiting' && typeof d.waiver_refused === 'string') {
      // The review of the same attempt tells whether the waiver would have been right.
      const review = inputs.reviews.find((r) => r.run_id === d.run_id);
      if (!review) continue;
      const idle = review.verdict === 'approve' && commentsOf(review).length === 0;
      const run = (inputs.reviewRuns ?? []).find((r) => r.id === review.run_id);
      const tokens = run ? tokensOf(run.usage) : null;
      out.push({ ...base, class: idle ? 'fn' : 'tn', ground_truth: null, value: idle ? tokens : 1, unit: idle && tokens !== null ? 'tokens' : null, evidence: { build_step: s.id, pr_review: review.id, refused: d.waiver_refused } });
    }
  }
  return out;
};

/** B17: tokens and minutes of every review run (`ai_runs`). */
export const reviewCost: Rule = (inputs) => {
  const out: Finding[] = [];
  for (const review of orderedReviews(inputs)) {
    const run = (inputs.reviewRuns ?? []).find((r) => r.id === review.run_id);
    if (!run) continue;
    const base = { piece: 'B17', finding: 'review.cost', class: 'cost' as const, attempt: attemptOfReview(inputs, review), subject: review.verdict, evidence: { pr_review: review.id, run: run.id } };
    const tokens = tokensOf(run.usage);
    if (tokens !== null) out.push({ ...base, value: tokens, unit: 'tokens' });
    if (run.started_at && run.finished_at) out.push({ ...base, value: Math.round(((timeOf(run.finished_at) - timeOf(run.started_at)) / 60_000) * 100) / 100, unit: 'min' });
  }
  return out;
};
