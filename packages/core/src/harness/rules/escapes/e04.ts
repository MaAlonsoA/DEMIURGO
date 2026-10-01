// E04 — a task of a feature was created after the task plan of that feature was already accepted: the plan missed it
// (P7), found while building (P9). The plan is the package of tasks accepted first for the feature (the proposal batch
// of its earliest task); a task from another batch, or made by hand, created later is the escape. Source: task
// records, their `based_on` link to a feature and the proposal that created them.
// esc-2: a task without `covers` is process work (E10), and a task whose criteria all first appeared in a feature
// version created after the plan is the cascade of that later version (E05), not an omission of the plan.

import { type EscapeRule, approvalOf, coversOf, introducedAt, ms, recordById } from "./types.ts";

export const e04: EscapeRule = (i) => {
  const byId = recordById(i);
  const byFdr = new Map<
    string,
    { task_id: string; batch: string; created_at: string }[]
  >();
  const seen = new Set<string>();
  for (const b of i.taskBases) {
    const task = byId.get(b.task_id);
    if (!task || task.type !== "task" || seen.has(`${b.task_id}:${b.fdr_id}`))
      continue;
    seen.add(`${b.task_id}:${b.fdr_id}`);
    const list = byFdr.get(b.fdr_id) ?? [];
    list.push({
      task_id: b.task_id,
      batch: b.batch_id ?? `manual:${b.task_id}`,
      created_at: task.created_at,
    });
    byFdr.set(b.fdr_id, list);
  }
  const covers = coversOf(i);
  const versionCreated = new Map(i.versions.map((v) => [v.id, v]));
  const out = [];
  for (const [fdrId, tasks] of byFdr) {
    const firstSeen = new Map<string, number>();
    for (const c of i.criteria) {
      const v = versionCreated.get(c.record_version_id);
      if (!v || v.record_id !== fdrId) continue;
      firstSeen.set(c.code, Math.min(firstSeen.get(c.code) ?? Infinity, ms(v.created_at)));
    }
    tasks.sort((a, b) => ms(a.created_at) - ms(b.created_at));
    const first = tasks[0];
    if (!first) continue;
    const planEnd = Math.max(
      ...tasks
        .filter((t) => t.batch === first.batch)
        .map((t) => ms(t.created_at)),
    );
    // The plan was approved when its last task was (its earliest approval each).
    const planApprovals = tasks
      .filter((t) => t.batch === first.batch)
      .map((t) => approvalOf(i, t.task_id, null));
    const planApproved = planApprovals.every((a) => a !== null)
      ? planApprovals.reduce<string | null>((m, a) => (m === null || ms(a) > ms(m) ? a : m), null)
      : null;
    for (const t of tasks) {
      if (t.batch === first.batch || ms(t.created_at) <= planEnd) continue;
      const codes = covers.get(t.task_id) ?? [];
      if (codes.length === 0) continue;
      if (codes.every((c) => (firstSeen.get(c) ?? 0) > planEnd)) continue;
      out.push({
        rule: "E04",
        introduced_phase: "P7" as const,
        found_phase: "P9" as const,
        record_code: byId.get(t.task_id)?.code ?? null,
        subject: byId.get(fdrId)?.code ?? null,
        evidence: {
          task_id: t.task_id,
          feature_id: fdrId,
          plan_batch: first.batch,
          task_batch: t.batch,
          ...introducedAt(planApproved),
        },
        occurred_at: t.created_at,
        key: `${fdrId}:${t.task_id}`,
      });
    }
  }
  return out;
};
