// Kysely types for the tables. Written by hand alongside the SQL migrations; the schema
// test checks that the columns match the migrated database.

import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
type NullableTimestamp = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
type Json = ColumnType<unknown, string, string>;
type NullableJson = ColumnType<unknown, string | null | undefined, string | null>;
type Int64 = ColumnType<string, number | string | bigint, number | string | bigint>;
type GeneratedIdentity = ColumnType<string, never, never>;
type Counter = ColumnType<string, number | string | undefined, number | string>;

export type ProjectsTable = {
  id: Generated<string>;
  name: string;
  state: string;
  event_seq: Counter;
  created_at: Generated<Timestamp>;
};

export type EventsTable = {
  id: GeneratedIdentity;
  project_id: string;
  seq: Int64;
  at: Generated<Timestamp>;
  actor: string;
  command: string;
  entity_type: string;
  entity_id: string;
  entity_version: number | null;
  state_before: string | null;
  state_after: string | null;
  before: NullableJson;
  after: NullableJson;
  cause: NullableJson;
};

export type HumansTable = {
  id: Generated<string>;
  username: string;
  password_hash: string;
  created_at: Generated<Timestamp>;
};

export type SessionsTable = {
  id: Generated<string>;
  human_id: string;
  token_hash: string;
  csrf_hash: string;
  created_at: Generated<Timestamp>;
  expires_at: Timestamp;
  revoked_at: NullableTimestamp;
};

export type ContextPacksTable = {
  id: Generated<string>;
  project_id: string;
  role: string;
  builder: string;
  budget: Json;
  graph_version: Int64;
  dependencies: Json;
  content: Json;
  hash: string;
  state: string;
  created_at: Generated<Timestamp>;
};

export type RunsTable = {
  id: Generated<string>;
  project_id: string;
  action: string;
  scope: Json;
  method: string;
  schema_version: string;
  provider: string;
  model: string | null;
  context_pack_id: string | null;
  retry_of: string | null;
  state: string;
  failure_kind: string | null;
  error: string | null;
  output: NullableJson;
  usage: NullableJson;
  requested_by: string;
  created_at: Generated<Timestamp>;
  started_at: NullableTimestamp;
  finished_at: NullableTimestamp;
  agent: string | null;
  prompt_hash: string | null;
  requested_model: string | null;
  effort: string | null;
  session_mode: string | null;
  provider_session_id: string | null;
  delta_hash: string | null;
};

export type ProviderCatalogsTable = {
  id: Generated<string>;
  provider: string;
  discovered_at: Timestamp;
  discovered_by: string;
  label: string;
  installed: boolean;
  version: string | null;
  ready: boolean;
  message: string | null;
  sessions: boolean;
  models: Json;
};

export type AgentAssignmentsTable = {
  id: Generated<string>;
  scope: string;
  project_id: string | null;
  agent: string;
  provider: string | null;
  model: string | null;
  effort: string | null;
  assigned_by: string;
  assigned_at: Timestamp;
};

export type GroupAssignmentsTable = {
  id: Generated<string>;
  group_id: string;
  provider: string | null;
  model: string | null;
  effort: string | null;
  assigned_by: string;
  assigned_at: Timestamp;
};

/** Trace context of each entity a command created (observability §5.2). Not a domain table. */
export type TraceContextsTable = {
  entity_type: string;
  entity_id: string;
  project_id: string;
  trace_parent: string;
  created_at: Generated<Timestamp>;
};

export type AgentSessionsTable = {
  key: string;
  project_id: string;
  provider: string;
  provider_session_id: string;
  last_run_id: string;
  updated_at: Timestamp;
};

export type AgentCallsTable = {
  id: Generated<string>;
  project_id: string | null;
  run_id: string | null;
  agent: string;
  agent_version: string;
  provider: string;
  requested_model: string;
  observed_model: string | null;
  effort: string | null;
  session_mode: string;
  provider_session_id: string | null;
  prompt_hash: string;
  state: string;
  failure_kind: string | null;
  error: string | null;
  usage: NullableJson;
  started_at: Timestamp;
  finished_at: NullableTimestamp;
};

export type AgentCallEventsTable = {
  id: GeneratedIdentity;
  project_id: string | null;
  call_id: string;
  seq: number;
  received_at: Timestamp;
  kind: string;
  tokens: number | null;
  raw: string;
};

export type RunLogsTable = {
  id: Generated<string>;
  project_id: string;
  run_id: string;
  attempt: number;
  raw_gzip: Buffer;
  created_at: Generated<Timestamp>;
};

export type StepCompletionsTable = {
  workflow_id: string;
  step: string;
  result: NullableJson;
  completed_at: Generated<Timestamp>;
};

export type AgentTokensTable = {
  id: Generated<string>;
  project_id: string;
  name: string;
  token_hash: string;
  state: string;
  issued_by: string;
  created_at: Generated<Timestamp>;
  revoked_at: NullableTimestamp;
};

export type ExplorationsTable = {
  id: Generated<string>;
  project_id: string;
  parent_id: string | null;
  purpose: string;
  origin_type: string | null;
  origin_id: string | null;
  origin_version: number | null;
  state: string;
  state_reason: string | null;
  opened_by: string;
  created_at: Generated<Timestamp>;
};

export type QuestionsTable = {
  id: Generated<string>;
  project_id: string;
  exploration_id: string;
  question: string;
  reason: string | null;
  impact: string | null;
  conclusion: string | null;
  reasoning: string | null;
  state: string;
  state_reason: string | null;
  raised_by: string;
  stage_id: string | null;
  stage_key: string | null;
  options: ColumnType<{ answer: string; implies: string; exclusive?: boolean }[], string | undefined, string>;
  multiple: Generated<boolean>;
  shown_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  created_at: Generated<Timestamp>;
};

export type StagesTable = {
  id: Generated<string>;
  project_id: string;
  stage: string;
  position: number;
  exploration_id: string;
  state: string;
  opened_by: string;
  passed_by: string | null;
  passed_at: NullableTimestamp;
  created_at: Generated<Timestamp>;
};

export type MessagesTable = {
  id: Generated<string>;
  project_id: string;
  exploration_id: string;
  question_id: string | null;
  author: string;
  run_id: string | null;
  kind: string | null;
  body: string;
  state: string;
  response: string | null;
  response_run: string | null;
  created_at: Generated<Timestamp>;
};

export type SourcesTable = {
  id: Generated<string>;
  project_id: string;
  name: string;
  content: string;
  content_hash: string;
  registered_by: string;
  state: string;
  created_at: Generated<Timestamp>;
};

export type RecordsTable = {
  id: Generated<string>;
  project_id: string;
  code: string;
  type: string;
  domain: string;
  state: string;
  created_at: Generated<Timestamp>;
};

export type VersionsTable = {
  id: Generated<string>;
  project_id: string;
  record_id: string;
  n: number;
  title: string;
  sections: Json;
  annexes: Json;
  increment: string | null;
  change_note: string | null;
  origin: NullableJson;
  author: string;
  content_hash: string;
  state: string;
  created_at: Generated<Timestamp>;
  approved_at: NullableTimestamp;
  approved_by: string | null;
};

export type CriteriaTable = {
  id: Generated<string>;
  project_id: string;
  record_version_id: string;
  code: string;
  title: string;
  statement: string;
  verification: string;
  check_text: string;
  derived_from: string | null;
  carry: string;
  position: number;
  state: string;
  created_at: Generated<Timestamp>;
};

export type LinksTable = {
  id: Generated<string>;
  project_id: string;
  type: string;
  from_type: string;
  from_id: string;
  from_version: number | null;
  to_type: string;
  to_id: string;
  to_version: number | null;
  state: string;
  created_by: string;
  created_at: Generated<Timestamp>;
};

export type BatchesTable = {
  id: Generated<string>;
  project_id: string;
  kind: string;
  producer: string;
  run_id: string | null;
  context_pack_id: string | null;
  resolution_mode: string;
  dependencies: Json;
  summary: string | null;
  tree_hash: string | null;
  state: string;
  created_at: Generated<Timestamp>;
  resolved_at: NullableTimestamp;
  resolved_by: string | null;
};

export type ProposalsTable = {
  id: Generated<string>;
  project_id: string;
  batch_id: string;
  position: number;
  type: string;
  payload: Json;
  dependencies: Json;
  state: string;
  resolution: NullableJson;
  resolved_by: string | null;
  resolved_at: NullableTimestamp;
  created_at: Generated<Timestamp>;
};

export type TaxonomiesTable = {
  id: Generated<string>;
  project_id: string;
  code: string;
  version: number;
  title: string;
  axes: Json;
  sections: Json;
  content_hash: string;
  state: string;
  author: string;
  created_at: Generated<Timestamp>;
  approved_at: NullableTimestamp;
  approved_by: string | null;
};

export type GraphStateTable = {
  project_id: string;
  version: Counter;
  last_update_id: string | null;
};

export type NodesTable = {
  id: Generated<string>;
  project_id: string;
  ref: string;
  kind: string;
  source_type: string;
  source_id: string | null;
  source_version: number | null;
  label: string;
  body: string;
  categories: Json;
  epistemic: string;
  valid_from: Int64;
  valid_to: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  created_by_update: string | null;
  state: string;
  created_at: Generated<Timestamp>;
};

export type EdgesTable = {
  id: Generated<string>;
  project_id: string;
  kind: string;
  from_node: string;
  to_node: string;
  valid_from: Int64;
  valid_to: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  created_by_update: string | null;
  state: string;
  created_at: Generated<Timestamp>;
};

export type UpdatesTable = {
  id: Generated<string>;
  project_id: string;
  trigger: Json;
  trigger_seq: Int64;
  change: NullableJson;
  candidates: NullableJson;
  candidates_hash: string | null;
  input_hash: string | null;
  classifier: string | null;
  verdicts: NullableJson;
  verification: NullableJson;
  operations: NullableJson;
  graph_version_before: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  graph_version_after: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  failure: string | null;
  state: string;
  created_at: Generated<Timestamp>;
  finished_at: NullableTimestamp;
};

export type VerdictCacheTable = {
  input_hash: string;
  classifier: string;
  answers: Json;
  created_at: Generated<Timestamp>;
};

export type ClassificationsTable = {
  id: Generated<string>;
  project_id: string;
  node_ref: string;
  taxonomy_id: string;
  axis: string;
  category: string;
  confidence: number;
  justification: string;
  classifier: string;
  input_hash: string;
  update_id: string | null;
  resolution: NullableJson;
  resolved_by: string | null;
  state: string;
  created_at: Generated<Timestamp>;
};

export type IdeaAssessmentsTable = {
  id: Generated<string>;
  project_id: string;
  proposal_id: string;
  findings: Json;
  graph_version: Int64;
  classifier: string;
  input_hash: string;
  state: string;
  created_at: Generated<Timestamp>;
};

export type ClassifierEvaluationsTable = {
  id: Generated<string>;
  classifier: string;
  dataset: string;
  partition: string;
  task: string;
  metrics: Json;
  file: string | null;
  created_at: Generated<Timestamp>;
};

export type DB = {
  projects: ProjectsTable;
  events: EventsTable;
  humans: HumansTable;
  sessions: SessionsTable;
  context_packs: ContextPacksTable;
  ai_runs: RunsTable;
  ai_run_logs: RunLogsTable;
  provider_catalogs: ProviderCatalogsTable;
  agent_assignments: AgentAssignmentsTable;
  group_assignments: GroupAssignmentsTable;
  agent_sessions: AgentSessionsTable;
  trace_contexts: TraceContextsTable;
  agent_calls: AgentCallsTable;
  agent_call_events: AgentCallEventsTable;
  step_completions: StepCompletionsTable;
  agent_tokens: AgentTokensTable;
  explorations: ExplorationsTable;
  questions: QuestionsTable;
  stages: StagesTable;
  messages: MessagesTable;
  sources: SourcesTable;
  records: RecordsTable;
  record_versions: VersionsTable;
  criteria: CriteriaTable;
  links: LinksTable;
  proposal_batches: BatchesTable;
  proposals: ProposalsTable;
  taxonomies: TaxonomiesTable;
  knowledge_graph_state: GraphStateTable;
  knowledge_nodes: NodesTable;
  knowledge_edges: EdgesTable;
  knowledge_updates: UpdatesTable;
  verdict_cache: VerdictCacheTable;
  classifications: ClassificationsTable;
  idea_assessments: IdeaAssessmentsTable;
  classifier_evaluations: ClassifierEvaluationsTable;
};

export type Row<T extends keyof DB> = Selectable<DB[T]>;
export type NewRow<T extends keyof DB> = Insertable<DB[T]>;
