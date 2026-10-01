// Types shared by the escape rules (salud-del-harness §4). A rule is a pure function of `EscapeInputs`, which is plain
// stored rows read once per project by `loadEscapeInputs`: no database, no clock and no model inside a rule.
// Phases follow the path of design doc §2.2 (P1 definition … P13 use). `P0` means «outside the path»: a process
// failure with no design phase to blame (E10). Every attribution below is our convention, written in code under
// `ESCAPES_RULES_VERSION`; the containment measure itself comes from Motorola (Daskalantonakis 1992; Kan, ch. 4).

export const ESCAPES_RULES_VERSION = "esc-1";

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
