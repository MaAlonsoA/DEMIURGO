// E10 — DEMIURGO's own work slipped in as a product task: a task based on a feature (FDR) that covers none of its
// criteria and reached the build queue (a task that was never requested is a design draft, not a slip). It came from the process, not from the path (P0), and shows at the task stage (P7). esc-2, inverted: a
// task based on a definition, a requirement or a decision (DEF/NFR/ADR) with no `covers` is a legitimate enabler (SAFe
// «enabler» work; our convention) and is not an escape. Source: task records, task_covers and `based_on` links.

import { type EscapeRule, coversOf, recordById } from "./types.ts";

export const e10: EscapeRule = (i) => {
  const covers = coversOf(i);
  const byId = recordById(i);
  const featureBased = new Set(
    i.links
      .filter(
        (l) =>
          l.type === "based_on" &&
          byId.get(l.from_record_id)?.type === "task" &&
          l.to_type === "fdr",
      )
      .map((l) => l.from_record_id),
  );
  for (const b of i.taskBases) featureBased.add(b.task_id);
  const built = new Set(i.requests.map((r) => r.task_id));
  return i.records
    .filter(
      (r) =>
        r.type === "task" &&
        built.has(r.id) &&
        (covers.get(r.id) ?? []).length === 0 &&
        featureBased.has(r.id),
    )
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
