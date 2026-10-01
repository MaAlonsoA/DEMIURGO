// A meaningful title for a batch of proposals, composed from what they are (their types and
// sections), instead of «Proposals from the exploration conversation (2)». Pure.

type Item = { type: string; payload: unknown };

const MAX = 200;

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const unique = (xs: string[]) => [...new Set(xs.filter((x) => x !== ""))];

/** record_type → [singular label, plural label] of a design record. */
const RECORD_WORDS: Record<string, [string, string]> = {
  epic: ["epic", "epics"],
  fdr: ["feature", "features"],
  task: ["task", "tasks"],
  requirement: ["requirement", "requirements"],
  quality_requirement: ["quality requirement (NFR)", "quality requirements (NFR)"],
  threat_model: ["threat model", "threat models"],
  production_readiness: ["production readiness record", "production readiness records"],
  adr: ["decision", "decisions"],
};

const cap = (s: string) => (s.length > MAX ? `${s.slice(0, MAX - 1).trimEnd()}…` : s);
const upper = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One phrase for the proposals of one kind. */
function phrase(kind: string, items: Item[]): string {
  const n = items.length;
  const payloads = items.map((i) => obj(i.payload));
  switch (kind) {
    case "definition_change": {
      const sections = unique(payloads.map((p) => str(p.section)));
      return `${plural(n, "change")} to the product definition${sections.length > 0 ? `: ${sections.join(", ")}` : ""}`;
    }
    case "record_change": {
      const codes = unique(payloads.map((p) => str(obj(p.record).code)));
      return `${plural(n, "change")} to ${codes.length > 0 ? codes.join(", ") : "an approved record"}`;
    }
    case "feature_plan": {
      const epics = unique(payloads.map((p) => str(obj(p.epic).code)));
      return `${plural(n, "change")} to the features of ${epics.length > 0 ? epics.join(", ") : "an epic"}`;
    }
    case "exploration": {
      const purpose = str(payloads[0]?.purpose);
      return n === 1 && purpose ? `Thread: ${purpose}` : plural(n, "thread proposal");
    }
    case "fdr":
    case "decision": {
      const title = str(payloads[0]?.title);
      const word = kind === "fdr" ? "feature" : "decision";
      return n === 1 && title ? `${upper(word)}: ${title}` : plural(n, word);
    }
    default: {
      const [one, many] = RECORD_WORDS[kind] ?? [kind.replaceAll("_", " "), `${kind.replaceAll("_", " ")}s`];
      const title = str(payloads[0]?.title);
      if (n === 1 && title) return `${upper(one)}: ${title}`;
      return `${n} ${n === 1 ? one : many}${kind === "quality_requirement" ? " from your quality goals" : ""}`;
    }
  }
}

/** The title of a batch: one phrase per kind of proposal, in the order they first appear. */
export function batchTitle(proposals: readonly Item[]): string {
  const groups = new Map<string, Item[]>();
  for (const p of proposals) {
    const payload = obj(p.payload);
    const kind = p.type === "design_record" && str(payload.record_type) ? str(payload.record_type) : p.type;
    groups.set(kind, [...(groups.get(kind) ?? []), p]);
  }
  if (groups.size === 0) return "Proposals";
  return cap([...groups].map(([kind, items]) => phrase(kind, items)).join(" · "));
}
