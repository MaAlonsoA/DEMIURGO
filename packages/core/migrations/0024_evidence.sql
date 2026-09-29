-- Evidence of an acceptance criterion: how the person (or, later, the runner) checked that it holds.
-- Append-only: a criterion's evidence is its latest row. A criterion carried over unchanged (`kept`)
-- inherits the evidence of the one it comes from, so a new version is built again only in what changed.
create table evidence (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  criterion_id uuid not null references criteria (id),
  record_version_id uuid not null references record_versions (id),
  kind text not null check (kind in ('manual', 'system')),
  note text not null check (btrim(note) <> ''),
  reference text,
  state text not null check (state in ('recorded')),
  recorded_by text not null,
  created_at timestamptz not null default now()
);
create index evidence_latest on evidence (criterion_id, created_at desc, id desc);
create trigger evidence_append_only before update or delete on evidence
  for each row execute function append_only();
