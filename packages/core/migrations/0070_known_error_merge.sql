-- Merging a duplicate known error into another (known_error.merge): a new version of the source with status `merged`,
-- the code of the target and the reason. Insert-only stays true: nothing is edited or deleted, and reads follow the
-- chain from a merged code to the entry that stands for it.
alter table known_errors drop constraint known_errors_status_check;
alter table known_errors add constraint known_errors_status_check
  check (status in ('open', 'fix_claimed', 'validated', 'recurred', 'merged'));
alter table known_errors add column merged_into text check (merged_into ~ '^KE-[0-9]{3,}$');
alter table known_errors add column merge_note text;
alter table known_errors add constraint known_errors_merged_consistent
  check ((status = 'merged') = (merged_into is not null));
