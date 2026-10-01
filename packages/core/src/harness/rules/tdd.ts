// TDD gate rules (salud-del-harness §3.1 B09, §7.4, Annex B): what the red/green check before the commit decided and
// what it cost. Pure functions over the stored builder steps (`build_steps.detail.tdd`) and the CI of the same attempt.
// Practice: Kent Beck (red, green; do not go on while red) and Fowler's «Continuous Integration» (test locally before
// integrating so a red does not cost a CI run). The ground truth for «CI run avoided» is our convention: the attempt's
// first decisive CI was green while the gate sent the builder back at least once.

import type { TddDetail } from '../../build/tdd.ts';
import type { Rule, Finding } from './index.ts';
import { type Json, asArray, asObject, detailOf, firstDecisiveCi, numberOf, stepsOf, tokensOf } from './builder-detail.ts';
import type { PostmortemInputs } from '../postmortem.ts';
import type { Row } from '../../db/schema.ts';

const PIECE = 'B09';
/** A red explained by the environment, not by the code (the gate's own notes). */
const ENVIRONMENT_NOTE = /main did not build|cannot load/i;

type Gate = { step: Row<'build_steps'>; tdd: Partial<TddDetail> & Json };

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
const environmental = (g: Gate): boolean => notesOf(g).some((n) => ENVIRONMENT_NOTE.test(n)) || redOf(g).some((r) => r.outcome === 'not_run' || (typeof r.reason === 'string' && ENVIRONMENT_NOTE.test(r.reason)));

/** A criterion test failed in CI of this attempt (evidence rows or test runs): the failure the gate should have caught. G05. */
function criterionFailedInCi(inputs: PostmortemInputs, attempt: number): boolean {
  if (inputs.testRuns.some((t) => t.attempt === attempt && t.outcome === 'fail' && t.criterion_code)) return true;
  return stepsOf(inputs, 'evidence').some((s) => {
    if (s.attempt !== attempt) return false;
    return asArray(detailOf(s).recorded).some((r) => asObject(r).result === 'fail');
  });
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
    const caught = redOf(g).filter((r) => r.outcome === 'passed');
    if (caught.length > 0) {
      out.push({ ...base, class: 'benefit', ground_truth: 'G05', value: caught.length, unit: 'tests', subject: caught.map((r) => String(r.criterion)).join(', '), evidence: { ...evidence, tests: caught.map((r) => ({ criterion: r.criterion, test: r.test, path: r.path })) } });
    }

    if (environmental(g) && (loops > 0 || status === 'red')) {
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
      out.push({ ...base, class: 'tp', ground_truth: null, value: loops, unit: 'loops', evidence });
      if (ci?.green) out.push({ ...base, class: 'benefit', ground_truth: 'G05', value: loops, unit: 'ci_runs', evidence: { ...evidence, ci_step: ci.step.id } });
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
      const base = { piece: PIECE, finding: 'tdd.loop_cost', class: 'cost' as const, attempt: g.step.attempt, subject: `loop ${loop}`, evidence: { build_step: g.step.id, loop } };
      const ms = numberOf(entry.duration_ms);
      if (ms !== null) out.push({ ...base, value: Math.round((ms / 60_000) * 100) / 100, unit: 'min' });
      const tokens = tokensOf(entry.usage);
      if (tokens !== null) out.push({ ...base, value: tokens, unit: 'tokens' });
    }
  }
  return out;
};
