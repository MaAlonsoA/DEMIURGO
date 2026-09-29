-- The features of an epic, in order, from the moment it lists them: each reserves its FDR code and
-- says in a sentence what it does. Designing it makes the record with that code (`record_id`);
-- dropping it keeps the row, and its code is never reused.
create table planned_features (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  epic_id uuid not null references records (id),
  code text not null,
  name text not null check (btrim(name) <> ''),
  summary text not null,
  position integer not null,
  state text not null check (state in ('planned', 'designed', 'dropped')),
  record_id uuid references records (id),
  created_at timestamptz not null default now(),
  unique (project_id, code)
);
create index planned_features_of_epic on planned_features (epic_id, position);
create trigger planned_features_no_delete before delete on planned_features
  for each row execute function no_delete();
