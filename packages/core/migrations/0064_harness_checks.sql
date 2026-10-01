-- Harness checks (salud-del-harness §8): the periodic, deterministic check of the harness. Each row is one run over a
-- window: the scorecards per piece, the new escapes, the regressions against the previous check and the «is it worth it?»
-- numbers. Append-only (pattern of `harness_postmortems`); `inputs_hash` makes the same inputs never write a second row.
create table harness_checks (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  window_from timestamptz not null,
  window_to timestamptz not null,
  previous_check_id uuid references harness_checks (id),
  rules_version text not null,
  harness_version_id uuid,
  trigger text not null check (trigger in ('schedule', 'merges', 'manual')),
  scorecards jsonb not null,
  escapes jsonb not null,
  regressions jsonb not null,
  worth jsonb not null,
  inputs_hash text not null,
  computed_at timestamptz not null default now(),
  unique (project_id, window_to, rules_version, inputs_hash)
);
create index harness_checks_project on harness_checks (project_id, computed_at desc);
create index harness_checks_hash on harness_checks (project_id, inputs_hash);

create trigger harness_checks_no_update_or_delete before update or delete on harness_checks
  for each row execute function harness_insert_only();
create trigger harness_checks_no_truncate before truncate on harness_checks
  for each statement execute function harness_insert_only();

-- Needs you: a check with regressions opens one issue of this kind (`source_key = 'harness_check:<id>'`).
alter table issues drop constraint issues_kind_check;
alter table issues add constraint issues_kind_check check (kind in ('bug', 'review_escalation', 'harness_regression'));
