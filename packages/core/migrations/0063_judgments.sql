-- The outcome of each judgment and the cost of each Jev call (salud-del-harness §6.3 and §6.4). Both tables are
-- append-only (pattern of `harness_postmortems`). `test_runs` already has `build_request_id`, `attempt` and
-- `ci_run_id` (migration 0055), so this migration does not touch it.

-- What really happened after a judgment (a size opinion, a schema guess, a file offered to the builder…): written by
-- the post-mortem, one row per (judgment, outcome, rules version), so recomputing writes nothing.
create table judgment_outcomes (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  judgment_table text not null,
  judgment_id uuid,
  judgment_key text not null,
  outcome_name text not null,
  outcome_value numeric,
  outcome_label text,
  observed_at timestamptz not null,
  source_type text not null,
  source_id uuid not null,
  rules_version text not null,
  recorded_at timestamptz not null default now(),
  unique (judgment_table, judgment_key, outcome_name, rules_version)
);
create index judgment_outcomes_project on judgment_outcomes (project_id, judgment_table, outcome_name);

-- One row per Jev (TypeSafe) request: what it was asked, how many tokens it used and how long it took. `call_key`
-- makes a call that a retry could repeat idempotent (null for calls that cannot repeat).
create table classifier_calls (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  question text not null,
  question_version text,
  judgment_table text,
  judgment_ids uuid[] not null default '{}',
  call_key text,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  duration_ms integer,
  cost_usd numeric(12, 8) not null default 0,
  outcome text not null check (outcome in ('ok', 'error')),
  created_at timestamptz not null default now()
);
create unique index classifier_calls_key on classifier_calls (project_id, call_key) where call_key is not null;
create index classifier_calls_project on classifier_calls (project_id, created_at desc);

create function judgments_insert_only() returns trigger language plpgsql as $$
begin
  raise exception '% only admits INSERT (% rejected)', tg_table_name, tg_op using errcode = 'P0001';
end $$;
create trigger judgment_outcomes_no_update_or_delete before update or delete on judgment_outcomes
  for each row execute function judgments_insert_only();
create trigger judgment_outcomes_no_truncate before truncate on judgment_outcomes
  for each statement execute function judgments_insert_only();
create trigger classifier_calls_no_update_or_delete before update or delete on classifier_calls
  for each row execute function judgments_insert_only();
create trigger classifier_calls_no_truncate before truncate on classifier_calls
  for each statement execute function judgments_insert_only();
