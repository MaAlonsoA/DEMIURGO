-- Attention measurement (salud-del-harness §6.7): when a person first saw a batch, and which confirmed
-- answers a drafted version used.
alter table proposal_batches add column shown_at timestamptz;

create table version_answers (
  record_version_id uuid not null references record_versions (id),
  question_id uuid not null references questions (id),
  project_id uuid not null references projects (id),
  created_at timestamptz not null default now(),
  primary key (record_version_id, question_id)
);
create index version_answers_question on version_answers (question_id);

create function version_answers_insert_only() returns trigger language plpgsql as $$
begin
  raise exception '% only admits INSERT (% rejected)', tg_table_name, tg_op using errcode = 'P0001';
end $$;
create trigger version_answers_no_update_or_delete before update or delete on version_answers
  for each row execute function version_answers_insert_only();
create trigger version_answers_no_truncate before truncate on version_answers
  for each statement execute function version_answers_insert_only();
