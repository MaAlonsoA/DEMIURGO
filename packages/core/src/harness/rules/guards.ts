// Rules over the builder's own failures and the guards between the builder and the push (pm-5), from the stored steps:
// - `design.guard` (B13 design system, B14 ownership, B15 duplicate tests): each failed `design` step, judged by what the
//   next attempts did with what it flagged. Convención nuestra: no published standard says when a guard was right; the
//   proxy is whether a later commit changed the flagged files (tp, the guard made the builder fix something) or the task
//   merged with them as they were (fp, the flagged thing was kept: an exemption or a wrong reading, as MYA-018, which
//   replaced `route.ts` by `page.tsx` in the same segment). Ownership by path is CODEOWNERS (GitHub) / OWNERS (Google),
//   as `build/ownership.ts` cites; «the owner is the feature that created it» is convención nuestra.
// - `builder.failure_class` (B22): each failed builder step with its `failure_kind` and whether the next attempt began by
//   itself or needed the person (the minutes the person took are a cost).
// - `test_reuse.follow` (B08): of the tests the builder was told to extend, which did a commit of that attempt touch.
// All pure: they read stored timestamps and rows, never a clock.

import type { Row } from '../../db/schema.ts';
import { type Json, asArray, asObject, commitFiles, detailOf, normalPath, stepsOf } from './builder-detail.ts';
import { minutesBetween, ms } from './common.ts';
import type { Finding, Rule } from './index.ts';

type Step = Row<'build_steps'>;

/** Steps of an attempt that count as «running»: `footprint` and `main` are written hours after the merge. */
const liveSteps = (steps: readonly Step[], attempt: number): Step[] => steps.filter((s) => s.attempt === attempt && s.stage !== 'footprint' && s.stage !== 'main');
const endOf = (steps: readonly Step[]): Step | undefined => steps.reduce<Step | undefined>((a, s) => (a === undefined || ms(s.created_at) >= ms(a.created_at) ? s : a), undefined);
const strings = (v: unknown): string[] => asArray(v).filter((x): x is string => typeof x === 'string');

type Flag = { piece: 'B13' | 'B14' | 'B15'; paths: string[]; items: string[] };

/** What a failed design step flagged, split by guard. */
function flagsOf(d: Json): Flag[] {
  const out: Flag[] = [];
  const violations = asArray(d.violations).map(asObject);
  if (violations.length > 0) out.push({ piece: 'B13', paths: strings(violations.map((v) => v.path)).map(normalPath), items: violations.map((v) => `rule ${String(v.rule)}: ${String(v.path)}:${String(v.line ?? '')}`) });
  const ownership = asArray(d.ownership).map(asObject);
  if (ownership.length > 0) out.push({ piece: 'B14', paths: [], items: ownership.map((o) => `${String(o.kind)}:${String(o.name)}`) });
  const guard = asObject(d.test_guard);
  if (typeof guard.violations === 'number' && guard.violations > 0) out.push({ piece: 'B15', paths: [], items: [`${guard.violations} duplicate tests`] });
  return out;
}

/** The guard text a failed design step flagged (the items of every flag), to tell «the same again» from «something else». */
const flagText = (step: Step, piece: Flag['piece']): string => flagsOf(detailOf(step)).filter((f) => f.piece === piece).flatMap((f) => f.items).sort().join('\n');

export const designGuard: Rule = (inputs) => {
  const out: Finding[] = [];
  for (const step of stepsOf(inputs, 'design')) {
    if (step.outcome !== 'failed') continue;
    // The next `design` step of the request after this one (the guard run again): did it pass, or say the same?
    const nextDesign = stepsOf(inputs, 'design').find((s) => s.attempt > step.attempt || (s.attempt === step.attempt && ms(s.created_at) > ms(step.created_at)));
    const later = inputs.steps.filter((s) => s.attempt > step.attempt);
    const next = later.filter((s) => s.attempt === step.attempt + 1);
    const commits = later.filter((s) => s.stage === 'commit' && s.outcome === 'ok');
    const touched = new Set(commits.flatMap(commitFiles));
    const merged = inputs.request.state === 'done';
    const stopped = next.length > 0 ? minutesBetween(step.created_at, next[0]!.created_at) : null;
    for (const flag of flagsOf(detailOf(step))) {
      // With the flagged paths known (design system) the proxy is whether a later commit touched one; otherwise (ownership,
      // duplicate tests) whether the builder committed anything after the guard stopped it.
      const changed = flag.paths.length > 0 ? flag.paths.some((p) => touched.has(p)) : commits.length > 0;
      // pm-8, convención nuestra: a true positive only when the next `design` step passes (the builder fixed what the guard
      // flagged); the same text again is `repeat` (the guard did not get the builder to fix anything: it is not a hit and
      // it is not judged as a false positive either), a different one is `other`; no next step: nothing says yet (`info`).
      const nextPassed = nextDesign !== undefined && nextDesign.outcome !== 'failed';
      const repeats = nextDesign !== undefined && nextDesign.outcome === 'failed' && flagText(nextDesign, flag.piece) === flagText(step, flag.piece) && flagText(step, flag.piece) !== '';
      const verdict = nextDesign === undefined ? 'info' : nextPassed ? (merged && !changed && flag.paths.length > 0 ? 'fp' : 'tp') : repeats ? 'repeat' : 'info';
      const cls = verdict === 'tp' ? ('tp' as const) : verdict === 'fp' ? ('fp' as const) : ('info' as const);
      const evidence = { build_step: step.id, violations: flag.items, paths: flag.paths, changed_by_later_commit: changed, merged, next_attempt: next.length > 0 ? step.attempt + 1 : null, next_design: nextDesign ? { build_step: nextDesign.id, outcome: nextDesign.outcome } : null, ...(verdict === 'repeat' ? { repeat: true } : {}) };
      const base = { piece: flag.piece, finding: 'design.guard', ground_truth: null, attempt: step.attempt, subject: verdict === 'repeat' ? 'repeat' : inputs.taskCode, evidence };
      out.push({ ...base, class: cls, value: flag.items.length, unit: null });
      if (stopped !== null) out.push({ ...base, class: 'cost', value: stopped, unit: 'min' });
    }
  }
  return out;
};

export const builderFailureClass: Rule = (inputs) => {
  const out: Finding[] = [];
  for (const step of stepsOf(inputs, 'builder')) {
    if (step.outcome !== 'failed') continue;
    const d = detailOf(step);
    const kind = typeof d.failure_kind === 'string' ? d.failure_kind : 'unknown';
    const nextAttempt = step.attempt + 1;
    const next = liveSteps(inputs.steps, nextAttempt);
    const started = next.find((s) => s.stage === 'repo') ?? next[0];
    const automatic = started ? asObject(started.detail).automatic === true : null;
    const nextOk = next.length === 0 ? null : next.some((s) => s.stage === 'builder' && s.outcome === 'ok') || inputs.steps.some((s) => s.attempt >= nextAttempt && s.stage === 'merge' && s.outcome === 'ok');
    const ended = endOf(liveSteps(inputs.steps, step.attempt));
    const personMin = started && automatic === false && ended ? minutesBetween(ended.created_at, started.created_at) : null;
    out.push({
      piece: 'B22',
      finding: 'builder.failure_class',
      class: personMin !== null ? 'cost' : 'info',
      ground_truth: null,
      value: personMin,
      unit: personMin === null ? null : 'min',
      subject: kind,
      attempt: step.attempt,
      evidence: { build_step: step.id, failure_kind: kind, next: started ? (automatic ? 'automatic' : 'person') : 'none', next_attempt: started ? nextAttempt : null, next_ok: nextOk, person_wait_min: personMin },
    });
  }
  return out;
};

export const testReuseFollow: Rule = (inputs) => {
  const out: Finding[] = [];
  for (const step of stepsOf(inputs, 'builder')) {
    const reuse = asArray(detailOf(step).test_reuse).map(asObject).filter((r) => typeof r.path === 'string');
    if (reuse.length === 0) continue;
    const commits = stepsOf(inputs, 'commit').filter((s) => s.attempt === step.attempt && s.outcome === 'ok');
    if (commits.length === 0) continue; // nothing was committed: nothing says the suggestion was followed or not
    const touched = new Set(commits.flatMap(commitFiles));
    // pm-8: one row per (attempt, file), not per suggested test (several suggestions point at the same spec file).
    const byPath = new Map<string, Json[]>();
    for (const r of reuse) byPath.set(normalPath(r.path as string), [...(byPath.get(normalPath(r.path as string)) ?? []), r]);
    for (const [path, list] of byPath) {
      const followed = touched.has(path);
      const ps = list.map((r) => r.p).filter((p): p is number => typeof p === 'number');
      const criteria = list.map((r) => r.criterion).filter((c): c is string => typeof c === 'string');
      out.push({ piece: 'B08', finding: 'test_reuse.follow', class: followed ? 'tp' : 'fp', ground_truth: null, value: ps.length > 0 ? Math.max(...ps) : null, unit: null, subject: path, attempt: step.attempt, evidence: { build_step: step.id, criterion: criteria[0] ?? null, criteria, followed } });
    }
  }
  return out;
};
