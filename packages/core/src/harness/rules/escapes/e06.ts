// E06 — a contradiction between approved records caught in the design phase (P5 → P5), so it counts as contained
// (`evidence.contained`). Three stored signals, each only when a NEW version of the record resulted from it: a
// knowledge review proposal the person accepted, an idea assessment with a `conflicts` finding whose proposal was
// accepted, and a version whose change note cites another record while saying contradiction or conflict (a keyword
// rule: our convention). esc-2: one row per version however many signals reach it; a review triggered by the change
// of a record the reviewed one is based on is propagation, not contradiction; the cited code must be another record of
// the project and never a criterion (`AC-…`); a version with new or modified criteria after an approved one is E05's.

import { type Escape, type EscapeRule, ms, recordById } from "./types.ts";

const CODE = /\b(?!AC-)[A-Z]{2,4}-[A-Z]{3}-\d+\b/g;
const WORDS = /contradict|conflict/i;

export const e06: EscapeRule = (i) => {
  const byId = recordById(i);
  const byCode = new Map(i.records.map((r) => [r.code, r]));
  const versionById = new Map(i.versions.map((v) => [v.id, v]));
  const byOrigin = new Map<string, (typeof i.versions)[number]>();
  for (const v of i.versions)
    if (v.origin_type === "proposal" && v.origin_id && v.n > 1)
      byOrigin.set(v.origin_id, v);
  const basedOn = new Set(
    i.links
      .filter((l) => l.type === "based_on")
      .map((l) => `${l.from_record_id}>${l.to_record_id}`),
  );
  const rows = new Map<string, Escape>();
  const add = (
    v: (typeof i.versions)[number],
    subject: string,
    evidence: Record<string, unknown>,
  ) => {
    if (rows.has(v.id)) return;
    rows.set(v.id, {
      rule: "E06",
      introduced_phase: "P5",
      found_phase: "P5",
      record_code: byId.get(v.record_id)?.code ?? null,
      record_version_id: v.id,
      subject,
      evidence: { ...evidence, record_version_id: v.id, contained: true },
      occurred_at: v.created_at,
      key: `version:${v.id}`,
    });
  };
  for (const p of i.reviewProposals) {
    if (p.state !== "accepted" || p.verdict !== "update") continue;
    const v = byOrigin.get(p.id);
    if (!v) continue;
    const changed = p.change_version_id
      ? versionById.get(p.change_version_id)?.record_id
      : undefined;
    if (changed && (changed === v.record_id || basedOn.has(`${v.record_id}>${changed}`)))
      continue;
    add(v, "review_accepted", { proposal_id: p.id, batch_id: p.batch_id });
  }
  const accepted = new Set(
    i.reviewProposals.filter((p) => p.state === "accepted").map((p) => p.id),
  );
  for (const c of i.ideaConflicts) {
    if (!accepted.has(c.proposal_id)) continue;
    const v = byOrigin.get(c.proposal_id);
    if (!v) continue;
    add(v, "idea_conflict", {
      idea_assessment_id: c.assessment_id,
      proposal_id: c.proposal_id,
    });
  }
  const criteriaOf = new Map<string, typeof i.criteria>();
  for (const c of i.criteria)
    criteriaOf.set(c.record_version_id, [
      ...(criteriaOf.get(c.record_version_id) ?? []),
      c,
    ]);
  for (const v of [...i.versions].sort(
    (a, b) => ms(a.created_at) - ms(b.created_at),
  )) {
    const rec = byId.get(v.record_id);
    if (!rec || v.n <= 1 || !v.change_note || !WORDS.test(v.change_note))
      continue;
    const others = [...new Set(v.change_note.match(CODE) ?? [])].filter(
      (c) => c !== rec.code && byCode.has(c),
    );
    if (others.length === 0) continue;
    if (
      rec.type === "fdr" &&
      (criteriaOf.get(v.id) ?? []).some(
        (c) => c.carry === "new" || c.carry === "modified",
      ) &&
      i.versions.some(
        (p) => p.record_id === v.record_id && p.n < v.n && p.approved_at !== null,
      )
    )
      continue;
    add(v, others.join(" "), { cited: others });
  }
  return [...rows.values()];
};
