-- Issues: a problem that impairs or prevents the functions of the product (the Atlassian definition;
-- a pull request says «Fixes #123»). Not a versioned record: its own entity, like build requests or
-- holds. Kinds: `bug` (a person reports something not working) and `review_escalation` (DEMIURGO
-- opens it when the reviewer hands over something only a person can resolve). One code ISS-NNN per
-- project. Lifecycle open -> resolved (with its fix: a task, or a version of a task) | closed (with a
-- reason); a person can reopen it. Nothing is deleted; only the state, resolution and close fields change.
create table issues (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  code text not null,
  kind text not null check (kind in ('bug', 'review_escalation')),
  title text not null check (length(btrim(title)) > 0),
  body text not null default '',
  state text not null default 'open' check (state in ('open', 'resolved', 'closed')),
  task_id uuid references records (id),
  feature_id uuid references records (id),
  criterion_code text,
  build_request_id uuid references build_requests (id),
  attempt integer,
  pr_review_id uuid references pr_reviews (id),
  -- What opened it automatically (`escalation:<request>:<attempt>`, `flaky:<test>`, `main_red:<sha>`): DEMIURGO
  -- opens one issue per source and never a second while one is open.
  source_key text,
  resolution_task_id uuid references records (id),
  resolution_version_id uuid references record_versions (id),
  close_reason text,
  opened_by text not null,
  opened_at timestamptz not null default now(),
  resolved_by text,
  resolved_at timestamptz,
  closed_by text,
  closed_at timestamptz,
  unique (project_id, code)
);
-- An automatic opening is idempotent: never two open issues from the same source.
create unique index issues_one_open_per_source on issues (project_id, source_key) where source_key is not null and state = 'open';
create index issues_project_state on issues (project_id, state);

create function issues_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'issues cannot be deleted' using errcode = 'P0001';
  end if;
  if (new.id, new.project_id, new.code, new.kind, new.title, new.body, new.task_id, new.feature_id,
      new.criterion_code, new.build_request_id, new.attempt, new.pr_review_id, new.source_key, new.opened_by, new.opened_at)
     is distinct from
     (old.id, old.project_id, old.code, old.kind, old.title, old.body, old.task_id, old.feature_id,
      old.criterion_code, old.build_request_id, old.attempt, old.pr_review_id, old.source_key, old.opened_by, old.opened_at) then
    raise exception 'only the state, resolution and close fields of an issue can change' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger issues_guard before update or delete on issues
  for each row execute function issues_guard();
