-- Build requests (FDR-BUI-002): a person asks for a ready task to be built. It records the task
-- version, its feature version (the basis), the brief frozen at that moment, who asked and when. It
-- launches nothing. States: requested -> withdrawn. "Stale" is derived on read, never stored. Only
-- the state and who withdrew it may change: the snapshot is immutable and nothing is deleted.
create table build_requests (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  task_id uuid not null references records (id),
  task_version_id uuid not null references record_versions (id),
  feature_version_id uuid references record_versions (id),
  brief text not null,
  requested_by text not null,
  requested_at timestamptz not null default now(),
  state text not null default 'requested' check (state in ('requested', 'withdrawn')),
  withdrawn_by text,
  withdrawn_at timestamptz
);
-- At most one open request per task, also under concurrent writes.
create unique index build_requests_one_open on build_requests (task_id) where state = 'requested';
create index build_requests_project on build_requests (project_id, requested_at);

create function build_requests_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'build_requests keeps its history' using errcode = 'P0001';
  end if;
  if new.project_id <> old.project_id or new.task_id <> old.task_id or new.task_version_id <> old.task_version_id
     or new.feature_version_id is distinct from old.feature_version_id or new.brief <> old.brief
     or new.requested_by <> old.requested_by or new.requested_at <> old.requested_at then
    raise exception 'a build request snapshot is immutable' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger build_requests_immutable before update or delete on build_requests
  for each row execute function build_requests_guard();
