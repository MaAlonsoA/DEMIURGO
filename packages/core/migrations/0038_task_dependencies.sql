-- Task dependencies: a task is blocked by other tasks of its feature (Jira "is blocked by", Linear
-- "blocked by"). One `depends_on` link from the task's version to the task it waits for.
alter table links drop constraint links_type_check;
alter table links add constraint links_type_check
  check (type in ('based_on', 'design_of', 'covers', 'origin', 'conflicts_with', 'derived_from', 'depends_on'));
