// esc-4 shared pieces (validacion-fugas-esc3.md §8, fixes 8-15). Kept apart from types.ts: the extra inputs the new
// rules read are optional, so older callers and tests that build `EscapeInputs` by hand keep working.
// Every threshold or keyword list here is convención nuestra; none comes from a published standard.

import type { EscapeInputs, EscapeVersion, Phase } from "./types.ts";
import { ms } from "./types.ts";


/** A `wait_testability` decision of the queue, with the criteria the testability check flagged (queue_decisions). */
export type EscapeQueueDecision = {
  task_code: string;
  decided_at: string;
  item: string | null;
  criteria: string[];
};
/** The record type a rejected proposal was about (null when it cannot be told). */
export type EscapeRejectedProposal = { id: string; record_type: string | null };

export type Esc4Inputs = EscapeInputs & {
  queueDecisions?: EscapeQueueDecision[];
  rejectedProposals?: EscapeRejectedProposal[];
};

/** How long after an accepted knowledge review a new version of the reviewed record is still its consequence (convención nuestra). */
export const REVIEW_CAUSE_WINDOW_MIN = 30;
/** How long a review comment on a task is taken as what exposed a feature change made right after it (convención nuestra). */
export const REVIEW_EXPOSURE_WINDOW_MIN = 30;

/**
 * The version each accepted knowledge review caused (proposal id -> version). The version is born from a `record_change`
 * proposal of an agent batch (exploration), not from the `review` proposal, so the stored origin cannot link them:
 * approximation = a version n > 1 of the reviewed record, born from some other proposal, created from the review's
 * resolution up to REVIEW_CAUSE_WINDOW_MIN later (convención nuestra). The closest one in time wins; a version belongs
 * to one review.
 */
export const reviewVersions = (i: EscapeInputs): Map<string, EscapeVersion> => {
  const byCode = new Map(i.records.map((r) => [r.code, r.id]));
  const reviewIds = new Set(i.reviewProposals.map((p) => p.id));
  const out = new Map<string, EscapeVersion>();
  const taken = new Set<string>();
  const reviews = i.reviewProposals
    .filter((p) => p.state === "accepted" && p.resolved_at && p.record_code)
    .sort((a, b) => ms(a.resolved_at) - ms(b.resolved_at));
  for (const p of reviews) {
    const recordId = byCode.get(p.record_code!);
    if (!recordId) continue;
    const from = ms(p.resolved_at);
    const to = from + REVIEW_CAUSE_WINDOW_MIN * 60_000;
    const candidate = i.versions
      .filter(
        (v) =>
          v.record_id === recordId &&
          v.n > 1 &&
          !taken.has(v.id) &&
          v.origin_type === "proposal" &&
          !!v.origin_id &&
          !reviewIds.has(v.origin_id) &&
          ms(v.created_at) >= from &&
          ms(v.created_at) <= to,
      )
      .sort((a, b) => ms(a.created_at) - ms(b.created_at))[0];
    if (!candidate) continue;
    out.set(p.id, candidate);
    taken.add(candidate.id);
  }
  return out;
};

/** Ids of the versions that are the consequence of an accepted knowledge review (stored origin or the time link). */
export const reviewCausedVersionIds = (i: EscapeInputs): Set<string> => {
  const accepted = new Set(i.reviewProposals.filter((p) => p.state === "accepted").map((p) => p.id));
  const ids = new Set<string>();
  for (const v of i.versions) if (v.origin_type === "proposal" && v.origin_id && accepted.has(v.origin_id)) ids.add(v.id);
  for (const v of reviewVersions(i).values()) ids.add(v.id);
  return ids;
};

/**
 * The design phase of a record type (path of design doc §2.2): definition P1, quality goals P2, decisions P3, design
 * system P4, epics/features/requirements P5, screens P6, tasks P7. Types outside the design phases fall to P5
 * (convención nuestra).
 */
export const phaseOfRecordType = (type: string | null | undefined): Phase => {
  switch (type) {
    case "product_definition":
      return "P1";
    case "quality_requirement":
      return "P2";
    case "decision":
    case "adr":
      return "P3";
    case "design_system":
      return "P4";
    case "screen_design":
      return "P6";
    case "task":
      return "P7";
    default:
      return "P5";
  }
};

/** Words that say the cause is the deployed candidate: the criterion should have been `release` (convención nuestra). */
export const DEPLOYED_CANDIDATE =
  /\b(deploy(ed|ment|s)?|production|real network|hosting|cold[- ]starts?|vercel|neon)\b/i;

/** A reason that says the owner asked for the change: a scope change, not a defect (convención nuestra). */
export const OWNER_SCOPE_CHANGE =
  /\b(the )?(user|owner|person)\b[^.]{0,40}\b(explicitly )?(requests?|asks?|wants?)\b|\bowner asks\b/i;
