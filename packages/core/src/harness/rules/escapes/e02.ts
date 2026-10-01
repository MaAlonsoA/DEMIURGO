// E02 — the build escalated to the person: the merge gate asked for changes and either the retries ran out
// (`needs_you`, with `tried`) or the review itself said a person must decide (`escalated: needs_person`). The task was
// not buildable as written (P7); found at the review (P10). Source: build_steps stage merge, outcome changes_requested.

import { type EscapeRule, approvalOf, introducedAt, requestTaskCode } from "./types.ts";

export const e02: EscapeRule = (i) => {
  const taskCode = requestTaskCode(i);
  const taskOf = new Map(i.requests.map((r) => [r.id, r.task_id]));
  const out = [];
  for (const s of i.steps) {
    if (s.stage !== "merge" || s.outcome !== "changes_requested") continue;
    if (s.detail.needs_you !== true && s.detail.escalated !== "needs_person")
      continue;
    out.push({
      rule: "E02",
      introduced_phase: "P7" as const,
      found_phase: "P10" as const,
      record_code: taskCode.get(s.build_request_id) || null,
      build_request_id: s.build_request_id,
      subject:
        s.detail.escalated === "needs_person"
          ? "needs_person"
          : "retries_exhausted",
      evidence: {
        build_step_id: s.id,
        attempt: s.attempt,
        tried: s.detail.tried ?? null,
        ...introducedAt(approvalOf(i, taskOf.get(s.build_request_id) ?? "", s.created_at)),
      },
      occurred_at: s.created_at,
      key: s.id,
    });
  }
  return out;
};
