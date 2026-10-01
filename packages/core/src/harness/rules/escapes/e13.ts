// E13 — a stale build request: a new base (task and feature versions) was adopted after the first attempt, so the task
// or its feature changed while it was being built (P7 → P9). Source: build_request_bases with attempt > 1.

import { type EscapeRule, requestTaskCode } from "./types.ts";

export const e13: EscapeRule = (i) => {
  const taskCode = requestTaskCode(i);
  return i.bases
    .filter((b) => b.attempt > 1)
    .map((b) => ({
      rule: "E13",
      introduced_phase: "P7" as const,
      found_phase: "P9" as const,
      record_code: taskCode.get(b.build_request_id) || null,
      build_request_id: b.build_request_id,
      subject: `attempt ${b.attempt}`,
      evidence: { build_request_base_id: b.id, attempt: b.attempt },
      occurred_at: b.adopted_at,
      key: b.id,
    }));
};
