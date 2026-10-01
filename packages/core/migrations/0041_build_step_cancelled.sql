-- A withdrawn request stops its running build: the journal keeps a `cancelled` outcome for it.
alter table build_steps drop constraint build_steps_outcome_check;
alter table build_steps add constraint build_steps_outcome_check
  check (outcome in ('started', 'ok', 'failed', 'waiting', 'changes_requested', 'cancelled'));
