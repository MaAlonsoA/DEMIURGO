-- The person's order of the epics (the ranked product backlog). Append-only: each move writes a row for
-- every epic whose place changed, and an epic's place is its latest row. An epic without rows has no
-- place yet and goes after the placed ones, by code.
create table epic_positions (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  record_id uuid not null references records (id),
  position integer not null check (position > 0),
  set_by text not null,
  created_at timestamptz not null default now()
);
create index epic_positions_latest on epic_positions (project_id, record_id, created_at desc, id desc);
create trigger epic_positions_append_only before update or delete on epic_positions
  for each row execute function append_only();
