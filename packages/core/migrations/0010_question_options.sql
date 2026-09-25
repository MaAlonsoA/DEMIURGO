-- Predefined answers for a question, proposed by the agent: the person picks one or writes their own.
alter table questions add column options jsonb not null default '[]'::jsonb;
