// E11 — the person corrected something the system had taken as decided. One escape per stored command:
// `record.set_size` over an existing size, `record.keep_size`, `question.reopen`, `run.retry`, `link.revalidate`
// (the link stays without a new version) and `proposal.reject` of a design proposal (rejections of knowledge review
// proposals are E06 noise, not corrections, and are left out). The phase is where the person noticed (our convention).
// esc-2: `link.revalidate` («Still valid», a confirmation, already the cost of readiness) and `run.retry` (operation)
// are no longer corrections, and neither is a command run nested inside another one (`cause.sourceCommand`, e.g. the
// reopening inside `proposal.accept`). A rejected design proposal is work inside the phase: it is marked
// `contained`, unless its reason says it was not what was asked (the agent failed, not the design).
// esc-4: a `proposal.reject` is always contained (the person caught it before it became authority; Motorola: an error
// found in its own phase is contained); «not what was asked» stays as `class`, no longer an exclusion. The phase is the
// record type's of the rejected proposal (task P7, feature P5…: `phaseOfRecordType`; P5 when it cannot be told).

import { type Esc4Inputs, phaseOfRecordType } from "./esc4.ts";
import {
  type Escape,
  type EscapeEvent,
  type EscapeRule,
  introducedAt,
  recordById,
} from "./types.ts";

const PHASES: Record<
  string,
  { introduced: Escape["introduced_phase"]; found: Escape["found_phase"] }
> = {
  "record.set_size": { introduced: "P7", found: "P7" },
  "record.keep_size": { introduced: "P7", found: "P7" },
  "question.reopen": { introduced: "P1", found: "P5" },
  "proposal.reject": { introduced: "P5", found: "P5" },
};

export const E11_COMMANDS = Object.keys(PHASES);

/** `set_size` only counts when it replaced a size that was already there. */
const corrects = (e: EscapeEvent): boolean =>
  e.command !== "record.set_size" ||
  (e.after.previous != null && e.after.previous !== e.after.size);

export const e11: EscapeRule = (inputs) => {
  const i = inputs as Esc4Inputs;
  const byId = recordById(i);
  const rejected = new Map((i.rejectedProposals ?? []).map((p) => [p.id, p.record_type]));
  const out = [];
  for (const e of i.events) {
    const phases = PHASES[e.command];
    if (!phases || !corrects(e)) continue;
    if (typeof e.cause.sourceCommand === "string" && e.cause.sourceCommand)
      continue;
    if (e.command === "proposal.reject" && e.proposal_type === "review")
      continue;
    const reason = typeof e.after.reason === "string" ? e.after.reason : "";
    const isReject = e.command === "proposal.reject";
    const contained = isReject;
    const phase = isReject ? phaseOfRecordType(e.entity_id ? rejected.get(e.entity_id) : null) : null;
    out.push({
      rule: "E11",
      introduced_phase: phase ?? phases.introduced,
      found_phase: phase ?? phases.found,
      record_code:
        (typeof e.after.code === "string" ? e.after.code : null) ??
        (e.entity_id ? (byId.get(e.entity_id)?.code ?? null) : null),
      subject: e.command,
      evidence: {
        event_id: e.id,
        command: e.command,
        entity_id: e.entity_id,
        ...introducedAt(e.entity_id ? byId.get(e.entity_id)?.created_at : null),
        ...(contained ? { contained: true } : {}),
        ...(isReject && /not what was asked/i.test(reason) ? { class: "not_asked" } : {}),
      },
      occurred_at: e.at,
      key: e.id,
    });
  }
  return out;
};
