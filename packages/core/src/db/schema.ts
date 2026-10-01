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
  /** The language the person reads DEMIURGO in ('en' | 'es'); null follows the browser. */
  locale: ColumnType<string | null, string | null | undefined, string | null>;
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
  /** The engine the backup replaced and why, when the run ran on the backup engine. */
  fallback: NullableJson;
  /** The harness version the run started under (harness_versions); null for runs from before it existed. */
  harness_version_id: string | null;
  /** The engine mark of the call (harness/engine.ts): provider, model asked and reported, CLI version. */
  engine: NullableJson;
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

export type EngineFallbacksTable = {
  id: Generated<string>;
  agent: string | null;
  group_id: string | null;
  provider: string | null;
  model: string | null;
  effort: string | null;
  assigned_by: string;
  assigned_at: Generated<Timestamp>;
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
  options: ColumnType<{ answer: string; implies: string; exclusive?: boolean; recommended?: boolean; downside?: string }[], string | undefined, string>;
  /** The answer its side conversation (Go deeper) led to, worded as one more option; null while none. */
  conversation_option: ColumnType<{ answer: string; implies: string } | null, string | null | undefined, string | null>;
  multiple: Generated<boolean>;
  shown_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;
  /** The exact words of the person an inference rests on, each with its message. */
  evidence: ColumnType<QuestionEvidence[], string | undefined, string>;
  created_at: Generated<Timestamp>;
};

export type QuestionEvidence = { message_id: string; quote: string };

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
  /** What Jev says the message is about (domain/aspects.ts), and how sure it is; derived. */
  aspect: string | null;
  aspect_confidence: number | null;
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
  /** The aspect of the product it is about (domain/aspects.ts); null until its content is classified. */
  aspect: string | null;
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
  practice_sources: NullableJson;
  spec: NullableJson;
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
  step: number | null;
  given_text: string | null;
  when_text: string | null;
  then_text: string | null;
  state: string;
  created_at: Generated<Timestamp>;
};

/** Evidence of a criterion: append-only, the latest row of a criterion is its evidence. */
export type EvidenceTable = {
  id: Generated<string>;
  project_id: string;
  criterion_id: string;
  record_version_id: string;
  kind: string;
  note: string;
  reference: string | null;
  pr_url: string | null;
  test_name: string | null;
  result: string | null;
  state: string;
  recorded_by: string;
  created_at: Generated<Timestamp>;
};

/** A task's size: append-only, its latest row is the size (FDR-DEL-006). */
export type TaskCoversTable = {
  id: Generated<string>;
  project_id: string;
  record_id: string;
  codes: string[];
  set_by: string;
  created_at: Generated<Timestamp>;
};

/** The person's order of the epics: append-only, each move writes the whole order; the latest row of an epic is its place. */
export type EpicPositionsTable = {
  id: Generated<string>;
  project_id: string;
  record_id: string;
  position: number;
  set_by: string;
  created_at: Generated<Timestamp>;
};

export type TaskSizesTable = {
  id: Generated<string>;
  project_id: string;
  record_id: string;
  size: string;
  previous: string | null;
  set_by: string;
  created_at: Generated<Timestamp>;
};

/** Jev's second opinion on a task's size: derived, the latest row is the active one. */
export type TaskSizeOpinionsTable = {
  id: Generated<string>;
  project_id: string;
  record_id: string;
  record_version_id: string;
  size: string;
  confidence: number;
  classifier_id: string;
  /** Expected score over the levels (0..4) and the probability of each level; only in opinions since migration 0054. */
  score: number | null;
  distribution: NullableJson;
  question_version: string | null;
  created_at: Generated<Timestamp>;
};

/**
 * Jev's answers on one criterion of a task (H97): derived, the latest row per criterion is the active one.
 * `can_check_in_ci` is only in old rows; `needs_kind` only in new ones.
 */
export type TaskTestabilityOpinionsTable = {
  id: Generated<string>;
  project_id: string;
  record_id: string;
  record_version_id: string;
  criterion_code: string;
  can_check_in_ci: number | null;
  needs_outside_ci: number;
  needs_unbuilt_feature: number;
  needs_kind: string | null;
  classifier_id: string;
  input_hash: string;
  created_at: Generated<Timestamp>;
};

/** Jev's guess at the layers a task version changes (H101); append-only. Only `schema_p` (the schema Score / 2) is asked now: the others are null in new rows. */
export type TaskNeedOpinionsTable = {
  id: Generated<string>;
  project_id: string;
  record_id: string;
  record_version_id: string;
  needed_record_id: string;
  needed_version_id: string;
  p: number;
  classifier_id: string;
  input_hash: string;
  question_version: string;
  created_at: Generated<Timestamp>;
};

export type TaskLayersOpinionsTable = {
  id: Generated<string>;
  project_id: string;
  record_id: string;
  record_version_id: string;
  schema_p: number;
  server_p: number | null;
  ui_p: number | null;
  tests_only_p: number | null;
  deploy_p: number | null;
  classifier_id: string;
  input_hash: string;
  created_at: Generated<Timestamp>;
};

/** What «Code to extend» showed the builder: one row per candidate file of each attempt (derived, append-only). */
export type TaskCodeOpinionsTable = {
  id: Generated<string>;
  project_id: string;
  build_request_id: string;
  attempt: number;
  record_version_id: string;
  path: string;
  deterministic_score: number;
  jev_p: number | null;
  rank: number;
  classifier_id: string;
  input_hash: string | null;
  question_version: string | null;
  created_at: Generated<Timestamp>;
};

/** Jev's opinion on one comment of a pull request review (derived, append-only). */
export type ReviewFindingKindsTable = {
  id: Generated<string>;
  project_id: string;
  pr_review_id: string;
  comment_index: number;
  category: string;
  p: number;
  avoidable_p: number;
  classifier_id: string;
  input_hash: string;
  created_at: Generated<Timestamp>;
};

/** "Keep <size>": a dispute dismissed against one opinion. */
export type TaskSizeDismissalsTable = {
  id: Generated<string>;
  project_id: string;
  record_id: string;
  opinion_id: string;
  size: string;
  dismissed_by: string;
  created_at: Generated<Timestamp>;
};

/** A feature of an epic's list: its reserved code, name and sentence, and the record once designed. */
export type PlannedFeaturesTable = {
  id: Generated<string>;
  project_id: string;
  epic_id: string;
  code: string;
  name: string;
  summary: string;
  position: number;
  state: string;
  record_id: string | null;
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
  /** The upstream version the person last confirmed the link against («Still valid»). */
  checked_against: number | null;
  /** The point a `supersedes` link supersedes. */
  note: string | null;
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
  /** When a person first saw the batch (`batch.show`); null until then. */
  shown_at: NullableTimestamp;
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
  /** What Jev says the proposal's own text is about: { aspect, confidence }; derived. */
  aspect_check: NullableJson;
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

/** A word of the project's glossary and its fixed English term; the latest row of a word is current. */
export type GlossaryTermsTable = {
  id: Generated<string>;
  project_id: string;
  term: string;
  english: string | null;
  note: string | null;
  state: string;
  set_by: string;
  created_at: Generated<Timestamp>;
};

/** A reading translation of a record: never authority, keyed by the source's fingerprint. */
export type TranslationsTable = {
  id: Generated<string>;
  project_id: string;
  subject_kind: string;
  subject_id: string;
  lang: string;
  source_hash: string;
  fields: ColumnType<Record<string, string>, string, never>;
  provider: string;
  model: string;
  created_at: Generated<Timestamp>;
};

/** Each project's repository folder (repo/repo.ts); derived. */
export type ProjectReposTable = {
  project_id: string;
  dir: string;
  created_at: Timestamp;
};

/** The project's private GitHub repository: owner and name. */
export type BuildQueueSettingsTable = {
  project_id: string;
  /** «Build the queue»: DEMIURGO starts the next ready task by itself after each merge. */
  auto: Generated<boolean>;
  /** How many builds «Build the queue» runs at once (1 to 3). */
  parallel: Generated<number>;
  set_by: string;
  set_at: Generated<Timestamp>;
};

export type TaskHoldsTable = {
  id: Generated<string>;
  project_id: string;
  task_id: string;
  /** Why the task cannot be built yet (an external prerequisite). */
  reason: string;
  held_by: string;
  held_at: Generated<Timestamp>;
  released_by: string | null;
  released_at: Timestamp | null;
};

export type ProjectGithubTable = {
  id: Generated<string>;
  project_id: string;
  owner: string;
  repo: string;
  /** Who enforces the merge rule: GitHub (branch protection) or DEMIURGO (plan without it). */
  protection: Generated<'github' | 'demiurgo'>;
  created_at: Generated<Timestamp>;
};

/** Each commit DEMIURGO made in a project's repository, with what it recorded; derived. */
export type ProjectCommitsTable = {
  id: Generated<string>;
  project_id: string;
  sha: string;
  message: string;
  actor: string;
  record_version_id: string | null;
  files: Json;
  created_at: Timestamp;
};

/** A request to build a ready task (FDR-BUI-002): its frozen brief and who asked; launches nothing. */
export type BuildRequestsTable = {
  id: Generated<string>;
  project_id: string;
  task_id: string;
  task_version_id: string;
  feature_version_id: string | null;
  brief: string;
  requested_by: string;
  requested_at: Generated<Timestamp>;
  state: Generated<string>;
  withdrawn_by: string | null;
  withdrawn_at: Timestamp | null;
  pr_url: string | null;
  in_review_by: string | null;
  in_review_at: Timestamp | null;
  done_by: string | null;
  done_at: Timestamp | null;
  branch: string | null;
  pr_number: number | null;
  head_sha: string | null;
};

export type BuildRequestBasesTable = {
  id: Generated<string>;
  project_id: string;
  build_request_id: string;
  task_version_id: string;
  feature_version_id: string | null;
  brief: string;
  adopted_by: string;
  adopted_at: Generated<Timestamp>;
  attempt: number;
};

export type BuildStepsTable = {
  id: Generated<string>;
  project_id: string;
  build_request_id: string;
  attempt: number;
  stage: string;
  outcome: string;
  detail: NullableJson;
  created_at: Generated<Timestamp>;
};

/** The blameless post-mortem of one task, written by the forensics agent from all its evidence (append-only; the latest row of a task wins). */
export type TaskForensicsTable = {
  id: Generated<string>;
  project_id: string;
  task_id: string;
  task_version_id: string;
  request_ids: Generated<string[]>;
  ai_run_id: string;
  analysis: Json;
  evidence_hash: string;
  catalog_version: string;
  agent_version: string;
  engine: Json;
  /** When the task's activity ended (its last build step, else its task version): decides if it ran with a fix. */
  task_ended_at: Timestamp | null;
  /** The build request whose end triggered the analysis, when it was automatic. */
  trigger_request_id: string | null;
  created_at: Generated<Timestamp>;
};

/** A playbook of one error class, aggregated from the forensics (append-only; the latest version per class wins; no project: global). */
export type ForensicPlaybooksTable = {
  id: Generated<string>;
  project_id: string | null;
  class_key: string;
  version: number;
  entry: Json;
  based_on: Generated<string[]>;
  ai_run_id: string;
  created_at: Generated<Timestamp>;
};

/** One version of an entry of the known-error vault (append-only; the latest version of a code wins; global to the instance). */
export type KnownErrorsTable = {
  id: Generated<string>;
  code: string;
  version: number;
  title: string;
  description: string;
  error_class: string;
  phase: string;
  dimension: string;
  signature: string;
  pieces: Generated<string[]>;
  status: string;
  fix: NullableJson;
  origin_project_id: string;
  created_by: string;
  created_at: Generated<Timestamp>;
};

/** One time a known error showed up in a task forensic (append-only). */
export type KnownErrorOccurrencesTable = {
  id: Generated<string>;
  ke_code: string;
  project_id: string;
  task_id: string;
  forensic_id: string;
  went_wrong_index: number;
  occurred_at: Timestamp;
  piece_versions: ColumnType<unknown, string | undefined, string>;
  after_fix: boolean;
  recurrence_why: string | null;
  created_at: Generated<Timestamp>;
};

export type PrReviewsTable = {
  id: Generated<string>;
  project_id: string;
  build_request_id: string;
  run_id: string;
  verdict: string;
  summary: string;
  comments: unknown;
  criteria: unknown;
  published_at: NullableTimestamp;
  created_at: Generated<Timestamp>;
};

export type IssuesTable = {
  id: Generated<string>;
  project_id: string;
  /** ISS-NNN, per project. */
  code: string;
  kind: 'bug' | 'review_escalation' | 'harness_regression';
  title: string;
  body: Generated<string>;
  state: Generated<'open' | 'resolved' | 'closed'>;
  task_id: string | null;
  feature_id: string | null;
  criterion_code: string | null;
  build_request_id: string | null;
  attempt: number | null;
  pr_review_id: string | null;
  /** What opened it automatically (escalation:…, flaky:…, main_red:…); null when a person reported it. */
  source_key: string | null;
  resolution_task_id: string | null;
  resolution_version_id: string | null;
  close_reason: string | null;
  opened_by: string;
  opened_at: Generated<Timestamp>;
  resolved_by: string | null;
  resolved_at: NullableTimestamp;
  closed_by: string | null;
  closed_at: NullableTimestamp;
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
  engine_fallbacks: EngineFallbacksTable;
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
  translations: TranslationsTable;
  glossary_terms: GlossaryTermsTable;
  evidence: EvidenceTable;
  planned_features: PlannedFeaturesTable;
  task_sizes: TaskSizesTable;
  epic_positions: EpicPositionsTable;
  task_covers: TaskCoversTable;
  task_size_opinions: TaskSizeOpinionsTable;
  task_size_dismissals: TaskSizeDismissalsTable;
  task_testability_opinions: TaskTestabilityOpinionsTable;
  task_layers_opinions: TaskLayersOpinionsTable;
  task_need_opinions: TaskNeedOpinionsTable;
  task_code_opinions: TaskCodeOpinionsTable;
  review_finding_kinds: ReviewFindingKindsTable;
  project_repos: ProjectReposTable;
  project_github: ProjectGithubTable;
  build_queue_settings: BuildQueueSettingsTable;
  task_holds: TaskHoldsTable;
  build_requests: BuildRequestsTable;
  build_request_bases: BuildRequestBasesTable;
  project_commits: ProjectCommitsTable;
  pr_reviews: PrReviewsTable;
  task_forensics: TaskForensicsTable;
  forensic_playbooks: ForensicPlaybooksTable;
  known_errors: KnownErrorsTable;
  known_error_occurrences: KnownErrorOccurrencesTable;
  build_steps: BuildStepsTable;
  issues: IssuesTable;
  test_runs: TestRunsTable;
  harness_postmortems: HarnessPostmortemsTable;
  harness_checks: HarnessChecksTable;
  harness_versions: HarnessVersionsTable;
  harness_findings: HarnessFindingsTable;
  harness_escapes: HarnessEscapesTable;
  judgment_outcomes: JudgmentOutcomesTable;
  classifier_calls: ClassifierCallsTable;
  queue_plans: QueuePlansTable;
  queue_decisions: QueueDecisionsTable;
  version_answers: VersionAnswersTable;
};

export type TestRunsTable = {
  id: Generated<string>;
  project_id: string;
  build_request_id: string | null;
  attempt: number | null;
  head_sha: string | null;
  ci_run_id: string | null;
  test_name: string;
  file: string | null;
  criterion_code: string | null;
  outcome: 'pass' | 'fail' | 'skip';
  duration_ms: number | null;
  /** The failure message and text of a failing case, capped. */
  failure: string | null;
  recorded_at: Generated<Timestamp>;
};

/** The marks of the harness at one moment (append-only; unique by content hash). */
export type HarnessVersionsTable = {
  id: Generated<string>;
  content_hash: string;
  demiurgo_sha: string;
  agents: Json;
  skills: Json;
  question_versions: Json;
  rules_version: string;
  first_seen_at: Generated<Timestamp>;
};

/** One deterministic post-mortem of an ended build request (append-only; unique per request, rules version and inputs hash). */
export type HarnessPostmortemsTable = {
  id: Generated<string>;
  project_id: string;
  build_request_id: string;
  rules_version: string;
  harness_version_id: string | null;
  inputs_hash: string;
  attempts: number;
  outcome: 'merged' | 'withdrawn' | 'failed' | 'needs_you';
  findings: number;
  computed_at: Generated<Timestamp>;
};

/** One periodic check of the harness over a window (append-only; unique per project, window end, rules version and inputs hash). */
export type HarnessChecksTable = {
  id: Generated<string>;
  project_id: string;
  window_from: Timestamp;
  window_to: Timestamp;
  previous_check_id: string | null;
  rules_version: string;
  harness_version_id: string | null;
  trigger: 'schedule' | 'merges' | 'manual';
  scorecards: Json;
  escapes: Json;
  regressions: Json;
  worth: Json;
  inputs_hash: string;
  computed_at: Generated<Timestamp>;
};

/** What really happened after a judgment, written by the post-mortem (append-only; unique per judgment, outcome and rules version). */
export type JudgmentOutcomesTable = {
  id: Generated<string>;
  project_id: string;
  judgment_table: string;
  judgment_id: string | null;
  judgment_key: string;
  outcome_name: string;
  outcome_value: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  outcome_label: string | null;
  observed_at: Timestamp;
  source_type: string;
  source_id: string;
  rules_version: string;
  recorded_at: Generated<Timestamp>;
};

/** One Jev (TypeSafe) request: tokens, latency and outcome (append-only; `call_key` makes repeatable calls idempotent). */
export type ClassifierCallsTable = {
  id: Generated<string>;
  project_id: string;
  question: string;
  question_version: string | null;
  judgment_table: string | null;
  judgment_ids: Generated<string[]>;
  call_key: string | null;
  model: string;
  input_tokens: Generated<number>;
  output_tokens: Generated<number>;
  duration_ms: number | null;
  cost_usd: ColumnType<string, number | string | undefined, number | string>;
  outcome: 'ok' | 'error';
  /** The engine mark of the call (harness/engine.ts): `jev` and the model asked and the one that answered. */
  engine: NullableJson;
  created_at: Generated<Timestamp>;
};

/** One classified fact of a post-mortem: what a piece of the harness decided or cost (append-only). */
export type HarnessFindingsTable = {
  id: Generated<string>;
  project_id: string;
  postmortem_id: string;
  build_request_id: string;
  attempt: number | null;
  piece: string;
  finding: string;
  class: 'tp' | 'fp' | 'fn' | 'tn' | 'benefit' | 'cost' | 'info';
  ground_truth: string | null;
  value: ColumnType<string | null, number | string | null | undefined, number | string | null>;
  unit: 'min' | 'ci_runs' | 'tokens' | 'usd' | 'person_actions' | 'files' | 'tests' | 'loops' | 'attempts' | null;
  subject: string | null;
  evidence: Json;
  created_at: Generated<Timestamp>;
};

/** A problem design did not see and building (or the person) found later (append-only; unique per rules version and dedupe key). */
export type HarnessEscapesTable = {
  id: Generated<string>;
  project_id: string;
  /** E01…E15 (salud-del-harness §4.2). */
  rule: string;
  /** P1…P13: the phase that should have seen it, and the one that did (our convention, in code). */
  introduced_phase: string;
  found_phase: string;
  record_code: string | null;
  record_version_id: string | null;
  criterion_code: string | null;
  build_request_id: string | null;
  pr_review_id: string | null;
  comment_index: number | null;
  subject: string | null;
  evidence: Json;
  occurred_at: Timestamp | null;
  detected_at: Generated<Timestamp>;
  rules_version: string;
  dedupe_key: string;
};

/** One plan of «Build the queue», written only when it changes (append-only; see build/queue-decisions.ts). */
export type QueuePlansTable = {
  id: Generated<string>;
  project_id: string;
  decided_at: Generated<Timestamp>;
  trigger: 'event' | 'tick' | 'command';
  parallel_limit: number;
  running: string[];
  started: string[];
  ready_count: number;
  /** The kind of the stop (needs_you, ended, stale, manual_review, waiting, main_red) or `queue_off`. */
  stopped_kind: string | null;
  stopped_code: string | null;
  plan_hash: string;
  harness_version_id: string | null;
};

/** What the queue decided about one task in a plan, with the reason (append-only). */
export type QueueDecisionsTable = {
  id: Generated<string>;
  project_id: string;
  plan_id: string;
  task_code: string;
  decision:
    | 'start'
    | 'running'
    | 'wait_dependency'
    | 'wait_feature_busy'
    | 'wait_schema'
    | 'wait_module'
    | 'wait_testability'
    | 'wait_hold'
    | 'stopped'
    | 'over_limit';
  item: string | null;
  with_task: string | null;
  with_source: 'actual' | 'predicted' | null;
  evidence: NullableJson;
};

/** Which confirmed answers a drafted version used (append-only). */
export type VersionAnswersTable = {
  record_version_id: string;
  question_id: string;
  project_id: string;
  created_at: Generated<Timestamp>;
};

export type Row<T extends keyof DB> = Selectable<DB[T]>;
export type NewRow<T extends keyof DB> = Insertable<DB[T]>;
