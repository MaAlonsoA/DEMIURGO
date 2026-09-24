-- S1: explorations, conversation, questions, records with immutable versions, criteria,
-- links, proposal batches, sources and external agent tokens.

create table agent_tokens (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  name text not null check (name ~ '^[a-z][a-z0-9-]{1,39}$'),
  token_hash text not null unique,
  state text not null,
  issued_by text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table explorations (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  parent_id uuid references explorations (id),
  purpose text not null check (length(btrim(purpose)) > 0),
  origin_type text check (origin_type in ('exploration', 'question', 'record_version', 'proposal', 'change_set', 'task', 'evidence')),
  origin_id uuid,
  origin_version integer,
  state text not null,
  state_reason text,
  opened_by text not null,
  created_at timestamptz not null default now()
);

create table questions (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  exploration_id uuid not null references explorations (id),
  question text not null,
  reason text,
  impact text check (impact in ('high', 'medium', 'low')),
  conclusion text,
  reasoning text,
  state text not null,
  state_reason text,
  raised_by text not null,
  created_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  exploration_id uuid not null references explorations (id),
  question_id uuid references questions (id),
  author text not null,
  run_id uuid references ai_runs (id),
  kind text check (kind in ('claim', 'hypothesis', 'unknown')),
  body text not null check (length(btrim(body)) > 0),
  state text not null,
  created_at timestamptz not null default now()
);

create table sources (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  name text not null,
  content text not null,
  content_hash text not null,
  registered_by text not null,
  state text not null,
  created_at timestamptz not null default now()
);

create table records (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  code text not null,
  type text not null check (type in ('decision', 'fdr', 'adr', 'bug')),
  domain text not null,
  state text not null,
  created_at timestamptz not null default now(),
  unique (project_id, code)
);

-- A version's content is immutable: only its state and approval can change (I4).
create table record_versions (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  record_id uuid not null references records (id),
  n integer not null check (n > 0),
  title text not null,
  sections jsonb not null,
  annexes jsonb not null default '{}',
  increment text,
  change_note text,
  origin jsonb,
  author text not null,
  content_hash text not null,
  state text not null,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text,
  unique (record_id, n)
);

create function record_versions_content_immutable() returns trigger language plpgsql as $$
begin
  if (new.project_id, new.record_id, new.n, new.title, new.sections, new.annexes, new.increment, new.change_note,
      new.origin, new.author, new.content_hash, new.created_at)
     is distinct from
     (old.project_id, old.record_id, old.n, old.title, old.sections, old.annexes, old.increment, old.change_note,
      old.origin, old.author, old.content_hash, old.created_at) then
    raise exception 'A version''s content is immutable; create a new version' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger record_versions_immutable before update on record_versions
  for each row execute function record_versions_content_immutable();

create table criteria (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  record_version_id uuid not null references record_versions (id),
  code text not null,
  title text not null,
  statement text not null,
  verification text not null check (verification in ('automatic', 'manual')),
  check_text text not null,
  derived_from uuid references criteria (id),
  carry text not null check (carry in ('new', 'kept', 'modified')),
  position integer not null,
  state text not null,
  created_at timestamptz not null default now(),
  unique (record_version_id, code)
);

create function row_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'Table % does not admit changes to its rows', tg_table_name using errcode = 'P0001';
end
$$;

create trigger criteria_immutable before update on criteria for each row execute function row_immutable();

create table links (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  type text not null check (type in ('based_on', 'design_of', 'covers', 'origin', 'conflicts_with', 'derived_from')),
  from_type text not null,
  from_id uuid not null,
  from_version integer,
  to_type text not null,
  to_id uuid not null,
  to_version integer,
  state text not null,
  created_by text not null,
  created_at timestamptz not null default now()
);

create index links_from on links (project_id, from_id);
create index links_to on links (project_id, to_id);

create table proposal_batches (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  kind text not null check (kind in ('agent', 'system_package', 'import', 'knowledge')),
  producer text not null,
  run_id uuid references ai_runs (id),
  context_pack_id uuid references context_packs (id),
  resolution_mode text not null check (resolution_mode in ('item', 'package')),
  dependencies jsonb not null default '[]',
  summary text,
  tree_hash text,
  state text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by text
);

create table proposals (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  batch_id uuid not null references proposal_batches (id),
  position integer not null,
  type text not null,
  payload jsonb not null,
  dependencies jsonb not null default '[]',
  state text not null,
  resolution jsonb,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create index proposals_batch on proposals (batch_id, position);

-- Nothing is deleted: it is archived, discarded or made obsolete (I9).
create function no_delete() returns trigger language plpgsql as $$
begin
  raise exception 'Table % does not admit DELETE: archive it or discard it instead', tg_table_name using errcode = 'P0001';
end
$$;

create trigger projects_no_delete before delete on projects for each row execute function no_delete();
create trigger explorations_no_delete before delete on explorations for each row execute function no_delete();
create trigger questions_no_delete before delete on questions for each row execute function no_delete();
create trigger messages_no_delete before delete on messages for each row execute function no_delete();
create trigger records_no_delete before delete on records for each row execute function no_delete();
create trigger record_versions_no_delete before delete on record_versions for each row execute function no_delete();
create trigger criteria_no_delete before delete on criteria for each row execute function no_delete();
create trigger links_no_delete before delete on links for each row execute function no_delete();
create trigger proposal_batches_no_delete before delete on proposal_batches for each row execute function no_delete();
create trigger proposals_no_delete before delete on proposals for each row execute function no_delete();
create trigger ai_runs_no_delete before delete on ai_runs for each row execute function no_delete();
create trigger context_packs_no_delete before delete on context_packs for each row execute function no_delete();
create trigger context_packs_immutable before update on context_packs for each row execute function row_immutable();
