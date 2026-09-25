// Kysely types of the evidence base (migrations/0001_evidence.sql). bigint columns arrive as text.

import type { ColumnType, Generated } from 'kysely';

type Json = ColumnType<unknown, string, string>;
type Stamp = ColumnType<Date, Date | string, Date | string>;
type BigInt = ColumnType<string, number | string | null, number | string | null>;

export type InteractionsTable = {
  id: string;
  environment: string | null;
  instance: string | null;
  service_version: string | null;
  project_id: string | null;
  channel: string | null;
  actor: string | null;
  actor_type: string | null;
  root_command: string | null;
  root_entity_type: string | null;
  root_entity_id: string | null;
  started_at: Stamp | null;
  last_seen_at: Stamp | null;
  span_count: Generated<number>;
  error_count: Generated<number>;
};

export type SpansTable = {
  trace_id: string;
  span_id: string;
  parent_span_id: string | null;
  source: string;
  kind: string | null;
  name: string;
  started_at: Stamp;
  ended_at: Stamp | null;
  duration_ms: number | null;
  status: string | null;
  error_type: string | null;
  error_message: string | null;
  project_id: string | null;
  run_id: string | null;
  call_id: string | null;
  update_id: string | null;
  batch_id: string | null;
  entity_type: string | null;
  entity_id: string | null;
  attributes: Json;
  links: Json;
};

export type CommandsTable = {
  trace_id: string;
  span_id: string;
  project_id: string | null;
  actor: string | null;
  actor_type: string | null;
  command: string;
  entity_type: string | null;
  entity_id: string | null;
  entity_version: number | null;
  state_before: string | null;
  state_after: string | null;
  event_seq: BigInt | null;
  outcome: string | null;
  reasons: Json | null;
  cause_run: string | null;
  cause_batch: string | null;
  cause_proposal: string | null;
  before_hash: string | null;
  after_hash: string | null;
  started_at: Stamp;
  ended_at: Stamp | null;
};

export type RunsTable = {
  run_id: string;
  trace_id: string | null;
  project_id: string | null;
  action: string | null;
  agent: string | null;
  agent_version: string | null;
  provider: string | null;
  requested_model: string | null;
  observed_model: string | null;
  effort: string | null;
  engine_source: string | null;
  pack_hash: string | null;
  schema_version: string | null;
  prompt_hash: string | null;
  session_id: string | null;
  session_mode: string | null;
  provider_session_id: string | null;
  base_run_id: string | null;
  base_pack_hash: string | null;
  delta_hash: string | null;
  retry_of: string | null;
  answers_message_id: string | null;
  requested_at: Stamp | null;
  started_at: Stamp | null;
  finished_at: Stamp | null;
  state: string | null;
  failure_kind: string | null;
  error: string | null;
  usage: Json | null;
  output_hash: string | null;
};

export type ProviderCallsTable = {
  call_id: string;
  trace_id: string | null;
  span_id: string | null;
  run_id: string | null;
  update_id: string | null;
  project_id: string | null;
  agent: string | null;
  agent_version: string | null;
  provider: string | null;
  provider_name: string | null;
  requested_model: string | null;
  observed_model: string | null;
  effort: string | null;
  engine_source: string | null;
  attempt: number | null;
  session_id: string | null;
  session_mode: string | null;
  provider_session_id: string | null;
  base_run_id: string | null;
  base_pack_hash: string | null;
  delta_hash: string | null;
  prompt_hash: string | null;
  input_hash: string | null;
  schema_hash: string | null;
  schema_version: string | null;
  output_hash: string | null;
  cli_version: string | null;
  cli_command: string | null;
  cli_cwd: string | null;
  exit_code: number | null;
  stderr_hash: string | null;
  stop_reason: string | null;
  state: string | null;
  failure_kind: string | null;
  error: string | null;
  started_at: Stamp | null;
  finished_at: Stamp | null;
  duration_ms: number | null;
  duration_reported_ms: number | null;
  duration_api_ms: number | null;
  ttft_ms: number | null;
  tokens_uncached_input: BigInt | null;
  tokens_cache_read: BigInt | null;
  tokens_cache_write: BigInt | null;
  tokens_output: BigInt | null;
  tokens_reasoning: BigInt | null;
  tokens_provenance: Json | null;
  usage_raw: Json | null;
  declared_cost_usd: number | null;
  derived_cost_usd: number | null;
  turns: number | null;
  transcript_path: string | null;
  transcript_size: BigInt | null;
  transcript_hash: string | null;
};

export type ProviderEventsTable = {
  event_id: string;
  call_id: string | null;
  seq: number | null;
  kind: string | null;
  tokens: Json | null;
  received_at: Stamp;
  raw: string | null;
};

export type CliRequestsTable = {
  id: string;
  trace_id: string | null;
  call_id: string | null;
  source: string;
  request_id: string | null;
  attempt: number | null;
  model: string | null;
  at: Stamp;
  duration_ms: number | null;
  ttft_ms: number | null;
  stop_reason: string | null;
  tokens_uncached_input: BigInt | null;
  tokens_cache_read: BigInt | null;
  tokens_cache_write: BigInt | null;
  tokens_output: BigInt | null;
  tokens_reasoning: BigInt | null;
  cost_usd: number | null;
  error_status: string | null;
  attributes: Json;
};

export type SessionsTable = {
  session_id: string;
  provider: string | null;
  provider_session_id: string | null;
  key_hash: string | null;
  project_id: string | null;
  scope: Json | null;
  agent: string | null;
  agent_version: string | null;
  model: string | null;
  created_trace_id: string | null;
  created_call_id: string | null;
  created_at: Stamp | null;
  name: string | null;
  transcript_path: string | null;
};

export type SessionUsesTable = {
  call_id: string;
  session_id: string | null;
  run_id: string | null;
  mode: string | null;
  base_run_id: string | null;
  delta_hash: string | null;
  tokens_cache_read: BigInt | null;
  tokens_uncached_input: BigInt | null;
  at: Stamp | null;
};

export type TranscriptChunksTable = {
  session_id: string;
  offset: BigInt;
  call_id: string | null;
  chars: number | null;
  text_hash: string | null;
  at: Stamp | null;
};

export type ContextManifestsTable = {
  pack_hash: string;
  pack_id: string | null;
  project_id: string | null;
  builder: string | null;
  role: string | null;
  graph_version: number | null;
  budget: Json | null;
  candidates: number | null;
  fragments: number | null;
  included_chars: number | null;
  dropped_count: number | null;
  built_trace_id: string | null;
  built_at: Stamp | null;
};

export type ContextFragmentsTable = {
  pack_hash: string;
  seq: number;
  section: string | null;
  source_type: string | null;
  source_id: string | null;
  source_version: number | null;
  source_event_seq: BigInt | null;
  text_hash: string | null;
  chars: number | null;
  original_chars: number | null;
  decision: string | null;
  reason: string | null;
  score: number | null;
  position: number | null;
};

export type TextsTable = {
  hash: string;
  kind: string | null;
  chars: number | null;
  body: string | null;
  first_seen_at: Generated<Date>;
};

export type JournalPayloadsTable = {
  trace_id: string;
  span_id: string;
  at: Stamp;
  event_seq: BigInt | null;
  before: Json | null;
  after: Json | null;
};

export type BatchesTable = {
  batch_id: string;
  run_id: string | null;
  trace_id: string | null;
  project_id: string | null;
  proposals: number | null;
  submitted_at: Stamp | null;
};

export type EvaluationsTable = {
  id: Generated<string>;
  trace_id: string | null;
  target_type: string;
  target_id: string;
  name: string;
  score: number | null;
  label: string | null;
  explanation: string | null;
  by_actor: string | null;
  source: string;
  at: Stamp;
};

export type UnmappedRecordsTable = {
  id: string;
  received_at: Generated<Date>;
  at: Stamp;
  kind: string;
  reason: string;
  record: Json;
};

export type IngestReceiptsTable = {
  id: Generated<string>;
  received_at: Generated<Date>;
  origin: string;
  spans: number;
  logs: number;
  upserted: number;
  unmapped: number;
  ms: number;
};

export type EvidenceMigrationsTable = {
  version: string;
  name: string;
  checksum: string;
  applied_at: Generated<Date>;
};

export type DB = {
  interactions: InteractionsTable;
  spans: SpansTable;
  commands: CommandsTable;
  runs: RunsTable;
  provider_calls: ProviderCallsTable;
  provider_events: ProviderEventsTable;
  cli_requests: CliRequestsTable;
  sessions: SessionsTable;
  session_uses: SessionUsesTable;
  transcript_chunks: TranscriptChunksTable;
  context_manifests: ContextManifestsTable;
  context_fragments: ContextFragmentsTable;
  texts: TextsTable;
  journal_payloads: JournalPayloadsTable;
  batches: BatchesTable;
  evaluations: EvaluationsTable;
  unmapped_records: UnmappedRecordsTable;
  ingest_receipts: IngestReceiptsTable;
  evidence_migrations: EvidenceMigrationsTable;
};
