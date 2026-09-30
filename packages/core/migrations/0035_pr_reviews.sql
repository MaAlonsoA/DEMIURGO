-- PR reviews: the verdict of the dedicated reviewer agent on the pull request of a build request.
-- It becomes the required GitHub status `demiurgo/review`. Append-only: the only change allowed is
-- setting `published_at` once, when the verdict has been published to GitHub.
create table pr_reviews (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  build_request_id uuid not null references build_requests (id),
  run_id uuid not null references ai_runs (id),
  verdict text not null check (verdict in ('approve', 'request_changes')),
  summary text not null,
  comments jsonb not null,
  criteria jsonb not null,
  published_at timestamptz,
  created_at timestamptz not null default now()
);
create index pr_reviews_request on pr_reviews (build_request_id, created_at);

create function pr_reviews_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'pr_reviews keeps its history' using errcode = 'P0001';
  end if;
  if new.id <> old.id or new.project_id <> old.project_id or new.build_request_id <> old.build_request_id
     or new.run_id <> old.run_id or new.verdict <> old.verdict or new.summary <> old.summary
     or new.comments <> old.comments or new.criteria <> old.criteria or new.created_at <> old.created_at then
    raise exception 'a pr review is immutable' using errcode = 'P0001';
  end if;
  if old.published_at is not null and new.published_at is distinct from old.published_at then
    raise exception 'a pr review is published once' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger pr_reviews_immutable before update or delete on pr_reviews
  for each row execute function pr_reviews_guard();
