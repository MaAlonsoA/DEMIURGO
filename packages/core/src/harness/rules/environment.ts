// Environment rules (salud-del-harness B25, revision against Anthropic's harness §4.2 and §4.6). Pure functions over the
// `environment` build steps. Everything here is «convención nuestra»; the practice behind the smoke check is Anthropic's
// «Effective harnesses for long-running agents» («run a basic test on the development server to catch any undocumented
// bugs») and the repository's «run the project's smoke test […] so you know you're starting from a working tree», but
// neither says how to score it:
// - `environment.smoke` (B25): the step stored `detail.smoke = {ok, commands, failed, duration_ms} | {skipped}`.
//   Positive = red. `tp` = red and the same test fails on the base (a later GREEN found `failing_on_main > 0`, or a red
//   `main` step names one of the failed items); `fp` = red because of the environment (the failure text is an
//   environment error, same pattern as `tdd.gate`); other reds stay `info` (no later fact decides yet). `fn` = green
//   and the GREEN of the same attempt found `failing_on_main > 0`; `tn` = green and it did not. `cost` = minutes of the
//   smoke; `benefit` = builder minutes saved when `tp` (the mean builder minutes of the attempts that did run).
// - `environment.start_command` (info): whether the step found the command that starts the app.

import type { Row } from '../../db/schema.ts';
import type { PostmortemInputs } from '../postmortem.ts';
import { type Json, asArray, asObject, detailOf, numberOf, stepsOf } from './builder-detail.ts';
import type { Finding, Rule } from './index.ts';
import { ENVIRONMENT_ERROR } from './tdd.ts';

const PIECE = 'B25';
const round2 = (n: number): number => Math.round(n * 100) / 100;
const minutes = (ms: number | null): number | null => (ms === null ? null : round2(ms / 60_000));

type Smoke = { ok: boolean; failed: string[]; durationMs: number | null; commands: unknown };

/** The smoke result of an environment step, or null when it has none or was skipped. */
function smokeOf(step: Row<'build_steps'>): Smoke | null {
  const s = asObject(detailOf(step).smoke);
  if (typeof s.ok !== 'boolean') return null;
  const failed = asArray(s.failed).map((f) => (typeof f === 'string' ? f : JSON.stringify(f)));
  return { ok: s.ok, failed, durationMs: numberOf(s.duration_ms), commands: s.commands ?? null };
}

/** `failing_on_main` of the last GREEN check stored by the builder step of an attempt (null: no check). */
function failingOnMain(inputs: PostmortemInputs, attempt: number): number | null {
  let found: number | null = null;
  for (const s of stepsOf(inputs, 'builder')) {
    if (s.attempt !== attempt) continue;
    const green = asObject(asObject(detailOf(s).tdd).green);
    const n = numberOf(green.failing_on_main);
    if (n !== null) found = n;
  }
  return found;
}

/** A red `main` step whose stored detail mentions one of the items the smoke failed on. */
function mainNames(inputs: PostmortemInputs, failed: readonly string[]): Row<'build_steps'> | undefined {
  return stepsOf(inputs, 'main').find((s) => {
    if (s.outcome !== 'failed') return false;
    const text = JSON.stringify(detailOf(s));
    return failed.some((f) => f.length > 3 && text.includes(f));
  });
}

/** Mean minutes of the builder steps of the attempts that ran the builder (what a red smoke saved). */
function meanBuilderMinutes(inputs: PostmortemInputs): number | null {
  const byAttempt = new Map<number, number>();
  for (const s of stepsOf(inputs, 'builder')) {
    const ms = numberOf(detailOf(s).duration_ms);
    if (ms !== null) byAttempt.set(s.attempt, (byAttempt.get(s.attempt) ?? 0) + ms);
  }
  if (byAttempt.size === 0) return null;
  return round2([...byAttempt.values()].reduce((a, b) => a + b, 0) / byAttempt.size / 60_000);
}

export const environmentSmoke: Rule = (inputs) => {
  const out: Finding[] = [];
  for (const step of stepsOf(inputs, 'environment')) {
    if (step.outcome !== 'ok' && step.outcome !== 'failed') continue;
    const smoke = smokeOf(step);
    if (!smoke) continue;
    const base = { piece: PIECE, attempt: step.attempt, subject: smoke.failed[0] ?? null } as const;
    const ref = { build_step: step.id, failed: smoke.failed, commands: smoke.commands };
    const min = minutes(smoke.durationMs);
    if (min !== null) out.push({ ...base, finding: 'environment.smoke_cost', class: 'cost', value: min, unit: 'min', evidence: ref });
    const onMain = failingOnMain(inputs, step.attempt);
    if (smoke.ok) {
      if (onMain === null) out.push({ ...base, finding: 'environment.smoke', class: 'info', value: null, unit: null, evidence: { ...ref, green: true } });
      else out.push({ ...base, finding: 'environment.smoke', class: onMain > 0 ? 'fn' : 'tn', ground_truth: 'G05', value: onMain > 0 ? onMain : null, unit: onMain > 0 ? 'tests' : null, evidence: { ...ref, failing_on_main: onMain } });
      continue;
    }
    const later = inputs.steps.filter((s) => s.attempt > step.attempt).map((s) => s.attempt);
    const laterMain = [...new Set(later)].map((a) => ({ attempt: a, n: failingOnMain(inputs, a) })).find((x) => (x.n ?? 0) > 0);
    const main = mainNames(inputs, smoke.failed);
    const text = `${smoke.failed.join('\n')}\n${String(detailOf(step).error ?? '')}`;
    if (laterMain || main) {
      out.push({ ...base, finding: 'environment.smoke', class: 'tp', ground_truth: main ? 'G03' : 'G05', value: 1, unit: 'attempts', evidence: { ...ref, failing_on_main_next: laterMain ?? null, main_step: main?.id ?? null } });
      const saved = meanBuilderMinutes(inputs);
      if (saved !== null) out.push({ ...base, finding: 'environment.smoke_saved', class: 'benefit', ground_truth: 'G11', value: saved, unit: 'min', evidence: ref });
    } else if (ENVIRONMENT_ERROR.test(text)) {
      out.push({ ...base, finding: 'environment.smoke', class: 'fp', ground_truth: 'G05', value: 1, unit: 'attempts', evidence: { ...ref, environment_error: true } });
    } else out.push({ ...base, finding: 'environment.smoke', class: 'info', value: null, unit: null, evidence: { ...ref, undecided: true } });
  }
  return out;
};

/** Whether the environment step found the command that starts the app (§4.6). */
export const environmentStartCommand: Rule = (inputs) =>
  stepsOf(inputs, 'environment')
    .filter((s) => s.outcome === 'ok' || s.outcome === 'failed')
    .map((s): Finding => {
      const d: Json = detailOf(s);
      const command = typeof d.start_command === 'string' && d.start_command.trim() !== '' ? d.start_command : null;
      return { piece: PIECE, finding: 'environment.start_command', class: 'info', attempt: s.attempt, value: command ? 1 : 0, unit: null, subject: command, evidence: { build_step: s.id, found: command !== null } };
    });
