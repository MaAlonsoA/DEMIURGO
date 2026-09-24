-- Agents & providers (FDR-AGE-002): the providers' catalogs, the agents' assignments, the provider
-- sessions of each conversation, and every provider call with its events. Catalogs and assignments
-- are workspace settings (not tied to a project) and append-only: the current one is the latest.

create function append_only() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only', tg_table_name using errcode = 'P0001';
end $$;

create table provider_catalogs (
  id uuid primary key default uuidv7(),
  provider text not null,
  discovered_at timestamptz not null default now(),
  discovered_by text not null,
  label text not null,
  installed boolean not null,
  version text,
  ready boolean not null,
  message text,
  sessions boolean not null,
  models jsonb not null
);
create index provider_catalogs_latest on provider_catalogs (provider, discovered_at desc, id desc);
create trigger provider_catalogs_append_only before update or delete on provider_catalogs
  for each row execute function append_only();

-- A row without provider removes the assignment (unassign).
create table agent_assignments (
  id uuid primary key default uuidv7(),
  scope text not null check (scope in ('global', 'project')),
  project_id uuid references projects (id),
  agent text not null,
  provider text,
  model text,
  effort text,
  assigned_by text not null,
  assigned_at timestamptz not null default now(),
  check ((scope = 'global') = (project_id is null)),
  check ((provider is null) = (model is null))
);
create index agent_assignments_latest on agent_assignments (agent, scope, project_id, assigned_at desc, id desc);
create trigger agent_assignments_append_only before update or delete on agent_assignments
  for each row execute function append_only();

-- The live provider session of each conversation (thread + agent@version + provider + model).
create table agent_sessions (
  key text primary key,
  project_id uuid not null references projects (id),
  provider text not null,
  provider_session_id text not null,
  last_run_id uuid not null references ai_runs (id),
  updated_at timestamptz not null default now()
);

-- One row per provider invocation: an attempt of a run or a call of the knowledge classifier.
create table agent_calls (
  id uuid primary key default uuidv7(),
  project_id uuid references projects (id),
  run_id uuid references ai_runs (id),
  agent text not null,
  agent_version text not null,
  provider text not null,
  requested_model text not null,
  observed_model text,
  effort text,
  session_mode text not null check (session_mode in ('none', 'fresh', 'resumed')),
  provider_session_id text,
  prompt_hash text not null,
  state text not null check (state in ('running', 'ok', 'error')),
  failure_kind text,
  error text,
  usage jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index agent_calls_by_run on agent_calls (run_id, started_at);
create index agent_calls_by_time on agent_calls (started_at);

create table agent_call_events (
  id bigint generated always as identity primary key,
  project_id uuid references projects (id),
  call_id uuid not null references agent_calls (id),
  seq integer not null,
  received_at timestamptz not null default now(),
  kind text not null,
  tokens integer,
  raw text not null,
  unique (call_id, seq)
);
create trigger agent_call_events_append_only before update or delete on agent_call_events
  for each row execute function append_only();

-- Live progress: the project's SSE stream reads the events back from the table, never from the payload.
create function agent_call_events_notify() returns trigger language plpgsql as $$
declare
  call_run uuid;
begin
  if new.project_id is not null then
    select run_id into call_run from agent_calls where id = new.call_id;
    perform pg_notify(
      'demiurgo_events',
      json_build_object('project', new.project_id, 'progress', coalesce(call_run::text, ''))::text
    );
  end if;
  return new;
end $$;
create trigger agent_call_events_notify after insert on agent_call_events
  for each row execute function agent_call_events_notify();

-- What each run resolved and how it ran (the method becomes <agent>@<version>).
alter table ai_runs
  add column agent text,
  add column prompt_hash text,
  add column requested_model text,
  add column effort text,
  add column session_mode text,
  add column provider_session_id text,
  add column delta_hash text;
