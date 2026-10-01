// E07 — a task put on hold: something the design should have foreseen (a deployment, a person's account, a decision)
// stopped it (P7), found while building (P9). Source: task_holds. Released holds count too: the wait happened.

import { type EscapeRule, recordById } from "./types.ts";

export const e07: EscapeRule = (i) => {
  const byId = recordById(i);
  return i.holds.map((h) => ({
    rule: "E07",
    introduced_phase: "P7" as const,
    found_phase: "P9" as const,
    record_code: byId.get(h.task_id)?.code ?? null,
    subject: h.reason,
    evidence: { task_hold_id: h.id, released: h.released_at !== null },
    occurred_at: h.held_at,
    key: h.id,
  }));
};
