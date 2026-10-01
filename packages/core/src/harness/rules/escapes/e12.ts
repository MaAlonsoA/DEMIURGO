// E12 — a build request withdrawn, with its reason when the journal kept one. The class of the reason (duplicate,
// deployment, new version, accidental click) is for the person reading the list: it is operation as often as design.
// esc-2: the class of the reason is recorded (`reason_class`: duplicate, deployment, new_version, other) and a missing
// or generic reason is flagged (`reason_missing`: the journal could not classify it). Attributed to the build phase (P9 → P9). Source: build_requests state withdrawn and the `withdraw` step's reason.

import { type EscapeRule, requestTaskCode } from "./types.ts";

const GENERIC = /^the build request was withdrawn\.?$/i;
const classOf = (reason: string | null): string | null =>
  !reason || GENERIC.test(reason.trim())
    ? null
    : /duplicate|already (built|merged)/i.test(reason)
      ? "duplicate"
      : /deploy|vercel|neon|environment/i.test(reason)
        ? "deployment"
        : /new version|replan|re-plan|scope/i.test(reason)
          ? "new_version"
          : "other";

export const e12: EscapeRule = (i) => {
  const taskCode = requestTaskCode(i);
  const reason = new Map<string, { reason: string | null; step: string }>();
  for (const s of i.steps)
    if (s.stage === "withdraw")
      reason.set(s.build_request_id, {
        reason: typeof s.detail.reason === "string" ? s.detail.reason : null,
        step: s.id,
      });
  return i.requests
    .filter((r) => r.state === "withdrawn")
    .map((r) => ({
      rule: "E12",
      introduced_phase: "P9" as const,
      found_phase: "P9" as const,
      record_code: taskCode.get(r.id) || null,
      build_request_id: r.id,
      subject: reason.get(r.id)?.reason ?? null,
      evidence: {
        reason_class: classOf(reason.get(r.id)?.reason ?? null),
        reason_missing: classOf(reason.get(r.id)?.reason ?? null) === null,
        build_request_id: r.id,
        build_step_id: reason.get(r.id)?.step ?? null,
      },
      occurred_at: r.withdrawn_at,
      key: r.id,
    }));
};
