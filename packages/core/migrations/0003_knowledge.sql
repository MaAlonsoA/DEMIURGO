-- S2: taxonomy (authority), derived knowledge graph with validity per graph version,
-- classifications, verified updates, verdict cache by input_hash,
-- idea assessments and classifier evaluations. None of this is deleted: it is invalidated.

create table taxonomies (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  code text not null,
  version integer not null check (version > 0),
  title text not null,
  axes jsonb not null,
  sections jsonb not null default '[]',
  content_hash text not null,
  state text not null,
  author text not null,
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by text,
  unique (project_id, code, version)
);

create trigger taxonomies_content_immutable before update on taxonomies
  for each row when ((new.project_id, new.code, new.version, new.title, new.axes, new.sections, new.content_hash, new.author)
                     is distinct from (old.project_id, old.code, old.version, old.title, old.axes, old.sections, old.content_hash, old.author))
  execute function row_immutable();

-- Per-project graph state: version increases with each applied update.
create table knowledge_graph_state (
  project_id uuid primary key references projects (id),
  version bigint not null default 0,
  last_update_id uuid
);

create table knowledge_nodes (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  ref text not null,
  kind text not null,
  source_type text not null,
  source_id uuid,
  source_version integer,
  label text not null,
  body text not null,
  categories jsonb not null default '{}',
  epistemic text not null check (epistemic in ('confirmed', 'proposed', 'pending', 'unknown')),
  valid_from bigint not null,
  valid_to bigint,
  created_by_update uuid,
  state text not null,
  search tsvector generated always as (to_tsvector('spanish', label || ' ' || body)) stored,
  created_at timestamptz not null default now()
);

create index knowledge_nodes_current on knowledge_nodes (project_id, ref) where valid_to is null;
create index knowledge_nodes_search on knowledge_nodes using gin (search);

create table knowledge_edges (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  kind text not null,
  from_node uuid not null references knowledge_nodes (id),
  to_node uuid not null references knowledge_nodes (id),
  valid_from bigint not null,
  valid_to bigint,
  created_by_update uuid,
  state text not null,
  created_at timestamptz not null default now()
);

create index knowledge_edges_from on knowledge_edges (project_id, from_node) where valid_to is null;
create index knowledge_edges_to on knowledge_edges (project_id, to_node) where valid_to is null;

-- Nodes and edges only change their state and their end of validity (invalidate, never delete).
create function knowledge_invalidate_only() returns trigger language plpgsql as $$
begin
  -- "search" is a generated column: in a BEFORE trigger it is not computed yet and does not count.
  if (to_jsonb(new) - 'valid_to' - 'state' - 'search') is distinct from (to_jsonb(old) - 'valid_to' - 'state' - 'search')
     or old.valid_to is not null then
    raise exception 'Derived knowledge can only be invalidated' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger knowledge_nodes_invalidate_only before update on knowledge_nodes
  for each row execute function knowledge_invalidate_only();
create trigger knowledge_edges_invalidate_only before update on knowledge_edges
  for each row execute function knowledge_invalidate_only();

create table knowledge_updates (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  trigger jsonb not null,
  trigger_seq bigint not null,
  change jsonb,
  candidates jsonb,
  candidates_hash text,
  input_hash text,
  classifier text,
  verdicts jsonb,
  verification jsonb,
  operations jsonb,
  graph_version_before bigint,
  graph_version_after bigint,
  failure text,
  state text not null,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

create index knowledge_updates_pending on knowledge_updates (project_id, state);

-- Verdicts and classifications by input_hash: the same input gives the same applied result.
create table verdict_cache (
  input_hash text primary key,
  classifier text not null,
  answers jsonb not null,
  created_at timestamptz not null default now()
);

create trigger verdict_cache_immutable before update on verdict_cache for each row execute function row_immutable();

create table classifications (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  node_ref text not null,
  taxonomy_id uuid not null references taxonomies (id),
  axis text not null,
  category text not null,
  confidence double precision not null,
  justification text not null,
  classifier text not null,
  input_hash text not null,
  update_id uuid references knowledge_updates (id),
  resolution jsonb,
  resolved_by text,
  state text not null,
  created_at timestamptz not null default now()
);

create trigger classifications_content_immutable before update on classifications
  for each row when ((new.project_id, new.node_ref, new.taxonomy_id, new.axis, new.category, new.confidence, new.justification,
                      new.classifier, new.input_hash)
                     is distinct from (old.project_id, old.node_ref, old.taxonomy_id, old.axis, old.category, old.confidence,
                                       old.justification, old.classifier, old.input_hash))
  execute function row_immutable();

create table idea_assessments (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  proposal_id uuid not null references proposals (id),
  findings jsonb not null,
  graph_version bigint not null,
  classifier text not null,
  input_hash text not null,
  state text not null,
  created_at timestamptz not null default now(),
  unique (proposal_id)
);

create trigger idea_assessments_immutable before update on idea_assessments for each row execute function row_immutable();

create table classifier_evaluations (
  id uuid primary key default uuidv7(),
  classifier text not null,
  dataset text not null,
  partition text not null,
  task text not null,
  metrics jsonb not null,
  file text,
  created_at timestamptz not null default now()
);

create trigger taxonomies_no_delete before delete on taxonomies for each row execute function no_delete();
create trigger knowledge_nodes_no_delete before delete on knowledge_nodes for each row execute function no_delete();
create trigger knowledge_edges_no_delete before delete on knowledge_edges for each row execute function no_delete();
create trigger knowledge_updates_no_delete before delete on knowledge_updates for each row execute function no_delete();
create trigger classifications_no_delete before delete on classifications for each row execute function no_delete();
create trigger idea_assessments_no_delete before delete on idea_assessments for each row execute function no_delete();

-- S0 and S1 tables that also do not admit DELETE (revision of S0).
create trigger sources_no_delete before delete on sources for each row execute function no_delete();
create trigger agent_tokens_no_delete before delete on agent_tokens for each row execute function no_delete();
create trigger ai_run_logs_no_delete before delete on ai_run_logs for each row execute function no_delete();
