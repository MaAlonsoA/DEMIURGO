-- Jev's opinion on whether a task needs something another task builds (dependencies between tasks, not between
-- whole features). One row per judgment of the pair (task version, needed task version); append-only
-- (pattern of 0063): the latest row of a pair counts.
create table task_need_opinions (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  record_id uuid not null references records (id),
  record_version_id uuid not null references record_versions (id),
  needed_record_id uuid not null references records (id),
  needed_version_id uuid not null references record_versions (id),
  p double precision not null check (p >= 0 and p <= 1),
  classifier_id text not null,
  input_hash text not null,
  question_version text not null,
  created_at timestamptz not null default now()
);
create index task_need_opinions_pair on task_need_opinions (record_version_id, needed_version_id, created_at desc, id desc);
create index task_need_opinions_project on task_need_opinions (project_id);

create trigger task_need_opinions_no_update_or_delete before update or delete on task_need_opinions
  for each row execute function judgments_insert_only();
create trigger task_need_opinions_no_truncate before truncate on task_need_opinions
  for each statement execute function judgments_insert_only();
