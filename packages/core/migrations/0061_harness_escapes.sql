-- Harness escapes (salud-del-harness §4): what design did not see and building (or the person) found later. Phase
-- containment after the Motorola program (Daskalantonakis 1992; Kan, «Metrics and Models in Software Quality
-- Engineering», ch. 4): a problem found in the phase that introduced it is an error, one that escapes to a later phase
-- is a defect. The phase attributions are our convention, written in code under `rules_version`.
-- Append-only (same pattern as `harness_findings`): one row per (project, rules version, dedupe key); the dedupe key is
-- the rule plus the ids of the facts that prove it, so computing twice writes nothing.
create table harness_escapes (
  id uuid primary key default uuidv7(),
  project_id uuid not null references projects (id),
  rule text not null check (rule ~ '^E[0-9]{2}$'),
  introduced_phase text not null check (introduced_phase ~ '^P[0-9]{1,2}$'),
  found_phase text not null check (found_phase ~ '^P[0-9]{1,2}$'),
  record_code text,
  record_version_id uuid,
  criterion_code text,
  build_request_id uuid,
  pr_review_id uuid,
  comment_index integer,
  subject text,
  evidence jsonb not null,
  -- When the fact itself happened (the review, the new version, the event), to cut by window.
  occurred_at timestamptz,
  detected_at timestamptz not null default now(),
  rules_version text not null,
  dedupe_key text not null,
  unique (project_id, rules_version, dedupe_key)
);
create index harness_escapes_project on harness_escapes (project_id, rules_version, rule);
create index harness_escapes_request on harness_escapes (build_request_id) where build_request_id is not null;

create trigger harness_escapes_no_update_or_delete before update or delete on harness_escapes
  for each row execute function harness_insert_only();
create trigger harness_escapes_no_truncate before truncate on harness_escapes
  for each statement execute function harness_insert_only();
