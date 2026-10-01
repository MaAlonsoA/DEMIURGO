// E01 — a blocking reviewer comment about a test that does not exercise the criterion (`test_gap`: the task's `covers`
// or criterion were not testable as written, P7) or about evidence that cannot be automated (`manual_evidence`: the
// criterion was written as automatic and is not, P5). Found by the review (P10). Source: review_finding_kinds
// (Jev's category of each comment) over pr_reviews.comments with severity blocking.
// esc-2: one escape per (task, criterion) however many review rounds repeated it; tasks without `covers` (hand-made
// process work, E10) and criteria checked by a person (`manual` or `release`: the reviewer must not block them) are
// left out; a comment the reviewer marked `needs_person` on an automatic criterion is attributed to P5 (the criterion
// could not be checked automatically as written).
// esc-4: a comment that does not name the AC takes the criterion from the task's `covers` (the only automatic one;
// when every covered criterion is manual or release the comment is left out); one row per (task, criterion) whatever
// the `path`; a comment whose cause is the deployed candidate (deploy, production, cold start…: convención nuestra) is
// P5, the criterion should have been `release`; `evidence.defect_key` = the criterion, so the same defect seen by E05,
// E08 or E17 is one defect in the containment.

import { DEPLOYED_CANDIDATE } from "./esc4.ts";
import {
  type Escape,
  type EscapeRule,
  coversOf,
  ms,
  requestTaskCode,
  approvalOf,
  criterionApprovalAt,
  introducedAt,
  verificationAt,
} from "./types.ts";

const CRITERION = /\bAC-[A-Z]+-\d+-\d+\b/;

export const e01: EscapeRule = (i) => {
  const taskCode = requestTaskCode(i);
  const covers = coversOf(i);
  const taskOfRequest = new Map(i.requests.map((r) => [r.id, r.task_id]));
  const verification = verificationAt(i);
  const reviews = new Map(i.reviews.map((r) => [r.id, r]));
  const rows = new Map<string, Escape & { rounds: number }>();
  const ordered = [...i.findingKinds].sort(
    (a, b) =>
      ms(reviews.get(a.pr_review_id)?.created_at) -
        ms(reviews.get(b.pr_review_id)?.created_at) ||
      a.comment_index - b.comment_index,
  );
  for (const k of ordered) {
    if (k.category !== "test_gap" && k.category !== "manual_evidence") continue;
    const review = reviews.get(k.pr_review_id);
    const comment = review?.comments[k.comment_index] as
      | {
          severity?: string;
          body?: string;
          path?: string;
          needs_person?: boolean;
        }
      | undefined;
    if (!review || comment?.severity !== "blocking") continue;
    const taskId = taskOfRequest.get(review.build_request_id);
    if (!taskId || (covers.get(taskId) ?? []).length === 0) continue;
    let criterion = CRITERION.exec(comment.body ?? "")?.[0] ?? null;
    if (!criterion) {
      // The criterion is the task's cover that a person does not check; with none left the reviewer must not block.
      const automatic = (covers.get(taskId) ?? []).filter((c) => {
        const v = verification(c, review.created_at);
        return v !== "manual" && v !== "release";
      });
      if (automatic.length === 0) continue;
      criterion = automatic.length === 1 ? (automatic[0] ?? null) : null;
    }
    const how = criterion ? verification(criterion, review.created_at) : null;
    if (how === "manual" || how === "release") continue;
    const code = taskCode.get(review.build_request_id) || null;
    const key = `${code ?? review.build_request_id}:${criterion ?? "task"}`;
    const found = rows.get(key);
    if (found) {
      found.rounds += 1;
      continue;
    }
    const needsPerson = comment.needs_person === true;
    const deployed = DEPLOYED_CANDIDATE.test(comment.body ?? "");
    rows.set(key, {
      rule: "E01",
      introduced_phase:
        k.category === "test_gap" && !needsPerson && !deployed ? "P7" : "P5",
      found_phase: "P10",
      record_code: code,
      criterion_code: criterion,
      build_request_id: review.build_request_id,
      pr_review_id: review.id,
      comment_index: k.comment_index,
      subject: comment.path ?? null,
      evidence: {
        pr_review_id: review.id,
        comment_index: k.comment_index,
        category: k.category,
        verification: how,
        needs_person: needsPerson,
        ...(deployed ? { cause: "deployed_candidate" } : {}),
        defect_key: criterion ? `ac:${criterion}` : `task:${code ?? review.build_request_id}`,
        rounds: 1,
        ...introducedAt(
          criterionApprovalAt(i, criterion, review.created_at) ??
            approvalOf(i, taskId, review.created_at),
        ),
      },
      rounds: 1,
      occurred_at: review.created_at,
      key,
    });
  }
  return [...rows.values()].map(({ rounds, ...e }) => ({
    ...e,
    evidence: { ...e.evidence, rounds },
  }));
};
