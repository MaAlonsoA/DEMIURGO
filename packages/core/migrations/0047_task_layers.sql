-- Jev's opinion on which layers of the product a task will change (H101): five probabilities per task
-- version (database schema, server, UI, tests only, deploy), derived and recomputable. «Build the queue»
-- reads the latest row of a task to avoid running two schema-changing tasks at once (their migrations
-- would take the same number). The threshold lives in code, so it changes without recomputing.
create table task_layers_opinions (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  record_id uuid not null references records (id),
  record_version_id uuid not null references record_versions (id),
  schema_p double precision not null,
  server_p double precision not null,
  ui_p double precision not null,
  tests_only_p double precision not null,
  deploy_p double precision not null,
  classifier_id text not null,
  input_hash text not null,
  created_at timestamptz not null default now()
);
create index task_layers_latest on task_layers_opinions (record_id, created_at desc, id desc);
create trigger task_layers_opinions_append_only before update or delete on task_layers_opinions
  for each row execute function append_only();
