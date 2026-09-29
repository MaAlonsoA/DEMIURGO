-- The backup engine of each group of agents and, as an exception, of one agent (Models & providers):
-- it runs only when the chosen engine can't, because it isn't available or can't be reached, and the
-- run says so. Append-only like the assignments: the current backup is the latest row, and a row
-- without provider removes it. Exactly one of agent and group_id.
create table engine_fallbacks (
  id uuid primary key default uuidv7(),
  agent text,
  group_id text,
  provider text,
  model text,
  effort text,
  assigned_by text not null,
  assigned_at timestamptz not null default now(),
  check ((agent is null) <> (group_id is null)),
  check ((provider is null) = (model is null))
);
create index engine_fallbacks_latest on engine_fallbacks (agent, group_id, assigned_at desc, id desc);
create trigger engine_fallbacks_append_only before update or delete on engine_fallbacks
  for each row execute function append_only();

-- A run that ran on the backup engine: the engine it replaced and why ({ from, reason }).
alter table ai_runs add column fallback jsonb;
