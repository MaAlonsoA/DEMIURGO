// Queue rules (B01–B03): what the queue decided about this task against what really happened.
// `queue.skip_vs_footprint`: a skip (the task waited for another) judged by the real files of both tasks (G01).
// `queue.parallel_conflict`: tasks that ran at the same time without a skip between them, judged by real conflicts (G02).
// `queue.slot_idle`: minutes a build slot stood free while this task waited, by cause (salud-del-harness §6.1).
// The decision rows come from `queue_decisions` / `queue_plans`: without them the first and the third say nothing.
// Windows and minutes are read from stored timestamps; nothing here reads a clock.

import { isSchemaFile } from '../../build/schema-risk.ts';
import type { ConcurrentRequest, QueueDecisionRow } from '../postmortem.ts';
import { minutesBetween, ms, objectOf, realFilesOf } from './common.ts';
import type { Finding, Rule } from './index.ts';

const WAIT_DECISIONS = ['wait_module', 'wait_schema', 'wait_feature_busy'] as const;

const shared = (a: readonly string[], b: readonly string[]): string[] => {
  const other = new Set(b);
  return [...new Set(a)].filter((f) => other.has(f)).sort();
};

type Span = { key: string; decision: string; item: string | null; with_task: string; rows: QueueDecisionRow[]; end: Date | string };

/** Consecutive rows of the same wait (decision, item, waited task) as one span that ends at the next different row. */
function waitSpans(rows: readonly QueueDecisionRow[]): Span[] {
  const sorted = [...rows].sort((a, b) => ms(a.decided_at) - ms(b.decided_at) || (a.id < b.id ? -1 : 1));
  const spans: Span[] = [];
  let open: Span | null = null;
  for (const row of sorted) {
    const wait = (WAIT_DECISIONS as readonly string[]).includes(row.decision) && row.with_task;
    const key = wait ? `${row.decision}|${row.item ?? ''}|${row.with_task}` : '';
    if (open && open.key === key) {
      open.rows.push(row);
      open.end = row.decided_at;
      continue;
    }
    if (open) open.end = row.decided_at;
    open = wait ? { key, decision: row.decision, item: row.item, with_task: row.with_task as string, rows: [row], end: row.decided_at } : null;
    if (open) spans.push(open);
  }
  return spans;
}

export const queueSkipVsFootprint: Rule = (inputs) => {
  const mine = realFilesOf(inputs.steps);
  if (!mine || !inputs.queueDecisions || inputs.queueDecisions.length === 0) return [];
  const out: Finding[] = [];
  for (const span of waitSpans(inputs.queueDecisions)) {
    const theirs = inputs.waitedFiles?.[span.with_task];
    if (!theirs) continue; // the waited task was never merged: nothing says what it touched
    if (span.decision === 'wait_feature_busy') {
      // One feature at a time is a policy (B01), not a collision prediction: it is judged on its own, against the real files of both tasks.
      const common = shared(mine, theirs);
      const subject = `${inputs.taskCode}~${span.with_task}`;
      const evidence = { decisions: span.rows.map((r) => r.id), decision: span.decision, item: span.item, with_task: span.with_task, shared_files: common };
      out.push({ piece: 'B01', finding: 'queue.feature_busy', class: common.length > 0 ? 'tp' : 'fp', ground_truth: 'G01', subject, evidence });
      continue;
    }
    const common =
      span.decision === 'wait_schema'
        ? mine.some(isSchemaFile) && theirs.some(isSchemaFile)
          ? [...new Set([...mine.filter(isSchemaFile), ...theirs.filter(isSchemaFile)])].sort()
          : []
        : shared(mine, theirs);
    const subject = `${inputs.taskCode}~${span.with_task}`;
    const evidence = { decisions: span.rows.map((r) => r.id), decision: span.decision, item: span.item, with_task: span.with_task, shared_files: common };
    out.push({ piece: 'B03', finding: 'queue.skip_vs_footprint', class: common.length > 0 ? 'tp' : 'fp', ground_truth: 'G01', subject, evidence });
    out.push({
      piece: 'B03',
      finding: 'queue.skip_vs_footprint',
      class: 'cost',
      ground_truth: 'G01',
      value: minutesBetween(span.rows[0]!.decided_at, span.end),
      unit: 'min',
      subject,
      evidence,
    });
  }
  return out;
};

// ---------------------------------------------------------------------------------------------------------------

type StepRow = ConcurrentRequest['steps'][number];

/** A step that records a real conflict, with the conflicting files when it names them (G02). `steps` are the steps of the same request. */
function conflictOf(step: StepRow, steps: readonly StepRow[]): { files: string[] } | null {
  const d = objectOf(step.detail);
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  if (step.stage === 'worktree' && list(d.conflicts).length > 0) return { files: list(d.conflicts) };
  if (step.stage === 'commit' && step.outcome === 'failed' && list(d.conflicts).length > 0) return { files: list(d.conflicts) };
  if (step.stage === 'merge' && step.outcome === 'changes_requested' && d.conflict === true) {
    // The merge step does not always name the files: the `worktree` step that follows it does (it rebases onto main).
    const named = list(d.conflict_files);
    if (named.length > 0) return { files: named };
    const next = steps.find((x) => x.stage === 'worktree' && ms(x.created_at) >= ms(step.created_at) && list(objectOf(x.detail).conflicts).length > 0);
    return { files: next ? list(objectOf(next.detail).conflicts) : [] };
  }
  if (step.stage === 'merge' && step.outcome === 'waiting' && d.recheck === true && (d.reason === 'conflict' || d.reason === 'same_file')) return { files: list(d.shared_files) };
  return null;
}

const MIGRATION_NUMBER = /(^|\/)migrations\/(\d+)_[^/]+$/;
const migrationNumbers = (files: readonly string[]): Map<string, string> => {
  const out = new Map<string, string>();
  for (const f of files) {
    const m = MIGRATION_NUMBER.exec(f);
    if (m) out.set(m[2]!, f);
  }
  return out;
};

/**
 * The steps that make a request «run»: from its first step to its merge (or its last step when it never merged),
 * without `footprint` and `main`, which are written after the merge (some hours later) and would stretch the window.
 */
export function activeSteps<T extends { stage: string; outcome: string }>(steps: readonly T[]): T[] {
  const live = steps.filter((s) => s.stage !== 'footprint' && s.stage !== 'main');
  const merged = live.findIndex((s) => s.stage === 'merge' && s.outcome === 'ok');
  return merged >= 0 ? live.slice(0, merged + 1) : live;
}

const windowOf = (steps: readonly { created_at: unknown }[]): [number, number] | null => (steps.length === 0 ? null : [ms(steps[0]!.created_at), ms(steps.at(-1)!.created_at)]);

type Party = { requestId: string; taskCode: string; steps: StepRow[]; active: StepRow[]; window: [number, number]; files: string[] | null; mergedAt: number | null };

const partyOf = (requestId: string, taskCode: string, steps: StepRow[]): Party | null => {
  const active = activeSteps(steps);
  const window = windowOf(active);
  if (!window) return null;
  const merge = active.find((s) => s.stage === 'merge' && s.outcome === 'ok');
  return { requestId, taskCode, steps, active, window, files: realFilesOf(steps), mergedAt: merge ? ms(merge.created_at) : null };
};

export const queueParallelConflict: Rule = (inputs) => {
  const me = partyOf(inputs.request.id, inputs.taskCode, inputs.steps);
  if (!me) return [];
  const others = (inputs.concurrent ?? [])
    .filter((o) => o.requestId !== inputs.request.id && o.taskCode !== inputs.taskCode) // a request is never paired with itself or with its task's other requests
    .map((o) => partyOf(o.requestId, o.taskCode, o.steps))
    .filter((o): o is Party => o !== null);
  const everyone = [me, ...others];
  const out: Finding[] = [];
  for (const other of others) {
    const theirs = other.window;
    // The pair is judged once, by the post-mortem of the request that started later.
    if (me.window[0] < theirs[0] || (me.window[0] === theirs[0] && inputs.request.id < other.requestId)) continue;
    const from = Math.max(me.window[0], theirs[0]);
    const to = Math.min(me.window[1], theirs[1]);
    if (from > to) continue;
    const both = me.files && other.files ? shared(me.files, other.files) : [];
    const subject = `${inputs.taskCode}~${other.taskCode}`;

    // A conflict step belongs to ONE pair: the request that merged most recently before it, among the running ones, whose files
    // cross the conflict's. The step of a request is met while it runs, or after the other merged (git sees the conflict with main).
    const hits = [me, other].flatMap((owner) => {
      const counterpart = owner === me ? other : me;
      return owner.active.flatMap((s) => {
        const c = conflictOf(s, owner.steps);
        if (!c) return [];
        const t = ms(s.created_at);
        const inOverlap = t >= from && t <= to;
        const afterMerge = counterpart.mergedAt !== null && counterpart.mergedAt <= t && t >= from;
        if (!inOverlap && !afterMerge) return [];
        return [{ s, owner, counterpart, c }];
      });
    });
    const attributed = hits.filter((h) => {
      const crosses = (p: Party): boolean => (h.c.files.length > 0 ? p.files !== null && shared(h.c.files, p.files).length > 0 : both.length > 0);
      if (!crosses(h.counterpart)) return false;
      const t = ms(h.s.created_at);
      const rivals = everyone.filter((p) => p !== h.owner && p.window[0] <= t && crosses(p));
      const merged = rivals.filter((p) => p.mergedAt !== null && p.mergedAt <= t).sort((a, b) => (b.mergedAt as number) - (a.mergedAt as number) || (a.requestId < b.requestId ? -1 : 1));
      const winner = merged[0] ?? [...rivals].sort((a, b) => (a.requestId < b.requestId ? -1 : 1))[0];
      return winner === h.counterpart;
    });

    // The latent conflict git cannot see: two migrations with the same number.
    const mineNumbers = migrationNumbers(me.files ?? []);
    const latent = [...migrationNumbers(other.files ?? [])].filter(([n, path]) => mineNumbers.has(n) && mineNumbers.get(n) !== path).map(([n]) => n);

    const overlap = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
    if (attributed.length > 0 || latent.length > 0) {
      const evidence = { requests: [inputs.request.id, other.requestId], overlap, conflict_steps: attributed.map((h) => h.s.id), shared_files: both, migration_numbers: latent };
      out.push({ piece: 'B03', finding: 'queue.parallel_conflict', class: 'fn', ground_truth: 'G02', subject, evidence });
      if (attributed.length > 0) {
        // Latency of the conflict: from its first step to the merge of the request that met it (or its last step). One per pair.
        const first = attributed.reduce((a, b) => (ms(a.s.created_at) <= ms(b.s.created_at) ? a : b));
        const end = first.owner.active.filter((s) => s.stage === 'merge' && s.outcome === 'ok').at(-1) ?? first.owner.active.at(-1)!;
        out.push({ piece: 'B03', finding: 'queue.parallel_conflict', class: 'cost', ground_truth: 'G02', value: minutesBetween(first.s.created_at, end.created_at), unit: 'min', subject, evidence });
      }
    } else if (hits.length === 0 || (me.files && other.files)) {
      out.push({ piece: 'B03', finding: 'queue.parallel_conflict', class: 'tn', ground_truth: 'G02', subject, evidence: { requests: [inputs.request.id, other.requestId], overlap, shared_files: both } });
    }
  }
  return out;
};

// ---------------------------------------------------------------------------------------------------------------

export const queueSlotIdle: Rule = (inputs) => {
  const plans = [...(inputs.queuePlans ?? [])].sort((a, b) => ms(a.decided_at) - ms(b.decided_at) || (a.id < b.id ? -1 : 1));
  if (plans.length < 2) return [];
  const decisionAt = new Map((inputs.queueDecisions ?? []).map((d) => [d.plan_id, d.decision]));
  const causes = new Map<string, { candidate: number; build: number; plans: string[] }>();
  for (let i = 0; i + 1 < plans.length; i++) {
    const plan = plans[i]!;
    const free = Math.max(0, plan.parallel_limit - plan.running.length - plan.started.length);
    if (free === 0) continue;
    const decision = decisionAt.get(plan.id);
    const cause = plan.stopped_kind ? 'stopped' : decision && decision.startsWith('wait_') ? decision : null;
    if (!cause) continue; // nothing stored says why the slot stood free
    const dt = minutesBetween(plan.decided_at, plans[i + 1]!.decided_at);
    const acc = causes.get(cause) ?? { candidate: 0, build: 0, plans: [] };
    acc.candidate += dt;
    acc.build += dt * free;
    acc.plans.push(plan.id);
    causes.set(cause, acc);
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  return [...causes.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .flatMap(([cause, v]): Finding[] => [
      { piece: 'B01', finding: 'queue.slot_idle', class: 'cost', ground_truth: 'G07', value: round(v.build), unit: 'min', subject: `${cause}/build_min`, evidence: { plans: v.plans, cause } },
      { piece: 'B01', finding: 'queue.slot_idle', class: 'cost', ground_truth: 'G07', value: round(v.candidate), unit: 'min', subject: `${cause}/candidate_min`, evidence: { plans: v.plans, cause, task: inputs.taskCode } },
    ]);
};


// ---------------------------------------------------------------------------------------------------------------

/**
 * B04 `queue.testability_wait`: minutes this task was ready and held for a testability decision (`wait_testability`: a
 * criterion that needs the real deployment or an unbuilt feature) while a build slot stood free. The cost of the gate;
 * whether the hold was right is judged elsewhere (judgment outcomes). Each plan counts until the next plan, the last
 * one until the task started (first step). A task never held says nothing.
 */
export const queueTestabilityWait: Rule = (inputs) => {
  const plans = [...(inputs.queuePlans ?? [])].sort((a, b) => ms(a.decided_at) - ms(b.decided_at) || (a.id < b.id ? -1 : 1));
  const holds = new Map<string, QueueDecisionRow>();
  for (const d of inputs.queueDecisions ?? []) if (d.decision === 'wait_testability') holds.set(d.plan_id, d);
  if (holds.size === 0) return [];
  const startedAt = inputs.steps[0]?.created_at ?? null;
  let waited = 0;
  let freeSlot = 0;
  let freeBuild = 0;
  const used: string[] = [];
  for (let i = 0; i < plans.length; i++) {
    const plan = plans[i]!;
    const hold = holds.get(plan.id);
    if (!hold) continue;
    const end = plans[i + 1]?.decided_at ?? startedAt;
    if (end === null) continue;
    const dt = minutesBetween(plan.decided_at, end);
    const free = Math.max(0, plan.parallel_limit - plan.running.length - plan.started.length);
    waited += dt;
    if (free > 0) {
      freeSlot += dt;
      freeBuild += dt * free;
    }
    used.push(plan.id);
  }
  const round = (n: number) => Math.round(n * 10) / 10;
  const criteria = [...new Set([...holds.values()].map((d) => d.item).filter((c): c is string => !!c))].sort();
  return [
    {
      piece: 'B04',
      finding: 'queue.testability_wait',
      class: 'cost',
      ground_truth: 'G07',
      value: round(freeSlot),
      unit: 'min',
      subject: inputs.taskCode,
      evidence: { decisions: [...holds.values()].map((d) => d.id), plans: used, criteria, waited_min: round(waited), free_slot_min: round(freeSlot), free_build_min: round(freeBuild) },
    },
  ];
};
