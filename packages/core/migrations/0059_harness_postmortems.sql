-- Harness post-mortems: a deterministic, blameless post-mortem per ended build request (Google SRE book,
-- «Postmortem Culture»: focus on contributing causes, keep them in a repository and aggregate them). One row per
-- (request, rules version, inputs hash): computing the same thing twice writes nothing; a new rules version or a late
-- input writes a new row and keeps the old ones. Both tables are append-only (pattern of `test_runs`).
create table harness_postmortems (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  build_request_id uuid not null references build_requests (id),
  rules_version text not null,
  harness_version_id uuid,
  inputs_hash text not null,
  attempts integer not null,
  outcome text not null check (outcome in ('merged', 'withdrawn', 'failed', 'needs_you')),
  findings integer not null,
  computed_at timestamptz not null default now(),
  unique (build_request_id, rules_version, inputs_hash)
);
create index harness_postmortems_request on harness_postmortems (build_request_id, rules_version, computed_at desc);
create index harness_postmortems_project on harness_postmortems (project_id, computed_at desc);

create table harness_findings (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  postmortem_id uuid not null references harness_postmortems (id),
  build_request_id uuid not null,
  attempt integer,
  piece text not null,
  finding text not null,
  class text not null check (class in ('tp', 'fp', 'fn', 'tn', 'benefit', 'cost', 'info')),
  ground_truth text,
  value numeric,
  unit text check (unit in ('min', 'ci_runs', 'tokens', 'usd', 'person_actions', 'files', 'tests', 'loops', 'attempts')),
  subject text,
  evidence jsonb not null,
  created_at timestamptz not null default now()
);
create index harness_findings_request on harness_findings (build_request_id, piece, finding);
create index harness_findings_project on harness_findings (project_id, created_at desc);

create function harness_insert_only() returns trigger language plpgsql as $$
begin
  raise exception '% only admits INSERT (% rejected)', tg_table_name, tg_op using errcode = 'P0001';
end $$;
create trigger harness_postmortems_no_update_or_delete before update or delete on harness_postmortems
  for each row execute function harness_insert_only();
create trigger harness_postmortems_no_truncate before truncate on harness_postmortems
  for each statement execute function harness_insert_only();
create trigger harness_findings_no_update_or_delete before update or delete on harness_findings
  for each row execute function harness_insert_only();
create trigger harness_findings_no_truncate before truncate on harness_findings
  for each statement execute function harness_insert_only();
