-- Task forensics: a blameless post-mortem of one task (Google SRE book ch. 15 «Postmortem Culture: Learning
-- from Failure»; US Army After Action Review: what was planned, what happened, why, what to sustain and
-- improve), written by an agent from ALL the evidence of how the task was designed and built. And the
-- playbooks aggregated from them, one per error class. Both tables are append-only (the same insert-only
-- trigger as queue_plans): a new analysis or a new playbook version is a new row; the latest wins.
create table task_forensics (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  task_id uuid not null references records (id),
  task_version_id uuid not null references record_versions (id),
  request_ids uuid[] not null default '{}',
  ai_run_id uuid not null references ai_runs (id),
  analysis jsonb not null,
  -- sha256 of the evidence bundle the agent read: the same hash means the same evidence.
  evidence_hash text not null,
  -- Hash of the checklist's shape (the ids of every piece of DEMIURGO): rows of different catalogs are never mixed.
  catalog_version text not null,
  agent_version text not null,
  engine jsonb not null,
  created_at timestamptz not null default now(),
  unique (ai_run_id)
);
create index task_forensics_task on task_forensics (project_id, task_id, created_at desc, id desc);

create table forensic_playbooks (
  id uuid primary key default uuidv7(),
  -- Null: a playbook for every project.
  project_id uuid references projects (id),
  class_key text not null,
  version int not null check (version >= 1),
  entry jsonb not null,
  based_on uuid[] not null default '{}',
  ai_run_id uuid not null references ai_runs (id),
  created_at timestamptz not null default now(),
  unique (ai_run_id)
);
create unique index forensic_playbooks_version on forensic_playbooks (coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid), class_key, version);

create trigger task_forensics_no_update_or_delete before update or delete on task_forensics
  for each row execute function queue_insert_only();
create trigger task_forensics_no_truncate before truncate on task_forensics
  for each statement execute function queue_insert_only();
create trigger forensic_playbooks_no_update_or_delete before update or delete on forensic_playbooks
  for each row execute function queue_insert_only();
create trigger forensic_playbooks_no_truncate before truncate on forensic_playbooks
  for each statement execute function queue_insert_only();
