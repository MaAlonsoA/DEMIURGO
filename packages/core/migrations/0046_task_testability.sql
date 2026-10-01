-- Jev's opinion on whether each automatic criterion a task covers can be checked by an automated
-- test in the project's CI (H97): three probabilities per criterion, derived and recomputable. The
-- latest row of a (task, criterion) is the active one; the policy that turns the probabilities into
-- a warning lives in code, so its thresholds change without recomputing. It never changes the task.
create table task_testability_opinions (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  record_id uuid not null references records (id),
  record_version_id uuid not null references record_versions (id),
  criterion_code text not null,
  can_check_in_ci double precision not null,
  needs_outside_ci double precision not null,
  needs_unbuilt_feature double precision not null,
  classifier_id text not null,
  input_hash text not null,
  created_at timestamptz not null default now()
);
create index task_testability_latest on task_testability_opinions (record_id, criterion_code, created_at desc, id desc);
create trigger task_testability_opinions_append_only before update or delete on task_testability_opinions
  for each row execute function append_only();
