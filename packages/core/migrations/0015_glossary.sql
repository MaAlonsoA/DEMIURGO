-- The project's glossary: the words a person fixed and the English term records and translations use
-- for each. Append-only like the rest of the authority: every change is a new row, and a word's
-- current term is its latest row (a `removed` row drops it).
create table glossary_terms (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  term text not null,
  english text,
  note text,
  state text not null check (state in ('set', 'removed')),
  set_by text not null,
  created_at timestamptz not null default now(),
  check ((state = 'set') = (english is not null))
);
create index glossary_terms_latest on glossary_terms (project_id, lower(term), created_at desc, id desc);
create trigger glossary_terms_append_only before update or delete on glossary_terms
  for each row execute function append_only();
