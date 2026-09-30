-- What a task covers: the codes of the feature's acceptance criteria it implements. A field of the
-- task outside its versioned content, like its size. Append-only: the latest row is the task's list;
-- a task without rows covers nothing (legacy tasks carry criteria of their own).
create table task_covers (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  record_id uuid not null references records (id),
  codes text[] not null,
  set_by text not null,
  created_at timestamptz not null default now()
);
create index task_covers_latest on task_covers (record_id, created_at desc, id desc);
create trigger task_covers_append_only before update or delete on task_covers
  for each row execute function append_only();
