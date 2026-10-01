// E01 — a blocking reviewer comment about a test that does not exercise the criterion (`test_gap`: the task's `covers`
// or criterion were not testable as written, P7) or about evidence that cannot be automated (`manual_evidence`: the
// criterion was written as automatic and is not, P5). Found by the review (P10). Source: review_finding_kinds
// (Jev's category of each comment) over pr_reviews.comments with severity blocking.

import { type EscapeRule, requestTaskCode } from "./types.ts";

const CRITERION = /\bAC-[A-Z]+-\d+-\d+\b/;

export const e01: EscapeRule = (i) => {
  const taskCode = requestTaskCode(i);
  const reviews = new Map(i.reviews.map((r) => [r.id, r]));
  const out = [];
  for (const k of i.findingKinds) {
    if (k.category !== "test_gap" && k.category !== "manual_evidence") continue;
    const review = reviews.get(k.pr_review_id);
    const comment = review?.comments[k.comment_index] as
      { severity?: string; body?: string; path?: string } | undefined;
    if (!review || comment?.severity !== "blocking") continue;
    out.push({
      rule: "E01",
      introduced_phase:
        k.category === "test_gap" ? ("P7" as const) : ("P5" as const),
      found_phase: "P10" as const,
      record_code: taskCode.get(review.build_request_id) || null,
      criterion_code: CRITERION.exec(comment.body ?? "")?.[0] ?? null,
      build_request_id: review.build_request_id,
      pr_review_id: review.id,
      comment_index: k.comment_index,
      subject: comment.path ?? null,
      evidence: {
        pr_review_id: review.id,
        comment_index: k.comment_index,
        category: k.category,
      },
      occurred_at: review.created_at,
      key: `${review.id}:${k.comment_index}`,
    });
  }
  return out;
};
