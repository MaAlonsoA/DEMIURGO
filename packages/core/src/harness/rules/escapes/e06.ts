// E06 — a contradiction between approved records, seen in the same design phase but too late to stop the first record
// (P5 → P5). Three stored signals: a knowledge review proposal the person accepted (the proposed change became real),
// an idea assessment with a `conflicts` finding whose proposal was accepted, and a feature version whose change note
// cites another record while saying contradiction or conflict (a keyword rule: our convention).

import { type EscapeRule, recordById } from "./types.ts";

const CODE = /\b[A-Z]{2,4}-[A-Z]{3}-\d+\b/g;
const WORDS = /contradict|conflict/i;

export const e06: EscapeRule = (i) => {
  const out = [];
  for (const p of i.reviewProposals) {
    if (p.state !== "accepted" || p.verdict !== "update") continue;
    out.push({
      rule: "E06",
      introduced_phase: "P5" as const,
      found_phase: "P5" as const,
      record_code: p.record_code,
      subject: "review_accepted",
      evidence: { proposal_id: p.id, batch_id: p.batch_id },
      occurred_at: p.resolved_at,
      key: `proposal:${p.id}`,
    });
  }
  const accepted = new Set(
    i.reviewProposals.filter((p) => p.state === "accepted").map((p) => p.id),
  );
  for (const c of i.ideaConflicts) {
    if (!accepted.has(c.proposal_id)) continue;
    out.push({
      rule: "E06",
      introduced_phase: "P5" as const,
      found_phase: "P5" as const,
      record_code: c.citation?.split("@")[0] ?? null,
      subject: "idea_conflict",
      evidence: {
        idea_assessment_id: c.assessment_id,
        proposal_id: c.proposal_id,
      },
      occurred_at: c.created_at,
      key: `assessment:${c.assessment_id}:${c.citation ?? ""}`,
    });
  }
  const byId = recordById(i);
  for (const v of i.versions) {
    const rec = byId.get(v.record_id);
    if (!rec || v.n <= 1 || !v.change_note || !WORDS.test(v.change_note))
      continue;
    const others = [...new Set(v.change_note.match(CODE) ?? [])].filter(
      (c) => c !== rec.code,
    );
    if (others.length === 0) continue;
    out.push({
      rule: "E06",
      introduced_phase: "P5" as const,
      found_phase: "P5" as const,
      record_code: rec.code,
      record_version_id: v.id,
      subject: others.join(" "),
      evidence: { record_version_id: v.id, cited: others },
      occurred_at: v.created_at,
      key: `version:${v.id}`,
    });
  }
  return out;
};
