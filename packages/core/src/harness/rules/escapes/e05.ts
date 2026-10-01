// E05 — a criterion new or modified in a version of a feature created after an earlier version was approved: the
// approved feature was missing it (P5); found later, at the earliest when screens are drawn (P6). Source: criteria.carry
// in feature versions with an approved predecessor.

import { type EscapeRule, ms } from "./types.ts";

export const e05: EscapeRule = (i) => {
  const fdrs = new Map(
    i.records.filter((r) => r.type === "fdr").map((r) => [r.id, r]),
  );
  const byRecord = new Map<string, typeof i.versions>();
  for (const v of i.versions) {
    if (!fdrs.has(v.record_id)) continue;
    byRecord.set(v.record_id, [...(byRecord.get(v.record_id) ?? []), v]);
  }
  const criteriaOf = new Map<string, typeof i.criteria>();
  for (const c of i.criteria)
    criteriaOf.set(c.record_version_id, [
      ...(criteriaOf.get(c.record_version_id) ?? []),
      c,
    ]);
  const out = [];
  for (const [recordId, versions] of byRecord) {
    for (const v of versions) {
      const approvedBefore = versions.find(
        (p) =>
          p.n < v.n &&
          p.approved_at !== null &&
          ms(p.approved_at) <= ms(v.created_at),
      );
      if (!approvedBefore) continue;
      for (const c of criteriaOf.get(v.id) ?? []) {
        if (c.carry !== "new" && c.carry !== "modified") continue;
        out.push({
          rule: "E05",
          introduced_phase: "P5" as const,
          found_phase: "P6" as const,
          record_code: fdrs.get(recordId)?.code ?? null,
          record_version_id: v.id,
          criterion_code: c.code,
          subject: `v${v.n} ${c.carry}`,
          evidence: {
            record_version_id: v.id,
            approved_version_id: approvedBefore.id,
            carry: c.carry,
          },
          occurred_at: v.created_at,
          key: `${v.id}:${c.code}`,
        });
      }
    }
  }
  return out;
};
