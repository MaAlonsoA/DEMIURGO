-- The Behavior step (1-based) that a criterion of a feature checks; null for records without Behavior.
alter table criteria add column step integer check (step is null or step >= 1);
