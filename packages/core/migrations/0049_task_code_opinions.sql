-- What «Code to extend» showed the builder of a task (build/queue.ts, classifier/code-rerank.ts): for each
-- candidate file of each attempt, the deterministic score (0..1, the best candidate being 1), Jev's
-- probability that the task edits it (null when Jev did not take part), and the place it got in the brief.
-- Derived and append-only: packages/core/scripts/eval-code-map.ts and later evaluations compare it with the
-- files the merged pull request really changed (its footprint).
create table task_code_opinions (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  build_request_id uuid not null references build_requests (id),
  attempt integer not null,
  record_version_id uuid not null references record_versions (id),
  path text not null,
  deterministic_score double precision not null,
  jev_p double precision,
  rank integer not null,
  classifier_id text not null,
  input_hash text,
  created_at timestamptz not null default now()
);
create index task_code_opinions_by_request on task_code_opinions (build_request_id, attempt, rank);
create trigger task_code_opinions_append_only before update or delete on task_code_opinions
  for each row execute function append_only();
