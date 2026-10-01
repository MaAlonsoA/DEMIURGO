// Types shared by the escape rules (salud-del-harness §4). A rule is a pure function of `EscapeInputs`, which is plain
// stored rows read once per project by `loadEscapeInputs`: no database, no clock and no model inside a rule.
// Phases follow the path of design doc §2.2 (P1 definition … P13 use). `P0` means «outside the path»: a process
// failure with no design phase to blame (E10). Every attribution below is our convention, written in code under
// `ESCAPES_RULES_VERSION`; the containment measure itself comes from Motorola (Daskalantonakis 1992; Kan, «Metrics and Models in Software Quality Engineering», chapter «Defect Removal Effectiveness»; sin comprobar el número de capítulo).

export const ESCAPES_RULES_VERSION = "esc-4";

export type Phase = `P${number}`;

/** One escape: a problem found in a later phase than the one that should have seen it. */
export type Escape = {
  rule: string;
  introduced_phase: Phase;
  found_phase: Phase;
  record_code?: string | null;
  record_version_id?: string | null;
  criterion_code?: string | null;
  build_request_id?: string | null;
  pr_review_id?: string | null;
  comment_index?: number | null;
  subject?: string | null;
  /** Ids of the rows that prove it. */
  evidence: Record<string, unknown>;
  /** When the fact itself happened (ISO), to cut by window. */
  occurred_at?: string | null;
  /** The ids that make it the same escape next time: the rule plus these is the dedupe key. */
  key: string;
};

export type EscapeRecord = {
  id: string;
  code: string;
  type: string;
  created_at: string;
};
export type EscapeVersion = {
  id: string;
  record_id: string;
  n: number;
  state: string;
  created_at: string;
  approved_at: string | null;
  change_note: string | null;
  /** What created the version (`origin.type` / `origin.id`, e.g. a proposal), when the journal kept it. */
  origin_type?: string | null;
  origin_id?: string | null;
};
export type EscapeCriterion = {
  record_version_id: string;
  code: string;
  carry: string;
  verification: string;
};
export type EscapeRequest = {
  id: string;
  task_id: string;
  requested_at: string;
  state: string;
  withdrawn_at: string | null;
  in_review_at?: string | null;
  done_at?: string | null;
};
/** A step with the few detail keys the rules read (extracted by the loader; the whole detail can be huge). */
export type EscapeStep = {
  id: string;
  build_request_id: string;
  attempt: number;
  stage: string;
  outcome: string;
  created_at: string;
  detail: Record<string, unknown>;
};
export type EscapeReview = {
  id: string;
  build_request_id: string;
  created_at: string;
  comments: unknown[];
};
export type EscapeFindingKind = {
  pr_review_id: string;
  comment_index: number;
  category: string;
};
export type EscapeHold = {
  id: string;
  task_id: string;
  reason: string;
  held_at: string;
  released_at: string | null;
};
/** The latest `task_covers` row of a task. */
export type EscapeCovers = { record_id: string; codes: string[] };
/** A task, the feature (FDR) it is based on and the proposal batch that created the task (null: made by hand). */
export type EscapeTaskBase = {
  task_id: string;
  fdr_id: string;
  batch_id: string | null;
};
export type EscapeReviewProposal = {
  id: string;
  batch_id: string;
  state: string;
  resolved_at: string | null;
  verdict: string | null;
  record_code: string | null;
  /** The record version whose change triggered the review (`payload.change.id`), when it is one. */
  change_version_id?: string | null;
};
/** A link between two record versions, read at record level (`based_on`, `depends_on`). */
export type EscapeLink = {
  type: string;
  state: string;
  from_record_id: string;
  from_version_id: string;
  from_n: number;
  from_type: string;
  to_record_id: string;
  to_type: string;
};
export type EscapeIdeaConflict = {
  assessment_id: string;
  proposal_id: string;
  citation: string | null;
  created_at: string;
};
export type EscapeEvent = {
  id: string;
  command: string;
  at: string;
  entity_id: string | null;
  after: Record<string, unknown>;
  cause: Record<string, unknown>;
  proposal_type: string | null;
};
export type EscapeBase = {
  id: string;
  build_request_id: string;
  attempt: number;
  adopted_at: string;
};

export type EscapeInputs = {
  projectId: string;
  records: EscapeRecord[];
  versions: EscapeVersion[];
  criteria: EscapeCriterion[];
  requests: EscapeRequest[];
  steps: EscapeStep[];
  reviews: EscapeReview[];
  findingKinds: EscapeFindingKind[];
  holds: EscapeHold[];
  covers: EscapeCovers[];
  taskBases: EscapeTaskBase[];
  reviewProposals: EscapeReviewProposal[];
  ideaConflicts: EscapeIdeaConflict[];
  events: EscapeEvent[];
  bases: EscapeBase[];
  links: EscapeLink[];
};

export type EscapeRule = (inputs: EscapeInputs) => Escape[];

/** Lookup helpers every rule shares. */
export const recordById = (i: EscapeInputs): Map<string, EscapeRecord> =>
  new Map(i.records.map((r) => [r.id, r]));
export const requestTaskCode = (i: EscapeInputs): Map<string, string> => {
  const byId = recordById(i);
  return new Map(
    i.requests.map((r) => [r.id, byId.get(r.task_id)?.code ?? ""]),
  );
};
export const ms = (d: string | null | undefined): number =>
  d ? new Date(d).getTime() : Number.NaN;

/**
 * The verification of each criterion code as it was at `at` (the latest version of the criterion created by then;
 * the latest overall when none was). A criterion that is not stored is absent: callers treat it as unknown.
 */
export const verificationAt = (
  i: EscapeInputs,
): ((code: string, at: string | null) => string | null) => {
  const created = new Map(i.versions.map((v) => [v.id, v.created_at]));
  const byCode = new Map<string, { at: number; verification: string }[]>();
  for (const c of i.criteria) {
    const list = byCode.get(c.code) ?? [];
    list.push({
      at: ms(created.get(c.record_version_id)),
      verification: c.verification,
    });
    byCode.set(c.code, list);
  }
  for (const list of byCode.values()) list.sort((a, b) => a.at - b.at);
  return (code, at) => {
    const list = byCode.get(code);
    if (!list || list.length === 0) return null;
    const cut = at ? ms(at) : Number.POSITIVE_INFINITY;
    const upTo = list.filter((x) => x.at <= cut);
    return (upTo.length > 0 ? upTo[upTo.length - 1] : list[list.length - 1])
      ?.verification ?? null;
  };
};

/** The latest `task_covers` codes of each task, by task record id. */
export const coversOf = (i: EscapeInputs): Map<string, string[]> =>
  new Map(i.covers.map((c) => [c.record_id, c.codes]));

/** Paths that say nothing about who owns what: lockfiles, root configuration, barrels and generated files. */
const SHARED_PATH =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|package\.json|tsconfig[^/]*\.json|index\.[a-z]+|README\.md)$|\.snap$|(^|\/)(__snapshots__|generated|dist)\//;
export const isOwnedPath = (path: string): boolean =>
  path.includes("/") && !SHARED_PATH.test(path);

/** Source code paths only: styles, tests and documents are shared by design and say nothing about a missing dependency. */
export const isCodePath = (path: string): boolean =>
  isOwnedPath(path) && !/\.(css|scss|md|snap)$|\.(spec|test)\.[a-z]+$|(^|\/)e2e\//.test(path);

/**
 * Shared infrastructure that belongs to nobody: touching a file somebody else added there is not evidence of a missing
 * dependency (convención nuestra, from the case-by-case validation of 01-10-2026, validacion-fugas-esc3 §2.2 FP-B).
 * Examples seen: `.github/workflows/ci.yml`, `scripts/migrate.ts`, `src/server/db.ts`, `src/design-system/TextField.tsx`,
 * `src/server/instance-state.ts`. GitHub CODEOWNERS assigns owners by path pattern and leaves shared paths without one;
 * which paths are shared is our convention.
 */
const INFRA_PATH =
  /(^|\/)\.github\/|(^|\/)scripts\/(migrate|db)[^/]*$|(^|\/)db\.[a-z]+$|(^|\/)(db|database)\/(client|index)[^/]*$|(^|\/)components\/ui\/|(^|\/)design-system\/|(^|\/)(TextField|Button|Input)\.[a-z]+$|(^|\/)instance-state\.[a-z]+$/;
export const isInfraPath = (path: string): boolean => INFRA_PATH.test(path);

/**
 * Feature needs: the features each feature is based on (`based_on` fdr -> fdr, current links), closed transitively.
 * The engine already makes a task wait for the tasks of the features its feature needs (queries/task-deps.ts
 * `featureNeeds`), so this is a declared dependency, not a missing one.
 */
export const featureNeedsOf = (i: EscapeInputs): Map<string, Set<string>> => {
  const currentN = new Map<string, number>();
  for (const v of i.versions)
    if (v.approved_at !== null) currentN.set(v.record_id, Math.max(currentN.get(v.record_id) ?? 0, v.n));
  const direct = new Map<string, Set<string>>();
  for (const l of i.links) {
    if (l.type !== "based_on" || l.from_type !== "fdr" || l.to_type !== "fdr" || l.state === "obsolete") continue;
    const n = currentN.get(l.from_record_id);
    if (n !== undefined && l.from_n !== n) continue;
    direct.set(l.from_record_id, (direct.get(l.from_record_id) ?? new Set()).add(l.to_record_id));
  }
  const out = new Map<string, Set<string>>();
  for (const f of direct.keys()) {
    const seen = new Set<string>();
    const stack = [...(direct.get(f) ?? [])];
    while (stack.length > 0) {
      const x = stack.pop() as string;
      if (seen.has(x)) continue;
      seen.add(x);
      for (const n of direct.get(x) ?? []) stack.push(n);
    }
    out.set(f, seen);
  }
  return out;
};

// esc-3: `evidence.introduced_at` is the moment the defective design artefact was approved (or created, for E11/E12), so
// the containment series attributes the escape to when the defect was introduced, not to when it was found (the
// anti-cheating rule decided with the person: a late discovery lowers the past). Omitted when not derivable.
const iso = (d: string | null | undefined): string | null => {
  const t = ms(d);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};
/** `{ introduced_at }` to spread into `evidence`, or nothing when the date is unknown. */
export const introducedAt = (d: string | null | undefined): { introduced_at?: string } => {
  const v = iso(d);
  return v ? { introduced_at: v } : {};
};
/** Approval of the version of `recordId` that stood approved at `at` (the latest approved by then; else the first). */
export const approvalOf = (i: EscapeInputs, recordId: string, at?: string | null): string | null => {
  const approved = i.versions
    .filter((v) => v.record_id === recordId && v.approved_at !== null)
    .sort((a, b) => ms(a.approved_at) - ms(b.approved_at));
  if (approved.length === 0) return null;
  const cut = at ? ms(at) : Number.POSITIVE_INFINITY;
  const upTo = approved.filter((v) => ms(v.approved_at) <= cut);
  return (upTo.length > 0 ? upTo[upTo.length - 1] : approved[0])?.approved_at ?? null;
};
/** Approval of the version that carried criterion `code` as it stood at `at`. */
export const criterionApprovalAt = (i: EscapeInputs, code: string | null | undefined, at?: string | null): string | null => {
  if (!code) return null;
  const ids = new Set(i.criteria.filter((c) => c.code === code).map((c) => c.record_version_id));
  const cut = at ? ms(at) : Number.POSITIVE_INFINITY;
  const vs = i.versions
    .filter((v) => ids.has(v.id) && v.approved_at !== null && ms(v.approved_at) <= cut)
    .sort((a, b) => ms(a.approved_at) - ms(b.approved_at));
  return vs[vs.length - 1]?.approved_at ?? null;
};
