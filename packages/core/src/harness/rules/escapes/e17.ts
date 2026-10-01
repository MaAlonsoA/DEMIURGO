// E17 — the queue held a task for testability (`queue_decisions.decision = 'wait_testability'`: the testability check
// found a criterion that cannot be checked automatically as written, e.g. it needs the deployed candidate or a feature
// that is not built). That is a P5 error caught before building: a contained escape at P5 (found at P7, the plan/queue
// stage), one per (task, criterion). If the same criterion later escapes (E01/E07/E08 share its `defect_key`), the
// containment counts the defect once and as escaped. Convención nuestra: the hold is the catch; no stored decision
// says the person agreed, so «caught» means the system flagged it, not that it was fixed.

import type { Esc4Inputs } from "./esc4.ts";
import { type Escape, type EscapeRule, criterionApprovalAt, introducedAt, ms } from "./types.ts";

export const e17: EscapeRule = (inputs) => {
  const i = inputs as Esc4Inputs;
  const byTask = new Map(i.records.filter((r) => r.type === "task").map((r) => [r.code, r]));
  const rows = new Map<string, Escape>();
  const ordered = [...(i.queueDecisions ?? [])].sort((a, b) => ms(a.decided_at) - ms(b.decided_at));
  for (const d of ordered) {
    const codes = d.criteria.length > 0 ? d.criteria : d.item ? [d.item] : [];
    for (const criterion of codes.length > 0 ? codes : [null]) {
      const key = `${d.task_code}:${criterion ?? "task"}`;
      if (rows.has(key)) continue;
      rows.set(key, {
        rule: "E17",
        introduced_phase: "P5",
        found_phase: "P7",
        record_code: d.task_code,
        criterion_code: criterion,
        subject: "wait_testability",
        evidence: {
          contained: true,
          defect_key: criterion ? `ac:${criterion}` : `task:${d.task_code}`,
          first_decision_at: d.decided_at,
          ...introducedAt(
            criterionApprovalAt(i, criterion, d.decided_at) ?? (byTask.get(d.task_code)?.created_at ?? null),
          ),
        },
        occurred_at: d.decided_at,
        key,
      });
    }
  }
  return [...rows.values()];
};
