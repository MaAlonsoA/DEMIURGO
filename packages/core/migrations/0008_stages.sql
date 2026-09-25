-- Design stages (design engine): one row per opened stage of a project, with the thread where its
-- mandatory questions live. The mandatory questions carry their stage and their catalog key.

create table stages (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  stage text not null check (stage in ('requirements', 'quality', 'architecture', 'security', 'production')),
  position integer not null,
  exploration_id uuid not null references explorations (id),
  state text not null,
  opened_by text not null,
  passed_by text,
  passed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (project_id, stage)
);

alter table questions
  add column stage_id uuid references stages (id),
  add column stage_key text;

create unique index questions_stage_key on questions (stage_id, stage_key) where stage_key is not null;
