-- Guided thread: a question is single or multiple choice, and it is shown in its thread only when
-- its turn comes (at most two open at a time); until then it waits hidden, in the reserve.
alter table questions add column multiple boolean not null default false;
alter table questions add column shown_at timestamptz;
update questions set shown_at = created_at;
create index questions_reserve_idx on questions (exploration_id) where shown_at is null;
