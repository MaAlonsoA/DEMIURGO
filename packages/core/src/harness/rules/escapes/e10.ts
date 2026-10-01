// E10 — DEMIURGO's own work slipped in as a product task: a task with no `task_covers` codes and no `based_on` link to
// a feature (the «technical» tasks of the queue). It came from the process, not from the path (P0), and shows at the
// task stage (P7). Source: task records, task_covers and links.

import { type EscapeRule } from "./types.ts";

export const e10: EscapeRule = (i) => {
  const covered = new Set(
    i.covers.filter((c) => c.codes.length > 0).map((c) => c.record_id),
  );
  const based = new Set(i.taskBases.map((b) => b.task_id));
  return i.records
    .filter((r) => r.type === "task" && !covered.has(r.id) && !based.has(r.id))
    .map((r) => ({
      rule: "E10",
      introduced_phase: "P0" as const,
      found_phase: "P7" as const,
      record_code: r.code,
      subject: r.code,
      evidence: { task_id: r.id },
      occurred_at: r.created_at,
      key: r.id,
    }));
};
