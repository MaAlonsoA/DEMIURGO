// E11 — the person corrected something the system had taken as decided. One escape per stored command:
// `record.set_size` over an existing size, `record.keep_size`, `question.reopen`, `run.retry`, `link.revalidate`
// (the link stays without a new version) and `proposal.reject` of a design proposal (rejections of knowledge review
// proposals are E06 noise, not corrections, and are left out). The phase is where the person noticed (our convention).

import {
  type Escape,
  type EscapeEvent,
  type EscapeRule,
  recordById,
} from "./types.ts";

const PHASES: Record<
  string,
  { introduced: Escape["introduced_phase"]; found: Escape["found_phase"] }
> = {
  "record.set_size": { introduced: "P7", found: "P7" },
  "record.keep_size": { introduced: "P7", found: "P7" },
  "question.reopen": { introduced: "P1", found: "P5" },
  "run.retry": { introduced: "P5", found: "P5" },
  "link.revalidate": { introduced: "P5", found: "P5" },
  "proposal.reject": { introduced: "P5", found: "P5" },
};

export const E11_COMMANDS = Object.keys(PHASES);

/** `set_size` only counts when it replaced a size that was already there. */
const corrects = (e: EscapeEvent): boolean =>
  e.command !== "record.set_size" ||
  (e.after.previous != null && e.after.previous !== e.after.size);

export const e11: EscapeRule = (i) => {
  const byId = recordById(i);
  const out = [];
  for (const e of i.events) {
    const phases = PHASES[e.command];
    if (!phases || !corrects(e)) continue;
    if (e.command === "proposal.reject" && e.proposal_type === "review")
      continue;
    out.push({
      rule: "E11",
      introduced_phase: phases.introduced,
      found_phase: phases.found,
      record_code:
        (typeof e.after.code === "string" ? e.after.code : null) ??
        (e.entity_id ? (byId.get(e.entity_id)?.code ?? null) : null),
      subject: e.command,
      evidence: { event_id: e.id, command: e.command, entity_id: e.entity_id },
      occurred_at: e.at,
      key: e.id,
    });
  }
  return out;
};
