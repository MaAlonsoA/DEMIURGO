// Reviewer rules (salud-del-harness §3.1 B16 and B17, §7.4, Annex B): did the comments change code, did the builder
// repeat what it was told, what escaped to main, did the LGTM waiver hold, and what each review cost. Pure functions
// over `pr_reviews`, the build steps and the optional `issues` / `reviewRuns` inputs.
// Practice: Sadowski et al., «Lessons from Building Static Analysis Tools at Google» (CACM 2018): measure which
// findings developers act on and retire those that do not; Google eng-practices («Speed of Code Reviews») for the
// «LGTM with comments» waiver. The trigram threshold 0.4 is our convention.

import type { Row } from '../../db/schema.ts';
import type { PostmortemInputs } from '../postmortem.ts';
import { type Json, asArray, asObject, attemptOfReview, commitFiles, detailOf, normalPath, numberOf, stepsOf, timeOf, tokensOf } from './builder-detail.ts';
import type { Finding, Rule } from './index.ts';

/**
 * Trigram similarity from which two blocking comments on one path are the same request: «convención nuestra»,
 * calibrated by hand on 9 consecutive pairs of one project (validacion-reglas-harness §4): the two real repeats
 * scored 0.40 and 0.42, the seven distinct defects 0.25 to 0.43, so at 0.4 two of the three pairs flagged are real. Two more signals count as a repeat: both bodies cite
 * the same criterion code (AC-XXX-NNN-NN), or the second refers back («earlier request/review/comment»).
 */
export const REPEAT_SIMILARITY = 0.4;

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

/** Whether a file the builder touched answers a comment anchored at `path`: the same file, or a directory prefix (`e2e/`). */
const touchesPath = (files: readonly string[], path: string): boolean => path !== '' && files.some((f) => f === path || (path.endsWith('/') && f.startsWith(path)));

/**
 * The files one `commit ok` step changed on its own (not the whole branch diff the step stores in `files`).
 * `own_files` when the step has it (the commit's own change). Else the symmetric difference of `files` against the
 * previous commit's `files`, so a file the builder removed from the branch diff (a revert) counts as touched too; this
 * fallback cannot see a file that was edited but was already in both lists. Null when nothing stored says; without a
 * previous commit the baseline is empty. «Own files» is our reading of «what the builder did after the review».
 */
export function ownFilesOf(step: Row<'build_steps'>, previous: Row<'build_steps'> | undefined): string[] | null {
  const d = detailOf(step);
  if (Array.isArray(d.own_files)) return asArray(d.own_files).filter((f): f is string => typeof f === 'string').map(normalPath);
  if (!Array.isArray(d.files)) return null;
  const now = new Set(commitFiles(step));
  let before = new Set<string>();
  if (previous) {
    if (!Array.isArray(detailOf(previous).files)) return null;
    before = new Set(commitFiles(previous));
  }
  return [...new Set([...now, ...before])].filter((f) => now.has(f) !== before.has(f));
}

const REFERS_BACK = /\b(earlier|previous) (request|review|comment)\b/i;
const CRITERION_CODE = /AC-[A-Z]+-\d+-\d+/g;

/** Whether a comment of the next round says again what `c` said (same path, close text, same criterion, or a reference back). */
function repeatedIn(next: Row<'pr_reviews'> | undefined, c: Comment): boolean {
  if (!next) return false;
  return commentsOf(next).some((x) => x.severity === 'blocking' && x.path === c.path && isRepeat(c, x).repeat);
}

/**
 * G04: did the builder act on the comment? Only the builder's own change after the review counts (`ownFilesOf`), not the
 * accumulated branch diff. `fp` only when no commit followed the review although a later review approved (or the
 * comment needed the person and nothing changed, G08); missing data is `info`, not `fp`. G03 and G10 below read main and the issues.
 */
export const reviewFindingOutcome: Rule = (inputs) => {
  const out: Finding[] = [];
  const reviews = orderedReviews(inputs);
  const commits = stepsOf(inputs, 'commit').filter((s) => s.outcome === 'ok');
  reviews.forEach((review, i) => {
    const attempt = attemptOfReview(inputs, review);
    const later = reviews.slice(i + 1);
    const next = later[0];
    const approvedLater = later.some((r) => r.verdict === 'approve') || (inputs.request.state === 'done' && later.length > 0);
    const from = timeOf(review.created_at);
    const to = next ? timeOf(next.created_at) : Infinity;
    const before = commits.filter((s) => timeOf(s.created_at) <= from).at(-1);
    // The builder's answer to this review: its commits before the next review.
    const answers = commits.filter((s) => timeOf(s.created_at) > from && timeOf(s.created_at) <= to);
    const owned = answers.map((s, k) => ({ step: s, own: ownFilesOf(s, k === 0 ? before : answers[k - 1]) }));
    const changed = answers.some((s, k) => {
      const previous = k === 0 ? before : answers[k - 1];
      const sha = detailOf(s).sha;
      const was = previous ? detailOf(previous).sha : undefined;
      return typeof sha !== 'string' || sha !== was;
    });
    for (const c of commentsOf(review)) {
      if (c.severity !== 'blocking' && c.severity !== 'fix' && c.severity !== 'nit') continue;
      const base = { piece: 'B17', finding: 'review.finding_outcome', attempt, subject: c.path || null } as const;
      const ref = { pr_review: review.id, comment_index: c.index, severity: c.severity };
      if (c.severity === 'nit') {
        // A nit is never a costly false positive (Annex B): it is noted, not counted.
        out.push({ ...base, class: 'info', value: null, unit: null, evidence: ref });
        continue;
      }
      const touching = owned.find((o) => o.own && touchesPath(o.own, c.path));
      if (touching) {
        out.push({ ...base, class: 'tp', ground_truth: 'G04', value: 1, unit: 'person_actions', evidence: { ...ref, commit_step: touching.step.id } });
      } else if (owned.length > 0 && owned.some((o) => o.own === null) && !owned.some((o) => o.own !== null)) {
        // Commits followed but none says which files it changed: absence of data is not a false positive.
        out.push({ ...base, class: 'info', ground_truth: 'G04', value: null, unit: null, evidence: { ...ref, no_commit_files: true } });
      } else if (changed && (approvedLater || (next !== undefined && !repeatedIn(next, c)))) {
        // Fixed somewhere else (the comment names a file, the fix lives in another) or by reverting: the next round accepted it.
        out.push({ ...base, class: 'info', ground_truth: 'G04', value: null, unit: null, evidence: { ...ref, acted_elsewhere: true } });
      } else if (approvedLater && !changed) {
        out.push({ ...base, class: 'fp', ground_truth: c.needsPerson ? 'G08' : 'G04', value: 1, unit: 'person_actions', evidence: { ...ref, needs_person: c.needsPerson } });
      } else out.push({ ...base, class: 'info', ground_truth: 'G04', value: null, unit: null, evidence: { ...ref, unresolved: true } });
    }
  });
  return out;
};

/** The repeat test of B10: same path is checked by the caller. «convención nuestra» (see REPEAT_SIMILARITY). */
function isRepeat(earlier: Comment, current: Comment): { repeat: boolean; similarity: number } {
  const similarity = trigramSimilarity(earlier.body, current.body);
  const codes = new Set(earlier.body.match(CRITERION_CODE) ?? []);
  const sameCriterion = (current.body.match(CRITERION_CODE) ?? []).some((code) => codes.has(code));
  return { repeat: similarity >= REPEAT_SIMILARITY || sameCriterion || REFERS_BACK.test(current.body), similarity };
}

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
        const { repeat, similarity } = isRepeat(e, c);
        if (repeat && (!best || similarity > best.similarity)) best = { comment: e, similarity };
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
    if (s.outcome === 'failed' && d.superseded !== true && d.conclusion !== 'cancelled') found.push({ kind: 'main_failed', ref: { build_step: s.id, sha: d.sha ?? null, conclusion: d.conclusion ?? null }, subject: 'main' });
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
