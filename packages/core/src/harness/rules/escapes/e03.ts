// E03 — a task got a new version after its first build was requested: the task as designed was not enough (P7), found
// while building or reviewing (P9). Source: record_versions n > 1 created after the earliest build_requests row.

import { type EscapeRule, ms } from "./types.ts";

export const e03: EscapeRule = (i) => {
  const firstRequest = new Map<string, string>();
  for (const r of i.requests) {
    const cur = firstRequest.get(r.task_id);
    if (!cur || ms(r.requested_at) < ms(cur))
      firstRequest.set(r.task_id, r.requested_at);
  }
  const tasks = new Map(
    i.records.filter((r) => r.type === "task").map((r) => [r.id, r]),
  );
  const out = [];
  for (const v of i.versions) {
    const task = tasks.get(v.record_id);
    const first = firstRequest.get(v.record_id);
    if (!task || !first || v.n <= 1 || ms(v.created_at) <= ms(first)) continue;
    out.push({
      rule: "E03",
      introduced_phase: "P7" as const,
      found_phase: "P9" as const,
      record_code: task.code,
      record_version_id: v.id,
      subject: `v${v.n}`,
      evidence: { record_version_id: v.id, n: v.n, first_request_at: first },
      occurred_at: v.created_at,
      key: v.id,
    });
  }
  return out;
};
