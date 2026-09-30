-- GitHub flow for a build: a request goes requested -> in_review (the person pastes the PR URL) ->
-- done (the person, after the merge). Evidence keeps the PR URL and the test name as fields, not
-- only as a free note. All new columns are nullable.
alter table build_requests drop constraint build_requests_state_check;
alter table build_requests
  add constraint build_requests_state_check check (state in ('requested', 'in_review', 'done', 'withdrawn')),
  add column pr_url text,
  add column in_review_by text,
  add column in_review_at timestamptz,
  add column done_by text,
  add column done_at timestamptz;
-- An open request (requested or in review) is at most one per task.
drop index build_requests_one_open;
create unique index build_requests_one_open on build_requests (task_id) where state in ('requested', 'in_review');

alter table evidence
  add column pr_url text,
  add column test_name text;
