-- «Build the queue» can build several independent tasks at once: the number the person allows (1 to 3,
-- our convention: few parallel branches keep merge conflicts rare). 1 is the behaviour so far.

alter table build_queue_settings
  add column parallel integer not null default 1 check (parallel between 1 and 3);
