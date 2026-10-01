// E05 — criteria new or modified in a version of a feature created after an earlier version was approved: the
// approved feature was missing them (P5). esc-2: one escape per feature version (the criteria go in `evidence`), not
// per criterion; the predecessor is the latest approved version before the new one was created; the phase where it
// was found is the state of the feature's tasks when the version was created (none requested: P7; requested: P9; in
// review: P10; merged: P13); a version that came out of an accepted knowledge review is the cascade of that review
// (E06) and is left out. `class` is `catch_up` when the note cites a patch or a commit (the design catching up with
// code, a different signal) and `defect` otherwise.
// esc-4: the cascade exclusion now works (esc4.ts review link); a feature with no task at all was caught before any
// plan existed: `P5 -> P5`, contained; found phase P10 when a review comment on one of its tasks came up to 30 min
// before the version (the review exposed it: convención nuestra); an owner scope change (the note says the user or
// owner requests it: convención nuestra) is class `scope_change`, not a defect: `P5 -> P5`, not contained, so the
// measure ignores it. `evidence.defect_key` = the criterion when one changed, else the version.

import { OWNER_SCOPE_CHANGE, REVIEW_EXPOSURE_WINDOW_MIN, reviewCausedVersionIds } from "./esc4.ts";
import { type Escape, type EscapeRule, introducedAt, ms } from "./types.ts";

const PATCH = /\bpatch(es)?\b|\b(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/i;

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
  const caused = reviewCausedVersionIds(i);
  const taskOfRequest = new Map(i.requests.map((r) => [r.id, r.task_id]));
  const tasksOf = new Map<string, Set<string>>();
  for (const b of i.taskBases)
    tasksOf.set(b.fdr_id, (tasksOf.get(b.fdr_id) ?? new Set()).add(b.task_id));
  const out: Escape[] = [];
  for (const [recordId, versions] of byRecord) {
    for (const v of versions) {
      if (v.n <= 1) continue;
      const approvedBefore = versions
        .filter(
          (p) =>
            p.n < v.n &&
            p.approved_at !== null &&
            ms(p.approved_at) <= ms(v.created_at),
        )
        .sort((a, b) => b.n - a.n)[0];
      if (!approvedBefore) continue;
      if (caused.has(v.id)) continue;
      const changed = (criteriaOf.get(v.id) ?? []).filter(
        (c) => c.carry === "new" || c.carry === "modified",
      );
      if (changed.length === 0) continue;
      const tasks = tasksOf.get(recordId) ?? new Set<string>();
      const at = ms(v.created_at);
      const mine = i.requests.filter(
        (r) => tasks.has(r.task_id) && ms(r.requested_at) <= at,
      );
      const merged = mine.some((r) => r.done_at && ms(r.done_at) <= at);
      const reviewing = mine.some(
        (r) => r.in_review_at && ms(r.in_review_at) <= at,
      );
      const exposed = i.reviews.some((r) => {
        const taskId = taskOfRequest.get(r.build_request_id);
        const t = ms(r.created_at);
        return (
          taskId !== undefined &&
          tasks.has(taskId) &&
          t <= at &&
          at - t <= REVIEW_EXPOSURE_WINDOW_MIN * 60_000
        );
      });
      const cls =
        v.change_note && PATCH.test(v.change_note)
          ? "catch_up"
          : v.change_note && OWNER_SCOPE_CHANGE.test(v.change_note)
            ? "scope_change"
            : "defect";
      const noTasks = tasks.size === 0;
      const found =
        cls === "scope_change" || noTasks
          ? ("P5" as const)
          : exposed
            ? ("P10" as const)
            : merged
              ? ("P13" as const)
              : reviewing
                ? ("P10" as const)
                : mine.length > 0
                  ? ("P9" as const)
                  : ("P7" as const);
      const contained = noTasks && cls === "defect";
      out.push({
        rule: "E05",
        introduced_phase: "P5" as const,
        found_phase: found,
        record_code: fdrs.get(recordId)?.code ?? null,
        record_version_id: v.id,
        subject: `v${v.n} ${cls}`,
        evidence: {
          record_version_id: v.id,
          approved_version_id: approvedBefore.id,
          class: cls,
          criteria: changed.map((c) => ({ code: c.code, carry: c.carry })),
          tasks_requested: mine.length,
          defect_key: changed.length === 1 ? `ac:${changed[0]!.code}` : `ver:${v.id}`,
          ...(contained ? { contained: true } : {}),
          ...introducedAt(approvedBefore.approved_at),
        },
        occurred_at: v.created_at,
        key: v.id,
      });
    }
  }
  return out;
};
