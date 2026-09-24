-- S0: proyectos, diario de eventos protegido, identidad humana, ejecuciones de agentes,
-- context packs e idempotencia de pasos del motor durable.

create table projects (
  id uuid primary key default uuidv7(),
  name text not null check (length(btrim(name)) > 0),
  state text not null,
  event_seq bigint not null default 0,
  created_at timestamptz not null default now()
);

-- Diario: una fila por mutación, en la misma transacción. Solo admite INSERT (I3).
create table events (
  id bigint generated always as identity primary key,
  project_id uuid not null references projects (id),
  seq bigint not null,
  at timestamptz not null default now(),
  actor text not null,
  command text not null,
  entity_type text not null,
  entity_id uuid not null,
  entity_version integer,
  state_before text,
  state_after text,
  before jsonb,
  after jsonb,
  cause jsonb,
  unique (project_id, seq)
);

create index events_project_entity on events (project_id, entity_type, entity_id);

create function events_solo_insert() returns trigger language plpgsql as $$
begin
  raise exception 'El diario de eventos solo admite INSERT (% rechazado)', tg_op using errcode = 'P0001';
end
$$;

create trigger events_sin_update_ni_delete before update or delete on events
  for each row execute function events_solo_insert();
create trigger events_sin_truncate before truncate on events
  for each statement execute function events_solo_insert();

-- Aviso tras confirmar, para el flujo SSE incremental (Last-Event-ID).
create function events_notificar() returns trigger language plpgsql as $$
begin
  perform pg_notify('demiurgo_eventos', json_build_object('proyecto', new.project_id, 'id', new.id)::text);
  return null;
end
$$;

create trigger events_notificar after insert on events
  for each row execute function events_notificar();

-- Identidad humana (infraestructura de acceso, fuera del dominio de un proyecto).
create table humans (
  id uuid primary key default uuidv7(),
  username text not null unique check (username ~ '^[a-z][a-z0-9_-]{1,39}$'),
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default uuidv7(),
  human_id uuid not null references humans (id),
  token_hash text not null unique,
  csrf_hash text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

-- Context packs: inmutables, identificados por su hash dentro del proyecto (I7).
create table context_packs (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  role text not null,
  builder text not null,
  budget jsonb not null,
  graph_version bigint not null,
  dependencies jsonb not null,
  content jsonb not null,
  hash text not null,
  state text not null,
  created_at timestamptz not null default now(),
  unique (project_id, hash)
);

create table ai_runs (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  action text not null,
  scope jsonb not null,
  method text not null,
  schema_version text not null,
  provider text not null,
  model text,
  context_pack_id uuid references context_packs (id),
  retry_of uuid references ai_runs (id),
  state text not null,
  failure_kind text,
  error text,
  output jsonb,
  usage jsonb,
  requested_by text not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

-- Eventos crudos del agente: un blob comprimido por intento, nunca una fila por evento.
create table ai_run_logs (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  run_id uuid not null references ai_runs (id),
  attempt integer not null,
  raw_gzip bytea not null,
  created_at timestamptz not null default now()
);

-- Idempotencia de los pasos transaccionales del motor: el efecto y la marca de completado
-- se confirman en la misma transacción, así un paso repetido tras un corte no repite su efecto.
create table step_completions (
  workflow_id text not null,
  step text not null,
  result jsonb,
  completed_at timestamptz not null default now(),
  primary key (workflow_id, step)
);
