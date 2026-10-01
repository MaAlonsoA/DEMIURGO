-- Every domain table carries project_id (AC-ESQ-001-17). 0052 created build_request_bases without it:
-- add it, backfill it from the request, and make it mandatory. The append-only trigger is disabled only
-- around the backfill, inside this migration's transaction.
alter table build_request_bases add column project_id uuid references projects (id);
alter table build_request_bases disable trigger build_request_bases_append_only;
update build_request_bases b set project_id = r.project_id from build_requests r where r.id = b.build_request_id;
alter table build_request_bases enable trigger build_request_bases_append_only;
alter table build_request_bases alter column project_id set not null;
create index build_request_bases_project on build_request_bases (project_id, adopted_at);
