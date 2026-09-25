-- Where the answer to a person's message stands: waiting for knowledge, requested (with the run
-- that answers it) or abandoned. Null when the message asked for no answer. The web reads it
-- instead of guessing from the time.

alter table messages
  add column response text check (response in ('waiting', 'requested', 'abandoned')),
  add column response_run uuid references ai_runs (id);
