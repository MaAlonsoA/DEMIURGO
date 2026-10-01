// TDD gate rules (salud-del-harness §3.1 B09, §7.4, Annex B): what the red/green check before the commit decided and
// what it cost. Pure functions over the stored builder steps (`build_steps.detail.tdd`) and the CI of the same attempt.
// Practice: Kent Beck (red, green; do not go on while red) and Fowler's «Continuous Integration» (test locally before
// integrating so a red does not cost a CI run). The ground truth for «CI run avoided» is our convention: the attempt's
// first decisive CI was green while the gate sent the builder back at least once.

import type { TddDetail } from '../../build/tdd.ts';
import type { Rule, Finding } from './index.ts';
import { type Json, asArray, asObject, cachedTokensOf, costUsdOf, detailOf, firstDecisiveCi, numberOf, stepsOf, tokensOf } from './builder-detail.ts';
import type { PostmortemInputs } from '../postmortem.ts';
import type { Row } from '../../db/schema.ts';
import { ms } from './common.ts';

const PIECE = 'B09';
/** A red explained by the environment, not by the code (the gate's own notes). */
const ENVIRONMENT_NOTE = /main did not build|cannot load/i;

export type Gate = { step: Row<'build_steps'>; tdd: Partial<TddDetail> & Json };

/** The last builder step of each attempt that stored a `tdd` object. */
function gatesOf(inputs: PostmortemInputs): Gate[] {
  const byAttempt = new Map<number, Gate>();
  for (const step of stepsOf(inputs, 'builder')) {
    const tdd = asObject(detailOf(step).tdd);
    if (typeof tdd.status === 'string') byAttempt.set(step.attempt, { step, tdd: tdd as Gate['tdd'] });
  }
  return [...byAttempt.values()].sort((a, b) => a.step.attempt - b.step.attempt);
}

const redOf = (g: Gate) => asArray(g.tdd.red).map(asObject);
const notesOf = (g: Gate): string[] => asArray(g.tdd.notes).filter((n): n is string => typeof n === 'string');
const loopsOf = (g: Gate): number => numberOf(g.tdd.loops) ?? 0;
/** A compile or load failure at RED is the new test asking for code that does not exist yet: a legitimate red, not the environment. */
const LEGITIMATE_RED = /error TS\d+|SyntaxError|has no exported member|cannot find (module|name)|cannot load|failed to resolve/i;
function environmental(g: Gate): boolean {
  const notes = notesOf(g);
  if (notes.some((n) => ENVIRONMENT_NOTE.test(n) && LEGITIMATE_RED.test(n))) return false; // the not_run entries are explained by the compile error
  return (
    notes.some((n) => ENVIRONMENT_NOTE.test(n)) ||
    redOf(g).some((r) => {
      const reason = typeof r.reason === 'string' ? r.reason : '';
      return !LEGITIMATE_RED.test(reason) && (r.outcome === 'not_run' || ENVIRONMENT_NOTE.test(reason));
    })
  );
}

type Caught = { criterion: string; test: string; path: string };
/** «- RED: <criterion> «<test>» (<path>) passes on main …»: the line of the feedback the NEXT attempt is sent with (build/tdd.ts `tddFeedbackLines`). */
const TOLD_CAUGHT = /^- RED: (\S+) «(.*)» \((.*)\) passes on main/gm;
/** «- <criterion>: `<test>` in <path>»: the line of the loop message under «RED: these tests PASS on main» (build/tdd.ts `tddFeedback`, what `tdd_told` stores). */
const TOLD_RED_LINE = /^- (\S+): `(.*)` in (.+)$/;
const RED_HEADER = /^RED: these tests PASS on main/m;

/** The tests a stored loop message names under its RED header (the section ends at the first blank line). Pure. */
export function redLinesOf(told: string): Caught[] {
  const out: Caught[] = [];
  let inRed = false;
  for (const line of told.split('\n')) {
    if (/^RED: these tests PASS on main/.test(line)) inRed = true;
    else if (inRed && line.trim() === '') inRed = false;
    else if (inRed) {
      const m = TOLD_RED_LINE.exec(line);
      if (m) out.push({ criterion: m[1]!, test: m[2]!, path: m[3]!.trim() });
    }
  }
  return out;
}

/**
 * The criterion tests caught passing on main in this attempt. `tdd.red` only holds the last check, so the earlier loops
 * are recovered from the messages the builder was sent back with (`tdd_told` of the builder step): the loop message
 * (`redLinesOf`) and the next-attempt feedback format (`TOLD_CAUGHT`). Deduplicated.
 */
function caughtOf(g: Gate): Caught[] {
  const seen = new Map<string, Caught>();
  const add = (c: Caught) => seen.set(`${c.criterion}|${c.test}|${c.path}`, c);
  for (const told of asArray(detailOf(g.step).tdd_told)) {
    if (typeof told !== 'string') continue;
    for (const m of told.matchAll(TOLD_CAUGHT)) add({ criterion: m[1]!, test: m[2]!, path: m[3]! });
    for (const c of redLinesOf(told)) add(c);
  }
  for (const r of redOf(g)) if (r.outcome === 'passed') add({ criterion: String(r.criterion), test: String(r.test), path: String(r.path) });
  return [...seen.values()];
}

/** An error of the test environment, not of the code: a missing database, a refused connection, a missing browser. */
export const ENVIRONMENT_ERROR =/database "[^"]*" does not exist|ECONNREFUSED|connection refused|browserType\.launch|Executable doesn't exist|ENOSPC|EADDRINUSE|too many clients/i;

export type LoopClass = 'own' | 'foreign' | 'environment' | 'green';
/** What the orchestrator stores per loop (`failure_class`): null means the check came back green. */
const LOOP_CLASSES: ReadonlySet<string> = new Set(['own', 'foreign', 'environment']);

/** Old rows (no `failure_class`): a loop message whose only GREEN failures are environment errors, with no RED section, is environmental. */
export function loopClassFromMessage(told: unknown): LoopClass {
  if (typeof told !== 'string') return 'own';
  if (RED_HEADER.test(told)) return 'own';
  const green = told.split('\n').filter((l) => /^- `/.test(l));
  return green.length > 0 && green.every((l) => ENVIRONMENT_ERROR.test(l)) ? 'environment' : 'own';
}

export type LoopSplit = { own: number; foreign: number; environment: number; green: number; minutes: { own: number; foreign: number; environment: number }; basis: 'failure_class' | 'message' | 'count' };

/**
 * Splits the loops of an attempt by who caused them. With `loop_runs[].failure_class` (pm-5 data) the field decides;
 * `foreign` is a test of another feature and `environment` an error of the test environment: neither is a catch of
 * the gate. Without the field the stored loop message (`tdd_told`, one per loop) is read for environment errors.
 */
export function splitLoops(g: Gate): LoopSplit {
  const runs = asArray(g.tdd.loop_runs).map(asObject);
  const told = asArray(detailOf(g.step).tdd_told);
  const loops = loopsOf(g);
  const split: LoopSplit = { own: 0, foreign: 0, environment: 0, green: 0, minutes: { own: 0, foreign: 0, environment: 0 }, basis: 'count' };
  const count = Math.max(loops, runs.length);
  for (let i = 0; i < count; i++) {
    const entry = runs.find((r) => numberOf(r.loop) === i + 1) ?? runs[i];
    let cls: LoopClass;
    if (entry && 'failure_class' in entry) {
      split.basis = 'failure_class';
      cls = entry.failure_class === null ? 'green' : typeof entry.failure_class === 'string' && LOOP_CLASSES.has(entry.failure_class) ? (entry.failure_class as LoopClass) : 'own';
    } else {
      cls = loopClassFromMessage(told[i]);
      if (cls !== 'own' && split.basis === 'count') split.basis = 'message';
    }
    split[cls] += 1;
    const minutes = (numberOf(entry?.duration_ms) ?? 0) / 60_000;
    if (cls !== 'green') split.minutes[cls] += minutes;
  }
  return split;
}

/** A criterion test failed in CI of this attempt (evidence rows or test runs): the failure the gate should have caught. G05. */
function criterionFailedInCi(inputs: PostmortemInputs, attempt: number): boolean {
  if (inputs.testRuns.some((t) => t.attempt === attempt && t.outcome === 'fail' && t.criterion_code)) return true;
  return stepsOf(inputs, 'evidence').some((s) => {
    if (s.attempt !== attempt) return false;
    return asArray(detailOf(s).recorded).some((r) => asObject(r).result === 'fail');
  });
}

/**
 * Minutes one CI run of this request takes: the median, over the attempts that have both, of the time from the first
 * `ci` step in `waiting` to the `ci` step that ended it (ok or failed). Null when no attempt has both. Convención nuestra:
 * it prices «a CI run saved» in minutes so that the benefit of the gate is weighed against its cost (`tdd.loop_cost`,
 * minutes) in the same unit.
 */
export function ciRunMinutes(inputs: PostmortemInputs): number | null {
  const durations: number[] = [];
  for (const attempt of new Set(inputs.steps.map((s) => s.attempt))) {
    const ci = inputs.steps.filter((s) => s.attempt === attempt && s.stage === 'ci');
    const waiting = ci.find((s) => s.outcome === 'waiting');
    const ended = ci.filter((s) => s.outcome === 'ok' || s.outcome === 'failed').at(-1);
    if (!waiting || !ended) continue;
    const dt = (ms(ended.created_at) - ms(waiting.created_at)) / 60_000;
    if (dt > 0) durations.push(dt);
  }
  if (durations.length === 0) return null;
  durations.sort((a, b) => a - b);
  const mid = durations.length >> 1;
  const median = durations.length % 2 === 1 ? durations[mid]! : (durations[mid - 1]! + durations[mid]!) / 2;
  return Math.round(median * 100) / 100;
}

export const tddGate: Rule = (inputs) => {
  const out: Finding[] = [];
  for (const g of gatesOf(inputs)) {
    const attempt = g.step.attempt;
    const status = g.tdd.status;
    if (status === 'skipped') continue;
    const loops = loopsOf(g);
    const base = { piece: PIECE, finding: 'tdd.gate', attempt, subject: inputs.taskCode } as const;
    const evidence = { build_step: g.step.id, status, loops };

    // Criterion tests caught passing on main: the check that a test fails without the change (Freeman and Pryce).
    // One row per caught test, worth 1 each (not per loop).
    for (const c of caughtOf(g)) {
      out.push({ ...base, class: 'benefit', ground_truth: 'G05', value: 1, unit: 'tests', subject: c.criterion, evidence: { ...evidence, tests: [c] } });
    }

    // A false positive only when it ended red: with `passed`, the loops belong to the green phase.
    if (environmental(g) && status === 'red') {
      // The red was explained by the environment: it says nothing about the code.
      out.push({ ...base, class: 'fp', ground_truth: null, value: Math.max(loops, 1), unit: 'loops', evidence: { ...evidence, notes: notesOf(g) } });
      continue;
    }

    if (status === 'red') {
      // Stopped red (cap, builder failed, no session): the next attempt is told the failing tests; not a verdict yet.
      out.push({ ...base, class: 'info', value: loops, unit: 'loops', evidence: { ...evidence, stopped: g.tdd.stopped ?? null } });
      continue;
    }

    // status passed
    const ci = firstDecisiveCi(inputs, attempt);
    if (loops > 0) {
      // Only the loops caused by the task's own criteria are catches of the gate; a failing test of another feature or an
      // environment error is the gate's noise (fp / info with the minutes it cost), never a TP.
      const split = splitLoops(g);
      const round = (n: number) => Math.round(n * 100) / 100;
      const detail = { ...evidence, split: { own: split.own, foreign: split.foreign, environment: split.environment, green: split.green }, basis: split.basis };
      if (split.own > 0) {
        out.push({ ...base, class: 'tp', ground_truth: null, value: split.own, unit: 'loops', evidence: { ...detail, minutes: round(split.minutes.own) } });
        if (ci?.green) {
          out.push({ ...base, class: 'benefit', ground_truth: 'G05', value: 1, unit: 'ci_runs', evidence: { ...detail, ci_step: ci.step.id } });
          const saved = ciRunMinutes(inputs);
          if (saved !== null) out.push({ ...base, finding: 'tdd.gate_saved', class: 'benefit', ground_truth: 'G05', value: saved, unit: 'min', evidence: { ...detail, ci_step: ci.step.id, ci_run_min: saved } });
        }
      }
      if (split.foreign > 0) out.push({ ...base, class: 'fp', ground_truth: null, value: split.foreign, unit: 'loops', evidence: { ...detail, why: 'foreign', minutes: round(split.minutes.foreign) } });
      if (split.environment > 0) out.push({ ...base, class: 'info', ground_truth: null, value: split.environment, unit: 'loops', evidence: { ...detail, why: 'environment', minutes: round(split.minutes.environment) } });
    }
    if (!ci) continue;
    if (!ci.green) {
      const criterion = criterionFailedInCi(inputs, attempt);
      out.push({ ...base, class: criterion ? 'fn' : 'info', ground_truth: 'G05', value: 1, unit: 'ci_runs', evidence: { ...evidence, ci_step: ci.step.id, criterion_test_failed: criterion } });
    } else if (loops === 0) {
      out.push({ ...base, class: 'tn', ground_truth: 'G05', value: 1, unit: 'ci_runs', evidence: { ...evidence, ci_step: ci.step.id } });
    }
  }
  return out;
};

export const tddSkipped: Rule = (inputs) =>
  gatesOf(inputs)
    .filter((g) => g.tdd.status === 'skipped')
    .map((g) => ({
      piece: PIECE,
      finding: 'tdd.skipped',
      class: 'info' as const,
      attempt: g.step.attempt,
      value: null,
      unit: null,
      subject: typeof g.tdd.skipped === 'string' ? g.tdd.skipped : 'skipped',
      evidence: { build_step: g.step.id, loops: loopsOf(g) },
    }));

/** Minutes and tokens of each loop the gate sent the builder back for (`tdd.loop_runs[]`, stored by the orchestrator). */
export const tddLoopCost: Rule = (inputs) => {
  const out: Finding[] = [];
  for (const g of gatesOf(inputs)) {
    for (const entry of asArray(g.tdd.loop_runs).map(asObject)) {
      const loop = numberOf(entry.loop);
      if (loop === null) continue;
      const base = { piece: PIECE, finding: 'tdd.loop_cost', class: 'cost' as const, attempt: g.step.attempt, subject: `loop ${loop}`, evidence: { build_step: g.step.id, loop, failure_class: 'failure_class' in entry ? (entry.failure_class ?? null) : undefined } };
      const ms = numberOf(entry.duration_ms);
      if (ms !== null) out.push({ ...base, value: Math.round((ms / 60_000) * 100) / 100, unit: 'min' });
      const tokens = tokensOf(entry.usage);
      if (tokens !== null) out.push({ ...base, value: tokens, unit: 'tokens', evidence: { ...base.evidence, cached_tokens: cachedTokensOf(entry.usage) } });
      const usd = costUsdOf(entry.usage);
      if (usd !== null) out.push({ ...base, value: Math.round(usd * 10_000) / 10_000, unit: 'usd' });
    }
  }
  return out;
};
