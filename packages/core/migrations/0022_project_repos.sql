-- Each project's repository (repo/repo.ts): a folder with git where DEMIURGO writes design/ in the
-- canonical format after each authority event and commits it. Derived data: the database is the
-- authority, the repository its readable copy, and each commit is kept here to show it.

create table project_repos (
  project_id uuid primary key references projects (id),
  dir text not null unique,
  created_at timestamptz not null default now()
);

create table project_commits (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  sha text not null,
  message text not null,
  actor text not null,
  record_version_id uuid references record_versions (id),
  files jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create index project_commits_project on project_commits (project_id, created_at desc);
create index project_commits_version on project_commits (record_version_id);
