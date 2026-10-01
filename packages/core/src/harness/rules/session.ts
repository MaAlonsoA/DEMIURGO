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
// Caveat: the modes are not assigned at random (fresh follows a missing session, another engine or the cap), so the
// comparison is observational, not an experiment; the reason in the evidence lets one split it.

import type { Row } from '../../db/schema.ts';
import type { PostmortemInputs } from '../postmortem.ts';
import { type Json, asObject, detailOf, numberOf, stepsOf, tokensOf } from './builder-detail.ts';
import type { Finding, Rule } from './index.ts';

const PIECE = 'B20';

type Mode = 'resumed' | 'fresh';
type AttemptSession = { attempt: number; mode: Mode; reason: string | null; steps: Row<'build_steps'>[] };

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
    out.push({ attempt, mode: found.mode as Mode, reason: typeof found.reason === 'string' ? found.reason : null, steps });
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
    const evidence = { build_step: a.steps.at(-1)?.id ?? null, mode: a.mode, reason: a.reason, merged };
    out.push({ ...base, finding: 'session.outcome', value: minutesOf(a.steps), unit: minutesOf(a.steps) === null ? null : 'min', evidence });
    const tokens = tokensOfSteps(a.steps);
    if (tokens !== null) out.push({ ...base, finding: 'session.outcome_tokens', value: tokens, unit: 'tokens', evidence });
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
