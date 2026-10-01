-- The known-error vault: every error DEMIURGO itself has suffered is recorded once, with how it was fixed, and each
-- later task forensic confirms it did not come back (or says why it did) and records the new ones. Practice: the
-- Known Error Database of ITIL Problem Management (a known error is a problem with a documented root cause and
-- workaround or fix), regression testing of each fixed defect, and the classes of Orthogonal Defect Classification
-- (Chillarege et al., «Orthogonal Defect Classification: A Concept for In-Process Measurements», IEEE TSE 1992).
-- The entries are DEMIURGO's own defects, so they are global to the instance (not per project). Both tables are
-- append-only like task_forensics: a change of status or of fix is a new version row; the latest wins.
create table known_errors (
  id uuid primary key default uuidv7(),
  code text not null check (code ~ '^KE-[0-9]{3,}$'),
  version int not null check (version >= 1),
  title text not null,
  description text not null,
  error_class text not null,
  phase text not null,
  dimension text not null,
  -- How to recognise it in the evidence of a task.
  signature text not null,
  -- Ids of the forensics piece catalog (agent:…, stage:…, guard:…) the error lives in.
  pieces text[] not null default '{}',
  status text not null check (status in ('open', 'fix_claimed', 'validated', 'recurred')),
  -- {description, commits[], piece_versions{piece_id: version at fix time}, claimed_at}; null until a fix is claimed.
  fix jsonb,
  -- The project where it was first seen: its events hang from that project's journal.
  origin_project_id uuid not null references projects (id),
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (code, version)
);
create index known_errors_code on known_errors (code, version desc);

create table known_error_occurrences (
  id uuid primary key default uuidv7(),
  ke_code text not null check (ke_code ~ '^KE-[0-9]{3,}$'),
  project_id uuid not null references projects (id),
  task_id uuid not null references records (id),
  forensic_id uuid not null references task_forensics (id),
  -- Which item of the forensic's went_wrong this is.
  went_wrong_index int not null check (went_wrong_index >= 0),
  -- When it happened in the task (the item's own time, else the end of the task's activity).
  occurred_at timestamptz not null,
  -- The versions of the error's pieces the forensic's checklist marks recorded.
  piece_versions jsonb not null default '{}',
  -- The task ran with the fix of the entry in place (it happened after the fix was claimed).
  after_fix boolean not null,
  recurrence_why text,
  created_at timestamptz not null default now(),
  unique (ke_code, forensic_id, went_wrong_index)
);
create index known_error_occurrences_code on known_error_occurrences (ke_code, occurred_at);
create index known_error_occurrences_forensic on known_error_occurrences (forensic_id);

-- What a forensic needs to be judged against the vault: when the task's activity ended (a task that ran after a fix
-- claim counts as having run with the fix) and the build request that triggered an automatic analysis.
alter table task_forensics add column task_ended_at timestamptz;
alter table task_forensics add column trigger_request_id uuid references build_requests (id);

create trigger known_errors_no_update_or_delete before update or delete on known_errors
  for each row execute function queue_insert_only();
create trigger known_errors_no_truncate before truncate on known_errors
  for each statement execute function queue_insert_only();
create trigger known_error_occurrences_no_update_or_delete before update or delete on known_error_occurrences
  for each row execute function queue_insert_only();
create trigger known_error_occurrences_no_truncate before truncate on known_error_occurrences
  for each statement execute function queue_insert_only();
