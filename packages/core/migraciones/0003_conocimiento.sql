-- S2: taxonomía (autoridad), grafo de conocimiento derivado con validez por versión del grafo,
-- clasificaciones, actualizaciones verificadas, caché de veredictos por input_hash,
-- evaluaciones de ideas y del clasificador. Nada de esto se borra: se invalida.

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

create trigger taxonomies_contenido_inmutable before update on taxonomies
  for each row when ((new.project_id, new.code, new.version, new.title, new.axes, new.sections, new.content_hash, new.author)
                     is distinct from (old.project_id, old.code, old.version, old.title, old.axes, old.sections, old.content_hash, old.author))
  execute function fila_inmutable();

-- Estado del grafo por proyecto: versión que sube con cada actualización aplicada.
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
  epistemic text not null check (epistemic in ('confirmado', 'propuesto', 'pendiente', 'desconocido')),
  valid_from bigint not null,
  valid_to bigint,
  created_by_update uuid,
  state text not null,
  search tsvector generated always as (to_tsvector('spanish', label || ' ' || body)) stored,
  created_at timestamptz not null default now()
);

create index knowledge_nodes_vigentes on knowledge_nodes (project_id, ref) where valid_to is null;
create index knowledge_nodes_busqueda on knowledge_nodes using gin (search);

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

create index knowledge_edges_desde on knowledge_edges (project_id, from_node) where valid_to is null;
create index knowledge_edges_hacia on knowledge_edges (project_id, to_node) where valid_to is null;

-- Nodos y aristas solo cambian su estado y su fin de validez (invalidar, nunca borrar).
create function conocimiento_solo_invalidar() returns trigger language plpgsql as $$
begin
  -- «search» es una columna generada: en un BEFORE aún no está calculada y no cuenta.
  if (to_jsonb(new) - 'valid_to' - 'state' - 'search') is distinct from (to_jsonb(old) - 'valid_to' - 'state' - 'search')
     or old.valid_to is not null then
    raise exception 'El conocimiento derivado solo se invalida' using errcode = 'P0001';
  end if;
  return new;
end
$$;

create trigger knowledge_nodes_solo_invalidar before update on knowledge_nodes
  for each row execute function conocimiento_solo_invalidar();
create trigger knowledge_edges_solo_invalidar before update on knowledge_edges
  for each row execute function conocimiento_solo_invalidar();

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

create index knowledge_updates_pendientes on knowledge_updates (project_id, state);

-- Veredictos y clasificaciones por input_hash: la misma entrada da el mismo resultado aplicado.
create table verdict_cache (
  input_hash text primary key,
  classifier text not null,
  answers jsonb not null,
  created_at timestamptz not null default now()
);

create trigger verdict_cache_inmutable before update on verdict_cache for each row execute function fila_inmutable();

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

create trigger classifications_contenido_inmutable before update on classifications
  for each row when ((new.project_id, new.node_ref, new.taxonomy_id, new.axis, new.category, new.confidence, new.justification,
                      new.classifier, new.input_hash)
                     is distinct from (old.project_id, old.node_ref, old.taxonomy_id, old.axis, old.category, old.confidence,
                                       old.justification, old.classifier, old.input_hash))
  execute function fila_inmutable();

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

create trigger idea_assessments_inmutables before update on idea_assessments for each row execute function fila_inmutable();

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

create trigger taxonomies_sin_borrado before delete on taxonomies for each row execute function sin_borrado();
create trigger knowledge_nodes_sin_borrado before delete on knowledge_nodes for each row execute function sin_borrado();
create trigger knowledge_edges_sin_borrado before delete on knowledge_edges for each row execute function sin_borrado();
create trigger knowledge_updates_sin_borrado before delete on knowledge_updates for each row execute function sin_borrado();
create trigger classifications_sin_borrado before delete on classifications for each row execute function sin_borrado();
create trigger idea_assessments_sin_borrado before delete on idea_assessments for each row execute function sin_borrado();

-- Tablas de S0 y S1 que tampoco admiten DELETE (revisión de S0).
create trigger sources_sin_borrado before delete on sources for each row execute function sin_borrado();
create trigger agent_tokens_sin_borrado before delete on agent_tokens for each row execute function sin_borrado();
create trigger ai_run_logs_sin_borrado before delete on ai_run_logs for each row execute function sin_borrado();
