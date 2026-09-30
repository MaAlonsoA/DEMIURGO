-- Build steps: the stages of a durable build (repo, worktree, builder, commit, push, pr, status, ci,
-- evidence, review, publish, merge), one row per stage and outcome, per attempt. Append-only. The
-- request also keeps the branch, the pull request number and the head commit the flow works on; the
-- build_requests guard only protects the snapshot columns, so the system may set these.
alter table build_requests
  add column branch text,
  add column pr_number int,
  add column head_sha text;

create table build_steps (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  build_request_id uuid not null references build_requests (id),
  attempt int not null,
  stage text not null,
  outcome text not null check (outcome in ('started', 'ok', 'failed', 'waiting', 'changes_requested')),
  detail jsonb,
  created_at timestamptz not null default now()
);
create index build_steps_request on build_steps (build_request_id, attempt, created_at);

create function build_steps_guard() returns trigger language plpgsql as $$
begin
  raise exception 'build_steps keeps its history' using errcode = 'P0001';
end $$;
create trigger build_steps_append_only before update or delete on build_steps
  for each row execute function build_steps_guard();
