-- The evidence base (spec docs/superpowers/specs/2026-09-26-motor-observabilidad-design.md §10).
-- Its own Postgres server, its own migrator (`evidence_migrations`, checksum, never edited).
-- The big tables are partitioned by month; `ensure_month_partitions` keeps the current and the next
-- month ready, and the ingester adds the month of anything older it receives (replays, fixtures).
-- Nothing here references the operational base: the evidence describes it from outside.

-- ---------------------------------------------------------------------------------------------
-- Materialized from the root span of every trace (§5.1). No FK from spans: a child may arrive first.
create table interactions (
  id uuid primary key,
  environment text,
  instance text,
  service_version text,
  project_id uuid,
  channel text,
  actor text,
  actor_type text,
  root_command text,
  root_entity_type text,
  root_entity_id text,
  started_at timestamptz,
  last_seen_at timestamptz,
  span_count integer not null default 0,
  error_count integer not null default 0
);
create index interactions_project on interactions (project_id, started_at);
create index interactions_started on interactions (started_at);

-- Every span of every service, as it came (source by `service.name`).
create table spans (
  trace_id text not null,
  span_id text not null,
  parent_span_id text,
  source text not null,
  kind text,
  name text not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  duration_ms double precision,
  status text,
  error_type text,
  error_message text,
  project_id uuid,
  run_id uuid,
  call_id uuid,
  update_id uuid,
  batch_id uuid,
  entity_type text,
  entity_id text,
  attributes jsonb not null default '{}'::jsonb,
  links jsonb not null default '[]'::jsonb,
  primary key (trace_id, span_id, started_at)
) partition by range (started_at);
create index spans_trace on spans (trace_id);
create index spans_run on spans (run_id) where run_id is not null;
create index spans_call on spans (call_id) where call_id is not null;
create index spans_name on spans (name, started_at);

-- One row per `command <name>` span (§6.1).
create table commands (
  trace_id text not null,
  span_id text not null,
  project_id uuid,
  actor text,
  actor_type text,
  command text not null,
  entity_type text,
  entity_id text,
  entity_version integer,
  state_before text,
  state_after text,
  event_seq bigint,
  outcome text,
  reasons jsonb,
  cause_run uuid,
  cause_batch uuid,
  cause_proposal uuid,
  before_hash text,
  after_hash text,
  started_at timestamptz not null,
  ended_at timestamptz,
  primary key (trace_id, span_id, started_at)
) partition by range (started_at);
create index commands_trace on commands (trace_id);
create index commands_entity on commands (entity_type, entity_id);
create index commands_command on commands (command, started_at);

-- Materialized from the engine steps, the provider call and the `ai_run` commands (§5.3).
create table runs (
  run_id uuid primary key,
  trace_id text,
  project_id uuid,
  action text,
  agent text,
  agent_version text,
  provider text,
  requested_model text,
  observed_model text,
  effort text,
  engine_source text,
  pack_hash text,
  schema_version text,
  prompt_hash text,
  session_id uuid,
  session_mode text,
  provider_session_id text,
  base_run_id uuid,
  base_pack_hash text,
  delta_hash text,
  retry_of uuid,
  answers_message_id uuid,
  requested_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  state text,
  failure_kind text,
  error text,
  usage jsonb,
  output_hash text
);
create index runs_project on runs (project_id, requested_at);
create index runs_trace on runs (trace_id);

-- One row per `invoke_agent` span (§6.2).
create table provider_calls (
  call_id uuid primary key,
  trace_id text,
  span_id text,
  run_id uuid,
  update_id uuid,
  project_id uuid,
  agent text,
  agent_version text,
  provider text,
  provider_name text,
  requested_model text,
  observed_model text,
  effort text,
  engine_source text,
  attempt integer,
  session_id uuid,
  session_mode text,
  provider_session_id text,
  base_run_id uuid,
  base_pack_hash text,
  delta_hash text,
  prompt_hash text,
  input_hash text,
  schema_hash text,
  schema_version text,
  output_hash text,
  cli_version text,
  cli_command text,
  cli_cwd text,
  exit_code integer,
  stderr_hash text,
  stop_reason text,
  state text,
  failure_kind text,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms double precision,
  duration_reported_ms double precision,
  duration_api_ms double precision,
  ttft_ms double precision,
  tokens_uncached_input bigint,
  tokens_cache_read bigint,
  tokens_cache_write bigint,
  tokens_output bigint,
  tokens_reasoning bigint,
  tokens_provenance jsonb,
  usage_raw jsonb,
  declared_cost_usd double precision,
  derived_cost_usd double precision,
  turns integer,
  transcript_path text,
  transcript_size bigint,
  transcript_hash text
);
create index provider_calls_run on provider_calls (run_id);
create index provider_calls_session on provider_calls (session_id, started_at);
create index provider_calls_trace on provider_calls (trace_id);

-- The raw lines of the provider, one per `demiurgo.provider.event` (§6.3).
create table provider_events (
  event_id text not null,
  call_id uuid,
  seq integer,
  kind text,
  tokens jsonb,
  received_at timestamptz not null,
  raw text,
  primary key (event_id, received_at)
) partition by range (received_at);
create index provider_events_call on provider_events (call_id, seq);

-- The API requests the CLIs report themselves (§13), joined to the call by trace or by resource attribute.
create table cli_requests (
  id text not null,
  trace_id text,
  call_id uuid,
  source text not null,
  request_id text,
  attempt integer,
  model text,
  at timestamptz not null,
  duration_ms double precision,
  ttft_ms double precision,
  stop_reason text,
  tokens_uncached_input bigint,
  tokens_cache_read bigint,
  tokens_cache_write bigint,
  tokens_output bigint,
  tokens_reasoning bigint,
  cost_usd double precision,
  error_status text,
  attributes jsonb not null default '{}'::jsonb,
  primary key (id, at)
) partition by range (at);
create index cli_requests_call on cli_requests (call_id);
create index cli_requests_trace on cli_requests (trace_id);

-- Conversation sessions as DEMIURGO sees them (§5.4); every use is a row of session_uses.
create table sessions (
  session_id uuid primary key,
  provider text,
  provider_session_id text,
  key_hash text,
  project_id uuid,
  scope jsonb,
  agent text,
  agent_version text,
  model text,
  created_trace_id text,
  created_call_id uuid,
  created_at timestamptz,
  name text,
  transcript_path text
);

create table session_uses (
  call_id uuid primary key,
  session_id uuid,
  run_id uuid,
  mode text,
  base_run_id uuid,
  delta_hash text,
  tokens_cache_read bigint,
  tokens_uncached_input bigint,
  at timestamptz
);
create index session_uses_session on session_uses (session_id, at);

-- Phase 4: what each call appended to the transcript of its session.
create table transcript_chunks (
  session_id uuid not null,
  "offset" bigint not null,
  call_id uuid,
  chars integer,
  text_hash text,
  at timestamptz,
  primary key (session_id, "offset")
);

-- Phase 3: the manifest of every context pack (§9).
create table context_manifests (
  pack_hash text primary key,
  pack_id uuid,
  project_id uuid,
  builder text,
  role text,
  graph_version integer,
  budget jsonb,
  candidates integer,
  fragments integer,
  included_chars integer,
  dropped_count integer,
  built_trace_id text,
  built_at timestamptz
);

create table context_fragments (
  pack_hash text not null,
  seq integer not null,
  section text,
  source_type text,
  source_id text,
  source_version integer,
  source_event_seq bigint,
  text_hash text,
  chars integer,
  original_chars integer,
  decision text,
  reason text,
  score double precision,
  position integer,
  primary key (pack_hash, seq)
);
create index context_fragments_source on context_fragments (source_type, source_id);

-- Every text once, by fingerprint (§5.5).
create table texts (
  hash text primary key,
  kind text,
  chars integer,
  body text,
  first_seen_at timestamptz not null default now()
);
create index texts_kind on texts (kind);

-- `{ before, after }` of every journal event, next to its command span.
create table journal_payloads (
  trace_id text not null,
  span_id text not null,
  at timestamptz not null,
  event_seq bigint,
  before jsonb,
  after jsonb,
  primary key (trace_id, span_id, at)
) partition by range (at);
create index journal_payloads_trace on journal_payloads (trace_id);

-- Materialized from the `batch.submit` command that a run caused.
create table batches (
  batch_id uuid primary key,
  run_id uuid,
  trace_id text,
  project_id uuid,
  proposals integer,
  submitted_at timestamptz
);
create index batches_run on batches (run_id);

-- Human evaluations derived from commands (§11) and judge evaluations emitted as notes (§15.2).
create table evaluations (
  id uuid primary key default gen_random_uuid(),
  trace_id text,
  target_type text not null,
  target_id text not null,
  name text not null,
  score double precision,
  label text,
  explanation text,
  by_actor text,
  source text not null,
  at timestamptz not null,
  unique (target_type, target_id, name, source, by_actor, at)
);
create index evaluations_target on evaluations (target_type, target_id);

-- Anything the ingester could not map: never lost (§11). `at` is the record's own time, so a replay
-- of the same record lands on the same row.
create table unmapped_records (
  id text not null,
  received_at timestamptz not null default now(),
  at timestamptz not null,
  kind text not null,
  reason text not null,
  record jsonb not null,
  primary key (id, at)
) partition by range (at);

-- One row per batch the ingester committed.
create table ingest_receipts (
  id bigint generated always as identity primary key,
  received_at timestamptz not null default now(),
  origin text not null,
  spans integer not null default 0,
  logs integer not null default 0,
  upserted integer not null default 0,
  unmapped integer not null default 0,
  ms integer not null default 0
);

-- ---------------------------------------------------------------------------------------------
-- Monthly partitions. Idempotent: an existing partition is left alone.

create function partitioned_tables() returns text[] language sql immutable as $$
  select array['spans', 'commands', 'provider_events', 'cli_requests', 'journal_payloads', 'unmapped_records']
$$;

-- Creates the partition of `tbl` for the month of `month` when it is missing; returns its name when created.
create function ensure_month_partition(tbl text, month date) returns text language plpgsql as $$
declare
  first date := date_trunc('month', month)::date;
  next date := (date_trunc('month', month) + interval '1 month')::date;
  part text := format('%s_%s', tbl, to_char(date_trunc('month', month), 'YYYY_MM'));
begin
  if not (tbl = any (partitioned_tables())) then
    raise exception 'Not a partitioned table of the evidence base: %', tbl;
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
             where c.relname = part and n.nspname = current_schema()) then
    return null;
  end if;
  execute format('create table %I partition of %I for values from (%L) to (%L)', part, tbl, first, next);
  return part;
end
$$;

-- Current month plus `months_ahead` for every partitioned table (§11). Returns the partitions created.
create function ensure_month_partitions(months_ahead integer default 1) returns setof text language plpgsql as $$
declare
  tbl text;
  i integer;
  created text;
begin
  foreach tbl in array partitioned_tables() loop
    for i in 0..greatest(months_ahead, 0) loop
      created := ensure_month_partition(tbl, (date_trunc('month', now()) + make_interval(months => i))::date);
      if created is not null then
        return next created;
      end if;
    end loop;
  end loop;
end
$$;

-- The months of the given timestamps, for every partitioned table (what a batch or a replay needs).
create function ensure_month_partitions_at(stamps timestamptz[]) returns setof text language plpgsql as $$
declare
  tbl text;
  month date;
  created text;
begin
  foreach tbl in array partitioned_tables() loop
    for month in select distinct date_trunc('month', s)::date from unnest(stamps) as s where s is not null loop
      created := ensure_month_partition(tbl, month);
      if created is not null then
        return next created;
      end if;
    end loop;
  end loop;
end
$$;

-- ---------------------------------------------------------------------------------------------
-- Views of phase 2 (§10).

-- Where the time of an interaction goes: the API root, the commands, the engine steps and the provider.
create view v_interaction_summary as
with by_trace as (
  select
    s.trace_id,
    sum(case when s.name like 'interaction %' then s.duration_ms end) as api_ms,
    sum(case when s.name like 'command %' then s.duration_ms end) as commands_ms,
    sum(case when s.name like 'run.%' or s.name like 'response.%' or s.name like 'knowledge.%' or s.name like 'ideas.%'
             then s.duration_ms end) as steps_ms,
    sum(case when s.name like 'invoke_agent%' then s.duration_ms end) as provider_ms,
    count(*) filter (where s.name like 'command %') as commands,
    count(distinct s.run_id) filter (where s.run_id is not null) as runs,
    count(*) filter (where s.name like 'invoke_agent%') as provider_calls,
    count(*) filter (where s.status = 'error') as errors
  from spans s
  group by s.trace_id
),
tokens as (
  select trace_id,
    sum(coalesce(tokens_uncached_input, 0) + coalesce(tokens_cache_read, 0) + coalesce(tokens_cache_write, 0)) as tokens_input,
    sum(tokens_output) as tokens_output,
    sum(declared_cost_usd) as declared_cost_usd
  from provider_calls
  group by trace_id
)
select
  i.id as interaction_id,
  i.environment,
  i.instance,
  i.project_id,
  i.channel,
  i.actor,
  i.root_command,
  i.started_at,
  i.last_seen_at,
  extract(epoch from (i.last_seen_at - i.started_at)) * 1000 as total_ms,
  b.api_ms,
  b.commands_ms,
  b.steps_ms,
  b.provider_ms,
  b.commands,
  b.runs,
  b.provider_calls,
  b.errors,
  t.tokens_input,
  t.tokens_output,
  t.declared_cost_usd
from interactions i
left join by_trace b on b.trace_id = replace(i.id::text, '-', '')
left join tokens t on t.trace_id = replace(i.id::text, '-', '');

-- Per call: how the session was used and how much of the input came back from the cache.
create view v_session_reuse as
select
  c.call_id,
  c.run_id,
  c.trace_id,
  c.provider,
  c.requested_model,
  c.agent,
  c.session_id,
  c.session_mode as mode,
  c.base_run_id,
  c.delta_hash,
  c.attempt,
  c.started_at,
  c.tokens_uncached_input,
  c.tokens_cache_read,
  c.tokens_cache_write,
  c.tokens_output,
  case
    when coalesce(c.tokens_uncached_input, 0) + coalesce(c.tokens_cache_read, 0) + coalesce(c.tokens_cache_write, 0) = 0
      then null
    else c.tokens_cache_read::double precision
      / (coalesce(c.tokens_uncached_input, 0) + coalesce(c.tokens_cache_read, 0) + coalesce(c.tokens_cache_write, 0))
  end as cache_ratio,
  case
    when c.session_mode is distinct from 'resumed' then 'none'
    when coalesce(c.tokens_cache_read, 0) = 0 then 'lost'
    when c.tokens_cache_read::double precision
      / (coalesce(c.tokens_uncached_input, 0) + coalesce(c.tokens_cache_read, 0) + coalesce(c.tokens_cache_write, 0)) >= 0.5
      then 'reused'
    else 'partial'
  end as verdict
from provider_calls c;

-- Tokens and calls by provider, model, effort, agent and version.
create view v_tokens_by_engine as
select
  c.provider,
  c.provider_name,
  c.requested_model,
  c.observed_model,
  c.effort,
  c.agent,
  c.agent_version,
  count(*) as calls,
  count(distinct c.run_id) as runs,
  count(*) filter (where c.state = 'failed' or c.failure_kind is not null) as failed_calls,
  sum(c.tokens_uncached_input) as tokens_uncached_input,
  sum(c.tokens_cache_read) as tokens_cache_read,
  sum(c.tokens_cache_write) as tokens_cache_write,
  sum(c.tokens_output) as tokens_output,
  sum(c.tokens_reasoning) as tokens_reasoning,
  sum(c.declared_cost_usd) as declared_cost_usd,
  avg(c.duration_ms) as avg_duration_ms,
  sum(c.turns) as turns
from provider_calls c
group by c.provider, c.provider_name, c.requested_model, c.observed_model, c.effort, c.agent, c.agent_version;

-- ---------------------------------------------------------------------------------------------
-- The read-only role exists in the evidence container (postgres/init.sql), not in the test bases.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'evidence_reader') then
    grant usage on schema public to evidence_reader;
    grant select on all tables in schema public to evidence_reader;
    grant select on all sequences in schema public to evidence_reader;
  end if;
end
$$;
