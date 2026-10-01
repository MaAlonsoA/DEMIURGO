-- «Build the queue» mode (VISION.md, Construcción y evidencia): when on, DEMIURGO starts the next ready
-- task by itself after each merge. One row per project, written by build.queue_auto (human only); the
-- journal keeps every change as an event.

create table build_queue_settings (
  project_id uuid primary key references projects (id),
  auto boolean not null default false,
  set_by text not null,
  set_at timestamptz not null default now()
);
