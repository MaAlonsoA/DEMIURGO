-- Test runs: every test case of every CI JUnit report, per test and commit (not only the ones tied to a
-- criterion). Flakiness is a property of a test at one commit (it passed and failed on the same SHA), so it needs
-- the history of results, not just the last evidence steps (Google Testing Blog, «Flaky Tests at Google and How We
-- Mitigate Them», 2016; Martin Fowler, «Eradicating Non-Determinism in Tests»). Append-only: rows are never changed
-- or deleted. Written in the same transaction as `evidence.ingest_junit`.
create table test_runs (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  build_request_id uuid references build_requests (id),
  attempt integer,
  head_sha text,
  ci_run_id text,
  test_name text not null,
  file text,
  criterion_code text,
  outcome text not null check (outcome in ('pass', 'fail', 'skip')),
  duration_ms integer,
  recorded_at timestamptz not null default now()
);
create index test_runs_project_test on test_runs (project_id, test_name);
create index test_runs_project_sha on test_runs (project_id, head_sha);

create function test_runs_insert_only() returns trigger language plpgsql as $$
begin
  raise exception 'test_runs only admits INSERT (% rejected)', tg_op using errcode = 'P0001';
end $$;
create trigger test_runs_no_update_or_delete before update or delete on test_runs
  for each row execute function test_runs_insert_only();
create trigger test_runs_no_truncate before truncate on test_runs
  for each statement execute function test_runs_insert_only();
