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
  | 'product_definition';

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
  open_questions: number;
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

export type ProductState = {
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

export type Inbox = {
  total: number;
  batches: InboxBatch[];
  questions_to_confirm: InboxQuestion[];
  open_questions: InboxQuestion[];
  versions_to_approve: InboxVersion[];
  links_under_review: InboxLink[];
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

export type BuildStage = 'repo' | 'worktree' | 'builder' | 'commit' | 'push' | 'pr' | 'status' | 'ci' | 'evidence' | 'review' | 'publish' | 'merge';
export type BuildOutcome = 'started' | 'ok' | 'failed' | 'waiting' | 'changes_requested';
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

export type RecordVersion = {
  id: string;
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

export type FeatureTask = {
  code: string;
  title: string;
  size: string | null;
  covers: string[];
  build: TaskBuildState;
  dropped?: boolean;
};

export type RecordDetail = {
  id: string;
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
    request: { state: string; pr_url: string | null } | null;
    /** Automatic build (builder agent, pull request, CI, reviewer agent, merge). */
    steps?: BuildStep[];
    pr_url?: string | null;
    branch?: string | null;
    review?: { verdict: 'approve' | 'request_changes'; summary: string; comments_count: number } | null;
    /** Whether GitHub is configured for an automatic build. */
    github?: boolean;
  };
  /** Feature only: its tasks, the criteria of its current version no task covers, and its Definition of Done. */
  tasks?: FeatureTask[];
  uncovered?: string[];
  dod?: { done: boolean; missing: string[] } | null;
  versions: RecordVersion[];
  /** What connects to it: links of the other records' shown version that point to one of its versions. */
  incoming: IncomingLink[];
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
    kind: 'epic' | 'feature' | 'tasks';
    why: string | null;
    suggested: boolean;
    action: 'epic_plan' | 'feature_design' | 'task_plan';
    scope: { type: string; id: string };
  } | null;
};

export type Exploration = Omit<ExplorationDetail, 'messages' | 'questions' | 'children' | 'draft'> & {
  open_questions: number;
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
  stage?: { stage: BuildStage; outcome: BuildOutcome } | null;
};

export type BuildQueue = {
  ready: QueueTask[];
  waiting: (QueueTask & { reasons: string[] })[];
  stale: QueueTask[];
  totals: { tasks: number; points: number; unsized: number };
  repository: { path: string | null; branch: string };
};
