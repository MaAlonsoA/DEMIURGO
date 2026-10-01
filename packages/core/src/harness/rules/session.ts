// Builder session rules (salud-del-harness §3.1 B20): does continuing the builder's previous agent session on a retry
// work better than starting a fresh one? Pure functions over the stored builder steps (`build_steps.detail.session`,
// written by build/orchestrator.ts from `builderSessionPlan`). Everything below is «convención nuestra»; no published
// standard defines it (Anthropic's «Effective harnesses for long-running agents» describes the progress notes a fresh
// session uses, not a measure of resume against fresh):
// - Only attempts >= 2 with a recorded session mode count: attempt 1 is always fresh and has nothing to compare.
// - `session.mode` (info): the mode of the attempt with the reason the plan gave (so «files missing», «engine changed»
//   and «cap reached» can be told apart) and what ended the previous attempt.
// - `session.outcome`: success (benefit) when the attempt reached `merge ok`; cost when a later attempt exists, so it
//   needed another one. The last attempt of a request that did not merge (withdrawn, waiting for the person) is not
//   judged. value = minutes of the builder step(s) of the attempt; a second row `session.outcome_tokens` holds tokens.
// - `session.tdd_loops` (info): TDD gate loops inside the attempt.
// - pm-6 (revision against Anthropic's harness, §4.1 and §4.3; every threshold and the tp/fp reading are «convención
//   nuestra»): the stored `reason_code` ('insisted' | 'cap' | 'files_missing' | 'engine_changed' | 'first') goes into
//   the evidence of the rows above so the comparison can be cut by cause; `session.last_turn_tokens` (info) is the size
//   of the last turn of the builder's attempt; `session.insisted` judges the forced fresh session (see below).
// Caveat: the modes are not assigned at random (fresh follows a missing session, another engine or the cap), so the
// comparison is observational, not an experiment; the reason in the evidence lets one split it.

import type { Row } from '../../db/schema.ts';
import type { PostmortemInputs } from '../postmortem.ts';
import { type Json, asObject, attemptOfReview, costUsdOf, detailOf, numberOf, stepsOf, tokensOf } from './builder-detail.ts';
import type { Finding, Rule } from './index.ts';
import { commentsOf, isRepeat, orderedReviews, ownFilesOf } from './review.ts';

const PIECE = 'B20';

type Mode = 'resumed' | 'fresh';
type AttemptSession = { attempt: number; mode: Mode; reason: string | null; reasonCode: string | null; signal: string | null; jev: Json | null; steps: Row<'build_steps'>[] };

/** The session of each attempt >= 2 that recorded one (the last builder step of the attempt that has it). */
function sessionsOf(inputs: PostmortemInputs): AttemptSession[] {
  const out: AttemptSession[] = [];
  const attempts = [...new Set(stepsOf(inputs, 'builder').map((s) => s.attempt))].filter((a) => a >= 2).sort((a, b) => a - b);
  for (const attempt of attempts) {
    const steps = stepsOf(inputs, 'builder').filter((s) => s.attempt === attempt && (s.outcome === 'ok' || s.outcome === 'failed'));
    let found: Json | null = null;
    for (const s of steps) {
      const session = asObject(detailOf(s).session);
      if (session.mode === 'resumed' || session.mode === 'fresh') found = session;
    }
    if (!found) continue;
    out.push({ attempt, mode: found.mode as Mode, reason: typeof found.reason === 'string' ? found.reason : null, reasonCode: typeof found.reason_code === 'string' ? found.reason_code : null, signal: typeof found.insisted_signal === 'string' ? found.insisted_signal : null, jev: Object.keys(asObject(found.jev)).length > 0 ? asObject(found.jev) : null, steps });
  }
  return out;
}

/** What ended an attempt, from its steps: the first one that did not go well. «unknown» when none says. */
export function endedBy(steps: readonly Row<'build_steps'>[]): string {
  for (const s of steps) {
    const d = detailOf(s);
    if (s.stage === 'builder') {
      if (typeof d.failure_kind === 'string') return d.failure_kind;
      if (asObject(d.tdd).status === 'red') return 'tdd_red';
      if (s.outcome === 'failed') return 'builder_failed';
    } else if (s.stage === 'design' && s.outcome === 'failed') return 'design';
    else if (s.stage === 'ci' && s.outcome === 'failed' && !(d.cancelled === true || d.conclusion === 'cancelled')) return 'ci_red';
    else if ((s.stage === 'review' || s.stage === 'merge') && (s.outcome === 'changes_requested' || (s.stage === 'review' && s.outcome === 'failed' && d.verdict != null))) return 'review_changes';
    else if (s.outcome === 'failed') return `${s.stage}_failed`;
    else if (s.outcome === 'cancelled') return 'cancelled';
  }
  return 'unknown';
}

const minutesOf = (steps: readonly Row<'build_steps'>[]): number | null => {
  const ms = steps.map((s) => numberOf(detailOf(s).duration_ms)).filter((n): n is number => n !== null);
  return ms.length === 0 ? null : Math.round((ms.reduce((a, b) => a + b, 0) / 60_000) * 100) / 100;
};
const tokensOfSteps = (steps: readonly Row<'build_steps'>[]): number | null => {
  const t = steps.map((s) => tokensOf(detailOf(s).usage)).filter((n): n is number => n !== null);
  return t.length === 0 ? null : t.reduce((a, b) => a + b, 0);
};

/** Info row per attempt >= 2: the mode, why, and what ended the attempt before it. */
export const sessionMode: Rule = (inputs) =>
  sessionsOf(inputs).map((a) => ({
    piece: PIECE,
    finding: 'session.mode',
    class: 'info' as const,
    attempt: a.attempt,
    value: null,
    unit: null,
    subject: a.mode,
    evidence: {
      build_step: a.steps.at(-1)?.id ?? null,
      reason: a.reason,
      reason_code: a.reasonCode,
      attempt: a.attempt,
      previous_failure: endedBy(inputs.steps.filter((s) => s.attempt === a.attempt - 1 && s.outcome !== 'started' && s.outcome !== 'waiting')),
    },
  }));

/** Benefit (reached merge) or cost (needed another attempt), with the minutes and, apart, the tokens of the builder step. */
export const sessionOutcome: Rule = (inputs) => {
  const out: Finding[] = [];
  const last = inputs.steps.reduce((n, s) => Math.max(n, s.attempt), 0);
  for (const a of sessionsOf(inputs)) {
    const merged = inputs.steps.some((s) => s.attempt === a.attempt && s.stage === 'merge' && s.outcome === 'ok');
    if (!merged && a.attempt >= last) continue; // not judged: nothing came after it and it did not merge
    const cls = merged ? ('benefit' as const) : ('cost' as const);
    const base = { piece: PIECE, class: cls, attempt: a.attempt, subject: a.mode };
    const evidence = { build_step: a.steps.at(-1)?.id ?? null, mode: a.mode, reason: a.reason, reason_code: a.reasonCode, merged };
    out.push({ ...base, finding: 'session.outcome', value: minutesOf(a.steps), unit: minutesOf(a.steps) === null ? null : 'min', evidence });
    const tokens = tokensOfSteps(a.steps);
    if (tokens !== null) out.push({ ...base, finding: 'session.outcome_tokens', value: tokens, unit: 'tokens', evidence });
    const usd = a.steps.map((s) => costUsdOf(detailOf(s).usage)).filter((n): n is number => n !== null);
    if (usd.length > 0) out.push({ ...base, finding: 'session.outcome_usd', value: Math.round(usd.reduce((x, y) => x + y, 0) * 10_000) / 10_000, unit: 'usd', evidence });
  }
  return out;
};

/** TDD loops the gate sent the builder back for inside the attempt (zero is a row too: it is the denominator). */
export const sessionTddLoops: Rule = (inputs) =>
  sessionsOf(inputs).flatMap((a) => {
    const gate = a.steps.map((s) => asObject(detailOf(s).tdd)).filter((t) => typeof t.status === 'string').at(-1);
    if (!gate) return [];
    return [{ piece: PIECE, finding: 'session.tdd_loops', class: 'info' as const, attempt: a.attempt, value: numberOf(gate.loops) ?? 0, unit: 'loops' as const, subject: a.mode, evidence: { build_step: a.steps.at(-1)?.id ?? null, status: gate.status } }];
  });

/** Size of the last turn of the attempt's builder run (`usage.last_turn_input_tokens`, pm-6 data), to see the curve (B20, info). */
export const sessionLastTurnTokens: Rule = (inputs) => {
  const out: Finding[] = [];
  const attempts = [...new Set(stepsOf(inputs, 'builder').map((s) => s.attempt))].sort((a, b) => a - b);
  for (const attempt of attempts) {
    const steps = stepsOf(inputs, 'builder').filter((s) => s.attempt === attempt);
    const last = steps.filter((s) => numberOf(asObject(detailOf(s).usage).last_turn_input_tokens) !== null).at(-1);
    if (!last) continue;
    const session = asObject(detailOf(last).session);
    out.push({ piece: PIECE, finding: 'session.last_turn_tokens', class: 'info', attempt, value: numberOf(asObject(detailOf(last).usage).last_turn_input_tokens), unit: 'tokens', subject: typeof session.mode === 'string' ? session.mode : null, evidence: { build_step: last.id, reason_code: typeof session.reason_code === 'string' ? session.reason_code : null } });
  }
  return out;
};

const CHANGED_NOTHING = /changed nothing/i;
const touches = (files: readonly string[], path: string): boolean => path !== '' && files.some((f) => f === path || (path.endsWith('/') && f.startsWith(path)));

/** The blocking comments the review of `attempt` made again from the review of the attempt before (same path, B10 test). */
function repeatedComments(inputs: PostmortemInputs, attempt: number): { path: string; pr_review: string; comment_index: number }[] {
  const reviews = orderedReviews(inputs);
  const current = reviews.filter((r) => attemptOfReview(inputs, r) === attempt).at(-1);
  const previous = reviews.filter((r) => attemptOfReview(inputs, r) === attempt - 1).at(-1);
  if (!current || !previous) return [];
  const earlier = commentsOf(previous).filter((c) => c.severity === 'blocking');
  return commentsOf(current)
    .filter((c) => c.severity === 'blocking' && earlier.some((e) => e.path === c.path && isRepeat(e, c).repeat))
    .map((c) => ({ path: c.path, pr_review: current.id, comment_index: c.index }));
}

/** The commit step of an attempt that came out empty: it failed with «changed nothing». */
const committedNothing = (inputs: PostmortemInputs, attempt: number): Row<'build_steps'> | undefined =>
  stepsOf(inputs, 'commit').find((s) => s.attempt === attempt && s.outcome === 'failed' && CHANGED_NOTHING.test(String(detailOf(s).error ?? '')));

/**
 * B20 `session.insisted` (revision against Anthropic's harness §4.1; «convención nuestra»: the repository's «Exit when
 * […] a cycle makes no changes» only inspires it). Positive: a RESUMED attempt >= 2 changed nothing or got the same
 * blocking comment back. It is judged by the attempt after it, when the orchestrator forced a fresh session
 * (`reason_code` = `insisted`): `tp` when that attempt changed the path of the comment (with no comment: merged) —
 * leaving the session was worth it; `fp` when it changed nothing either (the request was the problem, not the session);
 * `info` when no forced fresh session followed. `cost` rows hold the minutes and tokens of the empty attempt.
 * Jev signals (`jev_repeated_finding`, `jev_stuck`, stored by the orchestrator as `session.insisted_signal` with the
 * probabilities in `session.jev`) also make a resumed attempt positive when the next attempt was forced fresh by one;
 * the evidence carries `signal` and `jev`, and `subject` is the signal when no repeated path names it, so the two
 * Jev signals can be judged apart from the deterministic ones.
 */
export const sessionInsisted: Rule = (inputs) => {
  const out: Finding[] = [];
  const sessions = sessionsOf(inputs);
  const commits = stepsOf(inputs, 'commit').filter((s) => s.outcome === 'ok');
  for (const a of sessions) {
    if (a.mode !== 'resumed') continue;
    const empty = committedNothing(inputs, a.attempt);
    const repeated = repeatedComments(inputs, a.attempt);
    const next = sessions.find((s) => s.attempt === a.attempt + 1);
    const jevSignal = next?.mode === 'fresh' && next.reasonCode === 'insisted' && next.signal !== null && next.signal.startsWith('jev_') ? next.signal : null;
    if (!empty && repeated.length === 0 && !jevSignal) continue;
    const signal = empty ? 'changed_nothing' : repeated.length > 0 ? 'repeated_finding' : jevSignal;
    const base = { piece: PIECE, finding: 'session.insisted', attempt: a.attempt, subject: repeated[0]?.path || jevSignal || null } as const;
    const ref = { build_step: a.steps.at(-1)?.id ?? null, empty_commit_step: empty?.id ?? null, repeated, signal, ...(next?.jev ? { jev: next.jev } : {}) };
    if (!next || next.mode !== 'fresh' || next.reasonCode !== 'insisted') {
      out.push({ ...base, class: 'info', value: null, unit: null, evidence: { ...ref, forced_fresh: false, next_attempt: next ? { attempt: next.attempt, mode: next.mode, reason_code: next.reasonCode } : null } });
    } else {
      const merged = inputs.steps.some((s) => s.attempt === next.attempt && s.stage === 'merge' && s.outcome === 'ok');
      const nextCommits = commits.filter((s) => s.attempt === next.attempt);
      const prior = commits.filter((s) => s.attempt < next.attempt).at(-1);
      const own = nextCommits.map((s, k) => ownFilesOf(s, k === 0 ? prior : nextCommits[k - 1]));
      const paths = repeated.map((r) => r.path).filter((p) => p !== '');
      const changedPath = paths.length > 0 && own.some((files) => files !== null && paths.some((p) => touches(files, p)));
      const emptyAgain = committedNothing(inputs, next.attempt) !== undefined || (paths.length > 0 && repeatedComments(inputs, next.attempt).some((r) => paths.includes(r.path)));
      const evidence = { ...ref, forced_fresh: true, next_step: next.steps.at(-1)?.id ?? null, merged };
      if (changedPath || (paths.length === 0 && merged && !emptyAgain)) out.push({ ...base, class: 'tp', ground_truth: merged ? 'G07' : 'G04', value: 1, unit: 'attempts', evidence });
      else if (emptyAgain) out.push({ ...base, class: 'fp', ground_truth: 'G04', value: 1, unit: 'attempts', evidence });
      else out.push({ ...base, class: 'info', value: null, unit: null, evidence: { ...evidence, undecided: true } });
    }
    const minutes = minutesOf(a.steps);
    const tokens = tokensOfSteps(a.steps);
    const cost = { piece: PIECE, class: 'cost' as const, attempt: a.attempt, subject: base.subject, evidence: ref };
    if (minutes !== null) out.push({ ...cost, finding: 'session.insisted_cost', value: minutes, unit: 'min' });
    if (tokens !== null) out.push({ ...cost, finding: 'session.insisted_cost_tokens', value: tokens, unit: 'tokens' });
  }
  return out;
};
