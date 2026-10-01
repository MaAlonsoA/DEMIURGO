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

/** A step that records a real conflict, with the conflicting files when it names them (G02). */
function conflictOf(step: StepRow): { files: string[] } | null {
  const d = objectOf(step.detail);
  const list = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  if (step.stage === 'worktree' && list(d.conflicts).length > 0) return { files: list(d.conflicts) };
  if (step.stage === 'commit' && step.outcome === 'failed' && list(d.conflicts).length > 0) return { files: list(d.conflicts) };
  if (step.stage === 'merge' && step.outcome === 'changes_requested' && d.conflict === true) return { files: list(d.conflict_files) };
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

const windowOf = (steps: readonly { created_at: unknown }[]): [number, number] | null => (steps.length === 0 ? null : [ms(steps[0]!.created_at), ms(steps.at(-1)!.created_at)]);

export const queueParallelConflict: Rule = (inputs) => {
  const mineSteps = inputs.steps;
  const mine = windowOf(mineSteps);
  if (!mine) return [];
  const myFiles = realFilesOf(mineSteps);
  const out: Finding[] = [];
  for (const other of inputs.concurrent ?? []) {
    const theirs = windowOf(other.steps);
    if (!theirs) continue;
    // The pair is judged once, by the post-mortem of the request that started later.
    if (mine[0] < theirs[0] || (mine[0] === theirs[0] && inputs.request.id < other.requestId)) continue;
    const from = Math.max(mine[0], theirs[0]);
    const to = Math.min(mine[1], theirs[1]);
    if (from > to) continue;
    const theirFiles = realFilesOf(other.steps);
    const both = myFiles && theirFiles ? shared(myFiles, theirFiles) : [];
    const subject = `${inputs.taskCode}~${other.taskCode}`;

    // Conflicts met by either request while both were running.
    const hits = [
      ...mineSteps.map((s) => ({ s, owner: inputs.request.id, rest: theirFiles, c: conflictOf(s) })),
      ...other.steps.map((s) => ({ s, owner: other.requestId, rest: myFiles, c: conflictOf(s) })),
    ].filter((h) => h.c && ms(h.s.created_at) >= from && ms(h.s.created_at) <= to);
    const attributed = hits.filter((h) => h.c!.files.length > 0 ? h.rest !== null && shared(h.c!.files, h.rest).length > 0 : both.length > 0);

    // The latent conflict git cannot see: two migrations with the same number.
    const mineNumbers = migrationNumbers(myFiles ?? []);
    const latent = [...migrationNumbers(theirFiles ?? [])].filter(([n, path]) => mineNumbers.has(n) && mineNumbers.get(n) !== path).map(([n]) => n);

    const overlap = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
    if (attributed.length > 0 || latent.length > 0) {
      const evidence = { requests: [inputs.request.id, other.requestId], overlap, conflict_steps: attributed.map((h) => h.s.id), shared_files: both, migration_numbers: latent };
      out.push({ piece: 'B03', finding: 'queue.parallel_conflict', class: 'fn', ground_truth: 'G02', subject, evidence });
      if (attributed.length > 0) {
        // Latency of the conflict: from its first step to the merge of the request that met it (or its last step).
        const first = attributed.reduce((a, b) => (ms(a.s.created_at) <= ms(b.s.created_at) ? a : b));
        const steps = first.owner === inputs.request.id ? mineSteps : other.steps;
        const end = steps.filter((s) => s.stage === 'merge' && s.outcome === 'ok').at(-1) ?? steps.at(-1)!;
        out.push({ piece: 'B03', finding: 'queue.parallel_conflict', class: 'cost', ground_truth: 'G02', value: minutesBetween(first.s.created_at, end.created_at), unit: 'min', subject, evidence });
      }
    } else if (hits.length === 0 || (myFiles && theirFiles)) {
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

