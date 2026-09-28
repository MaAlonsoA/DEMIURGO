-- Records are always in English; a person reads them in their own language through reading
-- translations. A translation is never authority and leaves no event in the journal: it's a cache
-- keyed by the fingerprint of the source, so a changed source is translated again. Append-only.
create table translations (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  subject_kind text not null check (subject_kind in ('question', 'message', 'proposal', 'record_version', 'exploration')),
  subject_id uuid not null,
  lang text not null,
  source_hash text not null,
  fields jsonb not null,
  provider text not null,
  model text not null,
  created_at timestamptz not null default now(),
  unique (subject_kind, subject_id, lang, source_hash)
);
create trigger translations_append_only before update or delete on translations
  for each row execute function append_only();

-- The language a person reads DEMIURGO in: the interface and the reading translations. Null follows
-- the browser.
alter table humans add column locale text check (locale in ('en', 'es'));
