// E08 — a criterion that ends without a test or whose way of being checked got worse: (a) the TDD gate listed it as
// `uncovered`; (b) the evidence step listed it as `not_run`; (c) a later feature version moved it from `automatic` to
// `manual` or `release`. The criterion was written (P5) in a way the build could not verify; found while building (P9).

import {
  type EscapeRule,
  approvalOf,
  criterionApprovalAt,
  introducedAt,
  recordById,
  requestTaskCode,
  verificationAt,
} from "./types.ts";

const codesOf = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((c): c is string => typeof c === "string") : [];

// esc-2: (a) and (b) skip criteria checked by a person (`manual`/`release`): nothing can have a test for them.
export const e08: EscapeRule = (i) => {
  const taskCode = requestTaskCode(i);
  const verification0 = verificationAt(i);
  const out = [];
  const seen = new Set<string>();
  for (const s of i.steps) {
    const source =
      s.stage === "builder"
        ? "uncovered"
        : s.stage === "evidence"
          ? "not_run"
          : null;
    if (!source) continue;
    for (const code of codesOf(s.detail[source])) {
      const how = verification0(code, s.created_at);
      if (how === "manual" || how === "release") continue;
      const key = `${source}:${s.build_request_id}:${code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        rule: "E08",
        introduced_phase: "P5" as const,
        found_phase: "P9" as const,
        record_code: taskCode.get(s.build_request_id) || null,
        criterion_code: code,
        build_request_id: s.build_request_id,
        subject: source,
        evidence: {
          build_step_id: s.id,
          attempt: s.attempt,
          source,
          ...introducedAt(criterionApprovalAt(i, code, s.created_at)),
        },
        occurred_at: s.created_at,
        key,
      });
    }
  }
  const byId = recordById(i);
  const versionsOf = new Map<string, typeof i.versions>();
  for (const v of i.versions)
    versionsOf.set(v.record_id, [...(versionsOf.get(v.record_id) ?? []), v]);
  const verification = new Map(
    i.criteria.map((c) => [`${c.record_version_id}:${c.code}`, c.verification]),
  );
  for (const c of i.criteria) {
    if (c.verification !== "manual" && c.verification !== "release") continue;
    const version = i.versions.find((v) => v.id === c.record_version_id);
    if (!version || byId.get(version.record_id)?.type !== "fdr") continue;
    const previous = (versionsOf.get(version.record_id) ?? [])
      .filter((p) => p.n < version.n)
      .sort((a, b) => b.n - a.n)[0];
    if (
      !previous ||
      verification.get(`${previous.id}:${c.code}`) !== "automatic"
    )
      continue;
    out.push({
      rule: "E08",
      introduced_phase: "P5" as const,
      found_phase: "P9" as const,
      record_code: byId.get(version.record_id)?.code ?? null,
      record_version_id: version.id,
      criterion_code: c.code,
      subject: `automatic -> ${c.verification}`,
      evidence: {
        record_version_id: version.id,
        previous_version_id: previous.id,
        ...introducedAt(version.approved_at),
      },
      occurred_at: version.created_at,
      key: `verification:${version.id}:${c.code}`,
    });
  }
  return out;
};
