-- S0: projects, protected event log, human identity, agent runs,
-- context packs and durable engine step idempotency.

create table projects (
  id uuid primary key default uuidv7(),
  name text not null check (length(btrim(name)) > 0),
  state text not null,
  event_seq bigint not null default 0,
  created_at timestamptz not null default now()
);

-- Event log: one row per mutation, in the same transaction. INSERT only (I3).
create table events (
  id bigint generated always as identity primary key,
  project_id uuid not null references projects (id),
  seq bigint not null,
  at timestamptz not null default now(),
  actor text not null,
  command text not null,
  entity_type text not null,
  entity_id uuid not null,
  entity_version integer,
  state_before text,
  state_after text,
  before jsonb,
  after jsonb,
  cause jsonb,
  unique (project_id, seq)
);

create index events_project_entity on events (project_id, entity_type, entity_id);

create function events_insert_only() returns trigger language plpgsql as $$
begin
  raise exception 'The event log only admits INSERT (% rejected)', tg_op using errcode = 'P0001';
end
$$;

create trigger events_no_update_or_delete before update or delete on events
  for each row execute function events_insert_only();
create trigger events_no_truncate before truncate on events
  for each statement execute function events_insert_only();

-- Notification after commit, for the incremental SSE stream (Last-Event-ID).
create function events_notify() returns trigger language plpgsql as $$
begin
  perform pg_notify('demiurgo_events', json_build_object('project', new.project_id, 'id', new.id)::text);
  return null;
end
$$;

create trigger events_notify after insert on events
  for each row execute function events_notify();

-- Human identity (access infrastructure, outside a project's domain).
create table humans (
  id uuid primary key default uuidv7(),
  username text not null unique check (username ~ '^[a-z][a-z0-9_-]{1,39}$'),
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default uuidv7(),
  human_id uuid not null references humans (id),
  token_hash text not null unique,
  csrf_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

-- Context packs: immutable, identified by their hash within the project (I7).
create table context_packs (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  role text not null,
  builder text not null,
  budget jsonb not null,
  graph_version bigint not null,
  dependencies jsonb not null,
  content jsonb not null,
  hash text not null,
  state text not null,
  created_at timestamptz not null default now(),
  unique (project_id, hash)
);

create table ai_runs (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  action text not null,
  scope jsonb not null,
  method text not null,
  schema_version text not null,
  provider text not null,
  model text,
  context_pack_id uuid references context_packs (id),
  retry_of uuid references ai_runs (id),
  state text not null,
  failure_kind text,
  error text,
  output jsonb,
  usage jsonb,
  requested_by text not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- Raw agent events: one compressed blob per attempt, never one row per event.
create table ai_run_logs (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  run_id uuid not null references ai_runs (id),
  attempt integer not null,
  raw_gzip bytea not null,
  created_at timestamptz not null default now()
);

-- Idempotency of the engine's transactional steps: the effect and the completion mark
-- are committed in the same transaction, so a step repeated after a crash does not repeat its effect.
create table step_completions (
  workflow_id text not null,
  step text not null,
  result jsonb,
  completed_at timestamptz not null default now(),
  primary key (workflow_id, step)
);
