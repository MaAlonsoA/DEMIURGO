-- Observability (spec 2026-09-26 §5.2): the trace context of every entity a command created, so a
-- durable workflow step that resumes in another process can hang from the command that created its
-- entity. Written by the bus in the creating transaction; read only by the engine, only as an id.
-- Not a domain table: no commands, no design/ entry. Append-only.
create table trace_contexts (
  entity_type text not null,
  entity_id uuid not null,
  project_id uuid not null references projects (id),
  trace_parent text not null,
  created_at timestamptz not null default now(),
  primary key (entity_type, entity_id)
);
create index trace_contexts_project on trace_contexts (project_id, created_at);
create trigger trace_contexts_append_only before update or delete on trace_contexts
  for each row execute function append_only();
