// E04 — a task of a feature was created after the task plan of that feature was already accepted: the plan missed it
// (P7), found while building (P9). The plan is the package of tasks accepted first for the feature (the proposal batch
// of its earliest task); a task from another batch, or made by hand, created later is the escape. Source: task
// records, their `based_on` link to a feature and the proposal that created them.

import { type EscapeRule, ms, recordById } from "./types.ts";

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
  const out = [];
  for (const [fdrId, tasks] of byFdr) {
    tasks.sort((a, b) => ms(a.created_at) - ms(b.created_at));
    const first = tasks[0];
    if (!first) continue;
    const planEnd = Math.max(
      ...tasks
        .filter((t) => t.batch === first.batch)
        .map((t) => ms(t.created_at)),
    );
    for (const t of tasks) {
      if (t.batch === first.batch || ms(t.created_at) <= planEnd) continue;
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
        },
        occurred_at: t.created_at,
        key: `${fdrId}:${t.task_id}`,
      });
    }
  }
  return out;
};
