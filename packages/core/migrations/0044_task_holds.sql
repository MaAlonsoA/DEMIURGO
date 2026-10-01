-- «On hold» (Kanban blocked item with its stated blocker): a person puts a task on hold with the reason it cannot
-- be built yet (an external prerequisite), and takes it off hold later. A held task is not ready: «Build the queue»
-- skips it. One row per hold, written by task.hold / task.release (human only); a release only fills the released_*
-- columns, so the history stays; the journal keeps every change as an event. One open hold per task.

create table task_holds (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id),
  task_id uuid not null references records (id),
  reason text not null check (length(btrim(reason)) > 0),
  held_by text not null,
  held_at timestamptz not null default now(),
  released_by text,
  released_at timestamptz
);

create unique index task_holds_one_open on task_holds (task_id) where released_at is null;
create index task_holds_project on task_holds (project_id);
