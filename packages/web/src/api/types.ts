// Shapes of the API responses the UI reads. They mirror packages/core/src/queries/read.ts and
// packages/api/src/queries.ts: when both disagree, the code of the API rules.

export type Epistemic = 'confirmed' | 'proposed' | 'pending' | 'unknown';

export type Actor =
  | { type: 'human'; person: string }
  | { type: 'agent_external'; name: string; session: string }
  | { type: 'agent_run'; run: string }
  | { type: 'system'; component: string; version: string };

export type Session = { actor: Actor; type: 'person' | 'agent'; csrf: string | null };

export type Project = { id: string; name: string; state: string; created_at: string };

// Tables (GET /api/tables) and command contracts (GET /api/commands).
export type ActorType = 'human' | 'agent_external' | 'agent_run' | 'system';
export type CommandDef = { entity: string; allowed: ActorType[]; decisive: boolean; description: string };
export type TransitionDef = { command: string; from: 'new' | string[]; to: string; guards?: string[] };
export type EntityDef = {
  label: string;
  implemented_in: string;
  states: Record<string, string>;
  authority: string[];
  transitions: TransitionDef[];
};
export type Tables = {
  capabilities: { commands: Record<string, CommandDef>; queries: Record<string, { allowed: ActorType[] }> };
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
export type CommandContract = CommandDef & { implemented: boolean; data: JsonSchema | null };
export type CommandCatalog = Record<string, CommandContract>;

export type CommandResponse<R = unknown> = {
  entity: string;
  entity_id: string;
  state: string;
  seq: number;
  result: R | null;
};

export type Readiness = { ready: boolean; reasons: string[]; warnings: string[] };

export type RecordType = 'decision' | 'fdr' | 'adr' | 'bug';

export type ProductRow = {
  code: string;
  type: RecordType;
  domain: string;
  title: string;
  current: number | null;
  latest: { n: number; state: string };
  epistemic_status: Epistemic;
  readiness: Readiness | null;
  implementation: string;
  /** First paragraph of the latest version: the card's one line. */
  summary: string;
  /** Criteria of the latest version. */
  checks: number;
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

export type ProductState = {
  project: { id: string; name: string; state: string };
  decisions: ProductRow[];
  designs: ProductRow[];
  ready_to_build: string[];
  explorations: ExplorationSummary[];
  inbox: { total: number };
};

export type Dependency = { type: string; id: string; code?: string; version: number | null };

export type InboxProposal = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  state: string;
  epistemic_status: Epistemic;
  obsolescence: string[];
  assessment: IdeaAssessmentSummary | null;
  dependencies: Dependency[];
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
export type IdeaAssessmentSummary = { findings?: IdeaFinding[]; [k: string]: unknown };

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
  rejected_updates: { id: string; trigger: unknown; failure: string | null; created_at: string; epistemic_status: Epistemic }[];
};

export type Criterion = {
  id: string;
  code: string;
  title: string;
  statement: string;
  /** automatic or manual. */
  verification: string;
  check: string;
  /** new, kept or modified. */
  carry: string;
};

export type Link = {
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
  inferred_questions: { id: string; question: string; conclusion: string | null }[];
  criteria: Criterion[];
  links: Link[];
  readiness: Readiness | null;
};

export type RecordDetail = {
  id: string;
  code: string;
  type: RecordType;
  domain: string;
  current: number | null;
  implementation: string;
  versions: RecordVersion[];
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
};

export type Exploration = Omit<ExplorationDetail, 'messages' | 'questions' | 'children'> & {
  open_questions: number;
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
  usage: { inputTokens: number; outputTokens: number; durationMs: number } | null;
  requested_by: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type RunDetail = Run & { context_pack: ContextPack | null };

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

export type Source = { id: string; name: string; content_hash: string; registered_by: string; created_at: string };

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
export type SearchResult = { ref: string; type: string; title: string; excerpt: string; epistemic_status: string; range: number };

/** A run in the list (GET …/runs): its thread is its scope, or where its decision was born. */
export type RunListItem = {
  id: string;
  state: string;
  action: string;
  scope: { type: string; id?: string; version?: number };
  provider: string;
  model: string | null;
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

export type GraphEdge = { type: string; from: string; to: string; state: string };

export type KnowledgeGraph = { graph_version: number; nodes: GraphNode[]; edges: GraphEdge[] };

export type IdeaAssessment = {
  id: string;
  graph_version: number;
  classifier: string;
  created_at: string;
  error: string | null;
  proposal: { id: string; type: string; title: string | null; batch_id: string; state: string };
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
