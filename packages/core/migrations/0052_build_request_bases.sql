-- The basis of an open build request can be adopted again (FDR-BUI-002): when the task or its feature
-- gets a newer approved version, the next attempt builds on it. The request snapshot stays immutable
-- (0028); each adoption is appended here and the latest row is the effective basis. Nothing is
-- updated or deleted.
create table build_request_bases (
  id uuid primary key default uuidv7(),
  build_request_id uuid not null references build_requests (id),
  task_version_id uuid not null references record_versions (id),
  feature_version_id uuid references record_versions (id),
  brief text not null,
  adopted_by text not null,
  adopted_at timestamptz not null default now(),
  attempt integer not null
);
create index build_request_bases_request on build_request_bases (build_request_id, adopted_at);

create function build_request_bases_guard() returns trigger language plpgsql as $$
begin
  raise exception 'build_request_bases is append-only' using errcode = 'P0001';
end $$;
create trigger build_request_bases_append_only before update or delete on build_request_bases
  for each row execute function build_request_bases_guard();
