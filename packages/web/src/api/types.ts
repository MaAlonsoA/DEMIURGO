// Shapes of the API responses the UI reads. They mirror packages/core/src/queries/read.ts and
// packages/api/src/queries.ts: when both disagree, the code of the API rules.

import type { RunUsage } from './models.ts';

export type Epistemic = 'confirmed' | 'proposed' | 'pending' | 'unknown';

export type Actor =
  | { type: 'human'; person: string }
  | { type: 'agent_external'; name: string; session: string }
  | { type: 'agent_run'; run: string }
  | { type: 'system'; component: string; version: string };

export type Session = {
  actor: Actor;
  type: 'person' | 'agent';
  csrf: string | null;
  /** The language the person reads in ('en' | 'es'); null follows the browser. */
  locale?: string | null;
};

/** A record's text in the person's language, for reading only (GET …/translations/:subject/:id). */
export type ReadingTranslation = {
  subject: string;
  id: string;
  lang: string;
  source: Record<string, string>;
  fields: Record<string, string>;
  translated: boolean;
  by: string | null;
};

export type Project = {
  id: string;
  name: string;
  state: string;
  created_at: string;
};

// Tables (GET /api/tables) and command contracts (GET /api/commands).
export type ActorType = 'human' | 'agent_external' | 'agent_run' | 'system';
export type CommandDef = {
  entity: string;
  allowed: ActorType[];
  decisive: boolean;
  description: string;
};
export type TransitionDef = {
  command: string;
  from: 'new' | string[];
  to: string;
  guards?: string[];
};
export type EntityDef = {
  label: string;
  implemented_in: string;
  states: Record<string, string>;
  authority: string[];
  transitions: TransitionDef[];
};
export type Tables = {
  capabilities: {
    commands: Record<string, CommandDef>;
    queries: Record<string, { allowed: ActorType[] }>;
  };
  transitions: { entities: Record<string, EntityDef> };
};
export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  enum?: unknown[];
  items?: JsonSchema;
  maxLength?: number;
  minLength?: number;
  default?: unknown;
  description?: string;
  anyOf?: JsonSchema[];
};
export type CommandContract = CommandDef & {
  implemented: boolean;
  data: JsonSchema | null;
};
export type CommandCatalog = Record<string, CommandContract>;

export type CommandResponse<R = unknown> = {
  entity: string;
  entity_id: string;
  state: string;
  seq: number;
  result: R | null;
};

export type Readiness = {
  ready: boolean;
  reasons: string[];
  warnings: string[];
};

export type RecordType =
  | 'decision'
  | 'epic'
  | 'fdr'
  | 'task'
  | 'adr'
  | 'bug'
  | 'requirement'
  | 'quality_requirement'
  | 'threat_model'
  | 'production_readiness'
  | 'product_definition'
  | 'design_system'
  | 'screen_design';

/** Where a section of the product definition comes from, and how the person settled its question. */
export type DefinitionSource = {
  section: string;
  key: string;
  state: 'confirmed' | 'discarded' | 'missing';
  question: {
    id: string;
    question: string;
    settled: 'assumed' | 'corrected' | 'answered' | 'left_open' | null;
    settled_by: string | null;
    settled_at: string | null;
    inferred: string | null;
    evidence: { message_id: string; quote: string }[];
    /** The answer as the person wrote it, when DEMIURGO put it into English. */
    own_words: string | null;
  } | null;
};

/** Why a section changed, and the person's own words for it when they wrote it in another language. */
export type DefinitionReason = {
  section: string;
  why: string;
  own_words: string | null;
};

export type DefinitionEvidence = { message_id: string; quote: string };

export type DefinitionVersion = {
  id: string;
  n: number;
  state: string;
  title: string;
  sections: Section[];
  change_note: string | null;
  author: string;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
  proposal_id: string | null;
  /** When a change decided in a thread made it: the proposal, its thread and the person's words there. */
  from_thread: {
    proposal_id: string;
    exploration_id: string | null;
    evidence: DefinitionEvidence[];
  } | null;
  sources: DefinitionSource[];
  reasons: DefinitionReason[];
};

/** A change to one section proposed in a thread, waiting for the person. */
export type DefinitionChange = {
  id: string;
  batch_id: string;
  created_at: string;
  exploration_id: string | null;
  base: { code: string; version: number };
  section: string;
  content: string;
  reason: string;
  evidence: DefinitionEvidence[];
};

/**
 * GET …/definition: the product definition's versions (newest first), the one proposed, if any, and
 * the changes proposed in threads.
 */
export type ProductDefinition = {
  record: { id: string; code: string } | null;
  versions: DefinitionVersion[];
  proposal: {
    id: string;
    batch_id: string;
    created_at: string;
    base: { code: string; version: number } | null;
    title: string;
    sections: Section[];
    change_note: string | null;
    sources: DefinitionSource[];
    reasons: DefinitionReason[];
  } | null;
  changes: DefinitionChange[];
};

/** A task's effort size (FDR-DEL-006): null size is a legacy task ("No size"); the opinion is Jev's, while it is on. */
export type TaskSize = 'XS' | 'S' | 'M' | 'L' | 'XL';
export type TaskEffort = {
  size: TaskSize | null;
  points: number | null;
  opinion: { id: string; size: TaskSize; confidence: number; classifier_id: string; created_at: string } | null;
  dispute: 'none' | 'disputed' | 'dismissed';
};

export type ProductRow = {
  id?: string;
  code: string;
  type: RecordType;
  domain: string;
  /** The aspect of the product it is about (domain/aspects.ts); null until classified. */
  aspect: string | null;
  title: string;
  current: number | null;
  latest: { n: number; state: string };
  epistemic_status: Epistemic;
  readiness: Readiness | null;
  implementation: string;
  /** The person's place of an epic in the backlog (1 first); null for other records or an epic not placed yet. */
  epic_position?: number | null;
  /** Code of what it rests on (an epic, the product definition or a decision), if any. */
  based_on: string | null;
  /** Codes of the features this feature needs built first. */
  needs: string[];
  /** First paragraph of the latest version: the card's one line. */
  summary: string;
  /** Criteria of the latest version. */
  checks: number;
  effort?: TaskEffort | null;
  /** A task's covered feature criteria (codes); null for any other record. */
  covers?: string[] | null;
  latest_id: string;
  current_id: string | null;
  updated_at: string;
  updated_by: string;
  /** Thread the latest version comes from, if any. */
  origin_exploration: string | null;
};

export type ExplorationSummary = {
  id: string;
  purpose: string;
  state: string;
  parent_id: string | null;
  origin_type: string | null;
  origin_id: string | null;
  /** Questions shown to the person now (the same count as Needs you). */
  open_questions: number;
  /** Questions DEMIURGO keeps in reserve for later. */
  reserve_questions?: number;
};

/** A feature an epic lists: its reserved code, name and sentence; `designed` once its record exists. */
export type PlannedFeatureRow = {
  id: string;
  code: string;
  epic_code: string;
  name: string;
  summary: string;
  position: number;
  state: 'planned' | 'designed';
};

export type InceptionAction =
  | { kind: 'answer_stage'; stage: string; thread: string | null }
  | { kind: 'pass_stage'; stage: string; stageId: string; thread: string | null }
  | { kind: 'open_stage'; stage: string }
  | { kind: 'approve'; code: string }
  | { kind: 'design_system' }
  | { kind: 'epics' }
  | { kind: 'feature'; code: string }
  | { kind: 'repository' }
  | { kind: 'build'; code: string | null }
  | { kind: 'review_definition' }
  | { kind: 'plan_backlog'; thread: string | null }
  | { kind: 'review_batch'; batch: string; count?: number }
  | { kind: 'thread'; thread: string }
  | { kind: 'waiting'; what: 'quality_requirements' };

export type InceptionStep = {
  key: string;
  title: string;
  state: 'done' | 'current' | 'todo' | 'skipped';
  why: string;
  blocks: string | null;
  source: string;
  action: InceptionAction | null;
};

/** The path from a new project to its first build (absent on an older API). */
export type InceptionPath = { steps: InceptionStep[]; current: string | null; done: number; total: number };

export type ProductState = {
  /** Where the project is on the way to its first build (absent on an older API). */
  inception?: InceptionPath;
  project: { id: string; name: string; state: string };
  /** The features each epic lists, in order (absent on an older API). */
  planned?: PlannedFeatureRow[];
  decisions: ProductRow[];
  designs: ProductRow[];
  ready_to_build: string[];
  explorations: ExplorationSummary[];
  inbox: { total: number };
};

export type Dependency = {
  type: string;
  id: string;
  code?: string;
  version: number | null;
};

export type InboxProposal = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  state: string;
  /** Its place (from 1) among every proposal of its batch, decided or not. */
  ordinal?: number;
  epistemic_status: Epistemic;
  obsolescence: string[];
  assessment: IdeaAssessmentSummary | null;
  dependencies: Dependency[];
  /** What Jev says the proposal's own text is about; null until classified. */
  aspect_check?: AspectCheck | null;
  basis_refs?: BasisRefs;
};

export type AspectCheck = { aspect: string; confidence: number };

/** The threads behind the messages and questions a proposal is based on. */
export type BasisRefs = {
  messages: {
    id: string;
    exploration_id: string;
    exploration_purpose: string;
    parent_purpose: string | null;
    body: string;
    aspect: string | null;
    aspect_confidence: number | null;
  }[];
  questions: {
    id: string;
    question: string;
    exploration_id: string;
    exploration_purpose: string;
  }[];
};

export type IdeaFinding = {
  /** duplicates, contradicts or relates. */
  verdict: string;
  node?: string;
  ref?: string;
  label?: string;
  quote?: string;
  [k: string]: unknown;
};
export type IdeaAssessmentSummary = {
  findings?: IdeaFinding[];
  [k: string]: unknown;
};

export type InboxBatch = {
  id: string;
  /** agent, system_package, knowledge or import. */
  type: string;
  producer: string;
  /** item or package. */
  resolution: string;
  summary: string | null;
  run_id: string | null;
  created: string;
  /** How many proposals the batch holds in all, decided or not. */
  size?: number;
  dependencies: Dependency[];
  proposals: InboxProposal[];
};

export type InboxQuestion = {
  id: string;
  exploration_id: string;
  question: string;
  reason?: string | null;
  /** Predefined answers proposed by the agent, with what each one implies. */
  options?: { answer: string; implies: string; exclusive?: boolean; recommended?: boolean; downside?: string }[];
  /** Several options may be picked. */
  multiple?: boolean;
  state: string;
  conclusion?: string | null;
  reasoning?: string | null;
  state_reason?: string | null;
  raised_by: string;
  epistemic_status: Epistemic;
};

export type InboxVersion = {
  id: string;
  code: string;
  type: RecordType;
  n: number;
  title: string;
  approvable: boolean;
  epistemic_status: Epistemic;
};

export type InboxLink = {
  id: string;
  type: string;
  from_type: string;
  from_id: string;
  from_version: number | null;
  to_type: string;
  to_id: string;
  to_version: number | null;
  state: string;
  created_by: string;
  epistemic_status: Epistemic;
  from_code: string;
  from_n: number;
  from_title: string;
  to_code: string;
  to_n: number;
  to_title: string;
};

export type NextStepNeed = {
  key: string;
  title: string;
  action: 'pass_stage' | 'open_stage' | 'design_system' | 'epics' | 'feature' | 'repository' | 'build' | 'plan_backlog' | 'answer_stage' | 'thread';
  code: string | null;
};

export type Inbox = {
  total: number;
  batches: InboxBatch[];
  questions_to_confirm: InboxQuestion[];
  open_questions: InboxQuestion[];
  versions_to_approve: InboxVersion[];
  links_under_review: InboxLink[];
  suspect_records?: SuspectRecord[];
  /** The onboarding step that waits on the person, when it is theirs to take (domain nextStepNeed). */
  next_step?: NextStepNeed | null;
  classifications_to_review: {
    id: string;
    node_ref: string;
    axis: string;
    category: string;
    confidence: number;
    justification: string;
    classifier: string;
    epistemic_status: Epistemic;
  }[];
  rejected_updates: {
    id: string;
    trigger: unknown;
    failure: string | null;
    created_at: string;
    epistemic_status: Epistemic;
  }[];
};

export type CriterionState = 'verified' | 'failing' | 'in_pr' | 'no_evidence' | 'check_by_hand' | 'not_started';
export type TaskBuildState = 'to_do' | 'requested' | 'in_pr' | 'merged' | 'failing';

export type BuildStage = 'repo' | 'worktree' | 'environment' | 'builder' | 'commit' | 'design' | 'push' | 'pr' | 'status' | 'ci' | 'evidence' | 'review' | 'publish' | 'merge' | 'main';
export type BuildOutcome = 'started' | 'ok' | 'failed' | 'waiting' | 'changes_requested' | 'cancelled';
export type BuildStep = { attempt: number; stage: BuildStage; outcome: BuildOutcome; detail: unknown; at: string };

export type Criterion = {
  id: string;
  code: string;
  title: string;
  statement: string;
  /** automatic or manual. */
  verification: string;
  check: string;
  /** The 1-based step of the Behavior it checks; null when it is not tied to one. */
  step?: number | null;
  /** new, kept or modified. */
  carry: string;
  /** Its latest evidence (inherited from the criterion it carries when kept), or null if unchecked. */
  evidence?: CriterionEvidence | null;
  /** The Given / When / Then parts, null when the criterion has none. */
  given?: string | null;
  when?: string | null;
  then?: string | null;
  /** Result of its latest evidence (pass or fail); null without evidence or without a result. */
  evidence_result?: 'pass' | 'fail' | null;
  /** Computed delivery state (never stored). */
  state?: CriterionState;
};

export type CriterionEvidence = {
  /** manual (the person recorded it) or system (the runner, later). */
  kind: string;
  note: string;
  reference: string | null;
  pr_url?: string | null;
  test_name?: string | null;
  by: string;
  at: string;
  /** Version it was recorded on: an earlier one when inherited. */
  version: number;
  result?: 'pass' | 'fail' | null;
};

export type Link = {
  id: string;
  /** What it points to: its record, version, title and state (null if the target is not a version). */
  to_code?: string | null;
  to_n?: number | null;
  to_title?: string | null;
  to_state?: string | null;
  to_current?: boolean;
  type: string;
  from_type: string;
  from_id: string;
  from_version: number | null;
  to_type: string;
  to_id: string;
  to_version: number | null;
  state: string;
  created_by: string;
  created_at: string;
};

export type Section = { title: string; content: string };

/** The machine-readable part of a design system version (mirrors `designSystemSpec` in the domain). */
export type DesignSystemSpec = {
  base: { kind: 'public' | 'scratch'; name?: string; url?: string; license?: string };
  principles: string[];
  tokens: {
    color: Record<string, { $value: { light: string; dark: string }; $type: 'color'; $description?: string }>;
    typography: {
      family: Record<string, { $value: string | string[]; $type: 'fontFamily'; $description?: string }>;
      size: Record<string, { $value: string; $type: 'dimension'; $description?: string }>;
      lineHeight: Record<string, { $value: number; $type: 'number'; $description?: string }>;
    };
    space: Record<string, { $value: string; $type: 'dimension'; $description?: string }>;
    radius: Record<string, { $value: string; $type: 'dimension'; $description?: string }>;
    shadow: Record<string, { $value: string; $description?: string }>;
    motion: {
      duration: Record<string, { $value: string; $type: 'duration'; $description?: string }>;
      easing: Record<
        'standard' | 'entrance' | 'exit',
        { $value: [number, number, number, number]; $type: 'cubicBezier'; $description?: string }
      >;
      scheme: 'productive' | 'expressive';
      reduced: string;
    };
  };
  components: {
    name: string;
    purpose: string;
    interactive: boolean;
    variants: string[];
    states: string[];
    accessibility: string;
    specimen_html: string;
  }[];
  patterns: { name: string; purpose: string; uses: string[] }[];
  paths: { system: string };
};

export type RecordVersion = {
  id: string;
  /** Design system only: the machine-readable spec of the version. */
  spec?: DesignSystemSpec | null;
  n: number;
  state: string;
  epistemic_status: Epistemic;
  current: boolean;
  title: string;
  sections: Section[];
  annexes: { path: string; content: string }[];
  change_note: string | null;
  origin: { type: string; id: string; version?: number | null } | null;
  author: string;
  approved_by: string | null;
  created_at: string;
  approved_at: string | null;
  /** Thread the version comes from (through its proposal, batch and run), if any. */
  origin_exploration: string | null;
  /** Inferred questions of that thread not confirmed yet: a readiness warning (◐). */
  inferred_questions: {
    id: string;
    question: string;
    conclusion: string | null;
  }[];
  criteria: Criterion[];
  /** Real practices the version rests on (free-form objects). */
  practice_sources?: unknown[];
  links: Link[];
  readiness: Readiness | null;
};

export type TaskDraft = {
  proposal_id: string;
  batch_id: string;
  resolution: 'item' | 'package';
  title: string;
  size: string | null;
  covers: string[];
};

export type FeatureTask = {
  code: string;
  title: string;
  size: string | null;
  covers: string[];
  build: TaskBuildState;
  dropped?: boolean;
};

type TaskLink = { ref: string; title: string; code: string | null; state: string };

/** A task's whole page: the same shape for an approved task and for a draft the task planner proposed. */
/** A comment of the reviewer agent: where (path and line) and what, with its severity. */
export type ReviewComment = { path: string; line: number | null; severity: string; body: string };

export type TaskView = {
  draft: null | {
    proposal_id: string;
    batch_id: string;
    resolution: 'item' | 'package';
    state: 'pending' | 'accepted' | 'rejected';
    siblings: number;
  };
  code: string | null;
  title: string;
  state: string;
  version: { n: number; state: string; change_note: string | null } | null;
  goal: string;
  scope: string;
  size: 'XS' | 'S' | 'M' | 'L' | 'XL' | null;
  size_reason: string | null;
  split: string | null;
  walking_skeleton: boolean;
  feature: { code: string; version: number; title: string; current_version: number; epic: { code: string; title: string } | null };
  order: { n: number; of: number };
  covers: {
    code: string;
    title: string;
    given: string | null;
    when: string | null;
    then: string | null;
    statement: string;
    step: number | null;
    state: string;
  }[];
  depends_on: TaskLink[];
  blocks: TaskLink[];
  dod: { item: string; met: boolean }[];
  development: {
    branch: string | null;
    pr_url: string | null;
    pr_number: number | null;
    checks: { name: string; state: string }[];
    review: { verdict: string; summary: string; comments: ReviewComment[] } | null;
    evidence: { criterion: string; result: string; test_name: string | null }[];
  } | null;
  sources: { title: string; url: string | null; note: string | null }[];
  provenance: {
    proposed_by: { agent: string; run_id: string; engine: string | null } | null;
    thread: { id: string; title: string } | null;
    accepted_by: string | null;
    accepted_at: string | null;
    approved_at: string | null;
  };
  history: { n: number; state: string; change_note: string | null; created_at: string; author: string }[];
};

export type RecordDetail = {
  id: string;
  /** Design system only: non-blocking notes on the shown version. */
  warnings?: string[];
  /** Screen design only: the approved design system it is checked against, and the components it uses that the system lacks. */
  dsy?: { code: string; version: number } | null;
  missing_components?: string[];
  /** Feature: `dsy` is the approved design system (screens come before tasks while there is one). */
  /** Feature only: the screen design based on its current version (null when it has none). */
  screens?: { code: string; version: number; state: string; no_ui: boolean; screen_count: number; missing_components: string[] } | null;
  /** Feature: the screens that rest on an older version (when the current one has none). */
  screens_outdated?: { code: string; version: number; state: string; feature_version: number; no_ui: boolean; screen_count: number } | null;
  code: string;
  type: RecordType;
  domain: string;
  /** The aspect of the product it is about (domain/aspects.ts); null until classified. */
  aspect: string | null;
  current: number | null;
  implementation: string;
  effort?: TaskEffort | null;
  covers?: string[] | null;
  /** Latest size (feature or task), null otherwise. */
  size?: string | null;
  /** Task only: computed build state and its build request. */
  build?: {
    state: TaskBuildState;
    /** While 'to_do': the version merged before the current one (it has to be built again), else null. */
    rebuild_from?: number | null;
    request: { state: string; pr_url: string | null } | null;
    /** Automatic build (builder agent, pull request, CI, reviewer agent, merge). */
    steps?: BuildStep[];
    pr_url?: string | null;
    branch?: string | null;
    review?: { verdict: 'approve' | 'request_changes'; summary: string; comments_count: number; comments?: ReviewComment[] } | null;
    /** Whether GitHub is configured for an automatic build. */
    github?: boolean;
  };
  /** Feature only: its tasks, the criteria of its current version no task covers, and its Definition of Done. */
  tasks?: FeatureTask[];
  /** Feature only: the tasks proposed and still undecided, drafts of one package per planning run. */
  task_drafts?: TaskDraft[];
  /** Task only: its whole page. */
  task?: TaskView | null;
  uncovered?: string[];
  dod?: { done: boolean; missing: string[] } | null;
  versions: RecordVersion[];
  /** What connects to it: links of the other records' shown version that point to one of its versions. */
  incoming: IncomingLink[];
  /** What this record rests on has a newer approved version since its current version was written. */
  suspect?: SuspectRef[];
};

/** Deterministic impact (suspect link): based on `upstream` v`from`, which is now v`to`. */
export type SuspectInfo = { upstream: string; from: number; to: number };

export type SuspectRef = SuspectInfo & { link_id: string; upstream_title: string; from_version_id: string };

/** A record to review after a change upstream (Needs you). */
export type SuspectRecord = {
  link_id: string;
  link_type: string;
  from_code: string;
  from_type: string;
  from_n: number;
  from_title: string;
  from_version_id: string;
  upstream_title: string;
  suspect: SuspectInfo;
};

export type IncomingLink = {
  id: string;
  type: string;
  state: string;
  from_code: string;
  from_type: RecordType;
  from_n: number;
  from_title: string;
  /** The version of this record it points to. */
  to_n: number;
  /** What the map draws for it; null for links the map doesn't draw (origin, covers). */
  relation: 'needs' | 'follows' | 'conflicts' | 'affects' | null;
  /** The record is based on an older version of this one than its current: review it. */
  suspect: SuspectInfo | null;
};

export type Message = {
  id: string;
  exploration_id: string;
  question_id: string | null;
  author: string;
  run_id: string | null;
  kind: string | null;
  body: string;
  state: string;
  created_at: string;
  epistemic_status: Epistemic | null;
  /** Where DEMIURGO's answer stands; null when the message asked for none. */
  response: 'waiting' | 'requested' | 'abandoned' | null;
  /** The run that answers it, once requested. */
  response_run: string | null;
  /** What Jev says the message is about, and how sure it is. */
  aspect?: string | null;
  aspect_confidence?: number | null;
};

export type Question = {
  id: string;
  exploration_id: string;
  question: string;
  reason: string | null;
  impact: string | null;
  conclusion: string | null;
  reasoning: string | null;
  state: string;
  state_reason: string | null;
  raised_by: string;
  created_at: string;
  epistemic_status: Epistemic;
  /** Predefined answers proposed by the agent, with what each one implies. */
  options?: { answer: string; implies: string; exclusive?: boolean; recommended?: boolean; downside?: string }[];
  /** The answer its side conversation (Go deeper) led to, worded by DEMIURGO as one more option. */
  conversation_option?: { answer: string; implies: string } | null;
  stage_id?: string | null;
  stage_key?: string | null;
  /** Several options may be picked. */
  multiple?: boolean;
  /** When it was shown in its thread; null while it waits in the reserve. */
  shown_at?: string | null;
  /** The person's exact words an inference rests on, each with its message. */
  evidence?: { message_id: string; quote: string }[];
};

export type ExplorationDetail = {
  id: string;
  project_id: string;
  parent_id: string | null;
  purpose: string;
  origin_type: string | null;
  origin_id: string | null;
  origin_version: number | null;
  state: string;
  state_reason: string | null;
  opened_by: string;
  created_at: string;
  messages: Message[];
  questions: Question[];
  children: { id: string; purpose: string; state: string }[];
  /** What its "Draft" button writes (one dedicated agent per kind), or null when nothing can be drafted here. */
  draft?: {
    kind: 'epic' | 'feature' | 'tasks' | 'design_directions' | 'design_system' | 'screens';
    pending?: { runId: string | null; batchId: string | null } | null;
    why: string | null;
    suggested: boolean;
    action: 'epic_plan' | 'feature_design' | 'task_plan' | 'design_directions' | 'design_system_plan' | 'screen_design';
    scope: { type: string; id: string };
  } | null;
};

export type Exploration = Omit<ExplorationDetail, 'messages' | 'questions' | 'children' | 'draft'> & {
  open_questions: number;
  reserve_questions?: number;
  /** Codes of the records its proposals target (pending or accepted). */
  affects?: string[];
  last_activity: string;
};

export type Proposal = {
  id: string;
  batch_id: string;
  position: number;
  type: string;
  payload: Record<string, unknown>;
  dependencies: Dependency[];
  state: string;
  resolution: Record<string, unknown> | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  epistemic_status: Epistemic;
  aspect_check?: AspectCheck | null;
  basis_refs?: BasisRefs;
};

export type BatchDetail = {
  id: string;
  project_id: string;
  kind: string;
  producer: string;
  run_id: string | null;
  context_pack_id: string | null;
  /** item or package. */
  resolution_mode: string;
  dependencies: Dependency[];
  summary: string | null;
  tree_hash: string | null;
  state: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
  proposals: Proposal[];
  /** Only for an import: the counts of design/ when imported and those of this package. */
  import_counts?: { origin: ImportCounts | null; package: ImportCounts };
};

export type ImportCounts = Record<
  'decision' | 'adr' | 'fdr' | 'bug' | 'versions' | 'criteria' | 'links' | 'taxonomies' | 'annexes',
  number
>;

export type ContextPack = {
  id: string;
  role: string;
  builder: string;
  budget: Record<string, unknown>;
  graph_version: string;
  dependencies: Dependency[];
  content: unknown;
  hash: string;
};

/** Median and 80th percentile, in seconds, of the last completed runs of an action. */
export type TypicalDuration = { median_s: number; p80_s: number; n: number };

export type Run = {
  id: string;
  project_id: string;
  action: string;
  scope: { type: string; id?: string; version?: number };
  method: string;
  schema_version: string;
  provider: string;
  model: string | null;
  context_pack_id: string | null;
  retry_of: string | null;
  state: string;
  failure_kind: string | null;
  error: string | null;
  output: unknown;
  usage: RunUsage | null;
  requested_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  /** The DEMIURGO agent that ran it and how (FDR-AGE-002); null on runs from before the agents. */
  agent?: string | null;
  requested_model?: string | null;
  effort?: string | null;
  prompt_hash?: string | null;
  session_mode?: 'none' | 'fresh' | 'resumed' | null;
  provider_session_id?: string | null;
  delta_hash?: string | null;
  /** It ran on its backup engine: the one it replaced, and why. */
  fallback?: {
    from: { provider: string; model: string; effort: string | null };
    reason: string;
  } | null;
};

export type RunDetail = Run & {
  context_pack: ContextPack | null;
  trace_id: string | null;
  typical?: TypicalDuration | null;
};

export type EventRow = {
  id: string;
  project_id: string;
  seq: string;
  at: string;
  actor: string;
  command: string;
  entity_type: string;
  entity_id: string;
  entity_version: number | null;
  state_before: string | null;
  state_after: string | null;
  before: unknown;
  after: unknown;
  cause: unknown;
};

export type Source = {
  id: string;
  name: string;
  content_hash: string;
  registered_by: string;
  created_at: string;
};

export type KnowledgeUpdate = {
  id: string;
  state: string;
  trigger: unknown;
  failure: string | null;
  graph_version_before: string | null;
  graph_version_after: string | null;
  created_at: string;
};

export type Knowledge = {
  graph_version: number;
  up_to_date: boolean;
  updates_in_progress: number;
  fingerprint: string;
  current_nodes: number;
  current_edges: number;
  updates: KnowledgeUpdate[];
};

/** A search result over the current knowledge (GET …/knowledge/search). */
export type SearchResult = {
  ref: string;
  type: string;
  title: string;
  excerpt: string;
  epistemic_status: string;
  rank: number;
};

/** A run in the list (GET …/runs): its thread is its scope, or where its decision was born. */
/** A run request the server queued while knowledge updates: no run exists yet. */
export type QueuedRun = { key: string; action: string; scope_id: string; created_at: string };

export type RunListItem = {
  id: string;
  state: string;
  action: string;
  scope: { type: string; id?: string; version?: number };
  provider: string;
  model: string | null;
  agent?: string | null;
  requested_model?: string | null;
  effort?: string | null;
  session_mode?: string | null;
  retry_of: string | null;
  failure_kind: string | null;
  error: string | null;
  requested_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  context_pack_hash: string | null;
  exploration_id: string | null;
  /** Batch the run produced, if any. */
  batch_id: string | null;
  /** How long this action usually takes (last 20 completed runs); only for runs in progress. */
  typical?: TypicalDuration | null;
};

export type GraphNode = {
  ref: string;
  type: string;
  label: string;
  excerpt: string;
  epistemic_status: string;
  /** Taxonomy axis → category, from the node's classification. */
  areas: Record<string, string>;
  state: 'current' | 'invalidated';
  record: { code: string; version: number } | null;
};

export type GraphEdge = {
  type: string;
  from: string;
  to: string;
  state: string;
};

export type KnowledgeGraph = {
  graph_version: number;
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export type IdeaAssessment = {
  id: string;
  graph_version: number;
  classifier: string;
  created_at: string;
  error: string | null;
  proposal: {
    id: string;
    type: string;
    title: string | null;
    batch_id: string;
    state: string;
  };
  findings: {
    /** duplicates, contradicts or relates. */
    verdict: string;
    citation: string;
    label: string | null;
    record: { code: string; version: number } | null;
    epistemic_status: string | null;
    confidence: number | null;
    justification: string | null;
  }[];
};

export type Taxonomy = {
  id: string;
  code: string;
  version: number;
  title: string;
  axes: unknown;
  sections: Section[];
  state: string;
  author: string;
  created_at: string;
  approved_at: string | null;
  approved_by: string | null;
};

/** "What changed" since an event id (GET …/changes?since=): the events grouped by the thing they touch. */
export type ChangedThing = {
  kind: 'record' | 'exploration' | 'batch' | 'knowledge' | 'project';
  /** Record code, exploration id, batch id, "knowledge" or the project id. */
  key: string;
  title: string | null;
  /** The record's type, or the batch's kind. */
  record_type?: string;
  events: Omit<EventRow, 'project_id' | 'seq' | 'before' | 'after' | 'cause'>[];
};

export type Changes = { latest: string; things: ChangedThing[] };

/** An external agent's key: its name and state. The secret is only shown once, when issued. */
export type AgentToken = {
  id: string;
  name: string;
  state: 'active' | 'revoked';
  issued_by: string;
  created_at: string;
  revoked_at: string | null;
};

export type StageRow = {
  key: string;
  title: string;
  produces: string;
  /** When it opens: in the onboarding, before building (on the approved features) or before the first version. */
  moment: 'onboarding' | 'before_build' | 'before_release';
  position: number;
  id: string | null;
  state: 'not_started' | 'open' | 'passed';
  exploration_id: string | null;
  passed_by: string | null;
  passed_at: string | null;
  total: number;
  covered: number;
  questions: { id: string; key: string; question: string; state: string }[];
};

export type ProjectUsageRow = {
  agent: string;
  calls: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  declaredCostUsd: number;
  avgDurationMs: number | null;
};

/** A word of the project's glossary and the English term records use for it (GET …/glossary). */
export type GlossaryEntry = {
  term: string;
  english: string;
  note: string | null;
  set_by: string;
  created_at: string;
};

/** The project's repository and the commits DEMIURGO made in it (GET …/commits), newest first. */
export type ProjectCommits = {
  dir: string | null;
  /** The project's private GitHub repository, or null while it is not connected. */
  github: { owner: string; repo: string; url: string; protection: 'github' | 'demiurgo'; connected_at: string } | null;
  /** Whether this DEMIURGO has the GitHub token and owner (never the token itself). */
  github_configured: boolean;
  commits: {
    sha: string;
    message: string;
    actor: string;
    files: string[];
    at: string;
    record: { code: string; version: number } | null;
  }[];
};

/** An open build request on a task (FDR-BUI-002): who asked and when; stale when its task changed. */
export type BuildRequestView = {
  id: string;
  task_version: number | null;
  requested_by: string;
  requested_at: string;
  /** requested, or in_review once the pull request is recorded. */
  state: string;
  pr_url: string | null;
  stale: boolean;
  stale_reasons: string[];
};

/** A line of the Build page, in the server's build order. */
export type QueueTask = {
  code: string;
  title: string;
  version: number | null;
  feature: { code: string; title: string } | null;
  epic: { code: string; title: string } | null;
  size: TaskSize | null;
  points: number | null;
  checks: number;
  request: BuildRequestView | null;
  github?: boolean;
  stage?: { stage: BuildStage; outcome: BuildOutcome; failure?: { kind: string; excerpt: string | null } } | null;
};

export type DeliverySummary = {
  tasks: number;
  lead_median: number | null;
  lead_p90: number | null;
  builder_median: number | null;
  ci_median: number | null;
  review_median: number | null;
  first_pass: { merged_first_try: number; of: number } | null;
};

/** Delivery metrics computed from the build steps (DORA lead time and change failure rate). */
export type DeliveryMetrics = {
  merged: {
    code: string;
    merged_at: string;
    lead_minutes: number;
    attempts: number;
    stage_minutes: { builder: number; environment: number; ci: number; review: number };
    model: string | null;
  }[];
  last10: DeliverySummary;
  all: DeliverySummary;
  by_model_last10: { model: string; tasks: number; lead_median: number | null; builder_median: number | null; ci_median: number | null; review_median: number | null }[];
  by_model_all: { model: string; tasks: number; lead_median: number | null; builder_median: number | null; ci_median: number | null; review_median: number | null }[];
  running: { code: string; elapsed_minutes: number; stage: string; outcome: string; attempt: number }[];
};

export type BuildQueue = {
  ready: QueueTask[];
  /** Tasks a person put on hold with a reason: the queue skips them. */
  held: (QueueTask & { hold: { reason: string; held_by: string; held_at: string } })[];
  waiting: (QueueTask & { reasons: string[] })[];
  stale: QueueTask[];
  built: (QueueTask & { pr_url: string | null; done_at: string | null })[];
  totals: { tasks: number; points: number; unsized: number };
  repository: { path: string | null; branch: string; merge_rule_by_demiurgo?: boolean };
  delivery?: DeliveryMetrics;
  /** «Build the queue»: the project's flag and what the queue is doing. */
  auto?: {
    on: boolean;
    /** How many builds run at once at most (1 to 3). */
    parallel: number;
    building: string | null;
    /** Every task being built now. */
    builds: string[];
    next: string | null;
    stopped: {
      code: string;
      kind: 'needs_you' | 'ended' | 'stale' | 'manual_review' | 'waiting' | 'main_red';
      tried: number | null;
      failure_kind?: string | null;
    } | null;
    /** Flaky tests the last builds quarantined (they did not block their pull request). */
    quarantined?: string[];
  };
};
