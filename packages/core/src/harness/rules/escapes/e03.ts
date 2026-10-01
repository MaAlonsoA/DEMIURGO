// E03 — a task got a new version after its first build was requested: the task as designed was not enough (P7), found
// while building or reviewing (P9). Source: record_versions n > 1 created after the earliest build_requests row.
// esc-2: a version that came out of an accepted knowledge review (the base changed and the task followed) is the
// cascade of that change, not a planning failure of its own; it is left to E06/E05. `by_hand` tells a version written
// by a person from one that came as a proposal.
// esc-4: the review -> version link is now found (esc4.ts `reviewCausedVersionIds`), so the cascade exclusion works; and
// a version of a task created BEFORE its first build request, over an approved earlier version, is a P7 error caught
// in design: `P7 -> P7`, contained (convención nuestra: the approved predecessor tells a correction from drafting).

import { reviewCausedVersionIds } from "./esc4.ts";
import { type Escape, type EscapeRule, approvalOf, introducedAt, ms } from "./types.ts";

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
  const caused = reviewCausedVersionIds(i);
  const out: Escape[] = [];
  for (const v of i.versions) {
    const task = tasks.get(v.record_id);
    const first = firstRequest.get(v.record_id);
    if (!task || !first || v.n <= 1) continue;
    if (caused.has(v.id)) continue;
    const before = ms(v.created_at) <= ms(first);
    if (before) {
      const approvedBefore = approvalOf(i, v.record_id, v.created_at);
      const predecessor = i.versions.some(
        (p) =>
          p.record_id === v.record_id &&
          p.n < v.n &&
          p.approved_at !== null &&
          ms(p.approved_at) <= ms(v.created_at),
      );
      if (!predecessor) continue;
      out.push({
        rule: "E03",
        introduced_phase: "P7",
        found_phase: "P7",
        record_code: task.code,
        record_version_id: v.id,
        subject: `v${v.n} before_build`,
        evidence: {
          record_version_id: v.id,
          n: v.n,
          first_request_at: first,
          by_hand: v.origin_type !== "proposal",
          contained: true,
          defect_key: `ver:${v.id}`,
          ...introducedAt(approvedBefore),
        },
        occurred_at: v.created_at,
        key: v.id,
      });
      continue;
    }
    out.push({
      rule: "E03",
      introduced_phase: "P7",
      found_phase: "P9",
      record_code: task.code,
      record_version_id: v.id,
      subject: `v${v.n}`,
      evidence: {
        record_version_id: v.id,
        n: v.n,
        first_request_at: first,
        by_hand: v.origin_type !== "proposal",
        defect_key: `ver:${v.id}`,
        ...introducedAt(approvalOf(i, v.record_id, v.created_at)),
      },
      occurred_at: v.created_at,
      key: v.id,
    });
  }
  return out;
};
