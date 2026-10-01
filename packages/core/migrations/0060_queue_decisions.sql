-- «Build the queue» decisions: one plan per change of what the queue decides, with a row per task and its reason
-- (salud-del-harness §6.1; audit mision-comidas/auditoria-cola.md). The tick runs every 60 s, so a plan is written
-- only when its hash differs from the project's latest one. Both tables are append-only (pattern of `test_runs`):
-- derived data, no command and no event.
create table queue_plans (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  decided_at timestamptz not null default now(),
  trigger text not null check (trigger in ('event', 'tick', 'command')),
  parallel_limit integer not null,
  running text[] not null,
  started text[] not null,
  ready_count integer not null,
  stopped_kind text,
  stopped_code text,
  plan_hash text not null,
  harness_version_id uuid
);
create index queue_plans_project on queue_plans (project_id, decided_at desc, id desc);

create table queue_decisions (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  plan_id uuid not null references queue_plans (id),
  task_code text not null,
  decision text not null check (decision in ('start', 'running', 'wait_dependency', 'wait_feature_busy', 'wait_schema', 'wait_module', 'wait_testability', 'wait_hold', 'stopped', 'over_limit')),
  item text,
  with_task text,
  with_source text check (with_source in ('actual', 'predicted')),
  evidence jsonb
);
create index queue_decisions_task on queue_decisions (project_id, task_code, plan_id);
create index queue_decisions_plan on queue_decisions (plan_id);

create function queue_insert_only() returns trigger language plpgsql as $$
begin
  raise exception '% only admits INSERT (% rejected)', tg_table_name, tg_op using errcode = 'P0001';
end $$;
create trigger queue_plans_no_update_or_delete before update or delete on queue_plans
  for each row execute function queue_insert_only();
create trigger queue_plans_no_truncate before truncate on queue_plans
  for each statement execute function queue_insert_only();
create trigger queue_decisions_no_update_or_delete before update or delete on queue_decisions
  for each row execute function queue_insert_only();
create trigger queue_decisions_no_truncate before truncate on queue_decisions
  for each statement execute function queue_insert_only();
