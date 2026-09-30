-- Task effort size (FDR-DEL-006): a field of the task outside its versioned content. Append-only: a
-- task's size is its latest row; a task without rows has no size (legacy, "No size"). Each row keeps
-- who set it and the size it replaced.
create table task_sizes (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  record_id uuid not null references records (id),
  size text not null check (size in ('XS', 'S', 'M', 'L', 'XL')),
  previous text check (previous in ('XS', 'S', 'M', 'L', 'XL')),
  set_by text not null,
  created_at timestamptz not null default now()
);
create index task_sizes_latest on task_sizes (record_id, created_at desc, id desc);
create trigger task_sizes_append_only before update or delete on task_sizes
  for each row execute function append_only();

-- Jev's second opinion on a task's size: derived and recomputable, the latest row is the active one.
create table task_size_opinions (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  record_id uuid not null references records (id),
  record_version_id uuid not null references record_versions (id),
  size text not null check (size in ('XS', 'S', 'M', 'L', 'XL')),
  confidence double precision not null,
  classifier_id text not null,
  created_at timestamptz not null default now()
);
create index task_size_opinions_latest on task_size_opinions (record_id, created_at desc, id desc);
create trigger task_size_opinions_append_only before update or delete on task_size_opinions
  for each row execute function append_only();

-- "Keep <size>": the person dismisses a dispute with one opinion; the next opinion ends it.
create table task_size_dismissals (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  record_id uuid not null references records (id),
  opinion_id uuid not null references task_size_opinions (id),
  size text not null check (size in ('XS', 'S', 'M', 'L', 'XL')),
  dismissed_by text not null,
  created_at timestamptz not null default now()
);
create index task_size_dismissals_opinion on task_size_dismissals (opinion_id);
create trigger task_size_dismissals_append_only before update or delete on task_size_dismissals
  for each row execute function append_only();
