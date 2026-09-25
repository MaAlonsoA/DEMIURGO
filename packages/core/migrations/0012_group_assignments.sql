-- Which engine runs each group of agents (Models & providers): one choice per group, for every
-- project. An agent's own global assignment in agent_assignments is an exception to its group, and
-- project assignments are no longer read. Append-only like agent_assignments: the current choice is
-- the latest row, and a row without provider removes it.
create table group_assignments (
  id uuid primary key default uuidv7(),
  group_id text not null,
  provider text,
  model text,
  effort text,
  assigned_by text not null,
  assigned_at timestamptz not null default now(),
  check ((provider is null) = (model is null))
);
create index group_assignments_latest on group_assignments (group_id, assigned_at desc, id desc);
create trigger group_assignments_append_only before update or delete on group_assignments
  for each row execute function append_only();
