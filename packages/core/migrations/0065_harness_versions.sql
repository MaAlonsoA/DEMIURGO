-- Harness versions (salud-del-harness §9.3): the marks of the harness at one moment (the DEMIURGO commit, the
-- fingerprints of its agents and skills, the versions of the questions put to Jev and the post-mortem rules
-- version), so what was built or run can be compared before and after a change. Append-only; one row per distinct
-- content hash (the API registers it at start, a second start with the same marks writes nothing).
create table harness_versions (
  id uuid primary key default uuidv7(),
  content_hash text not null unique,
  demiurgo_sha text not null,
  agents jsonb not null,
  skills jsonb not null,
  question_versions jsonb not null,
  rules_version text not null,
  first_seen_at timestamptz not null default now()
);
create index harness_versions_first_seen on harness_versions (first_seen_at);

create trigger harness_versions_no_update_or_delete before update or delete on harness_versions
  for each row execute function harness_insert_only();
create trigger harness_versions_no_truncate before truncate on harness_versions
  for each statement execute function harness_insert_only();

-- The version a run started under. Nullable: runs from before this migration have none. The nullable
-- `harness_version_id` columns of the other harness tables stay as they are.
alter table ai_runs add column harness_version_id uuid references harness_versions (id);
