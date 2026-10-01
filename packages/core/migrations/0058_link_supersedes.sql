-- A later task supersedes an earlier one that is already built and merged: one `supersedes` link from the
-- later task's version to the earlier task's version, with the point it supersedes. The ADR convention
-- «Superseded by» (Michael Nygard, «Documenting Architecture Decisions», 2011) applied to work items
-- (convención nuestra).
alter table links drop constraint links_type_check;
alter table links add constraint links_type_check
  check (type in ('based_on', 'design_of', 'covers', 'origin', 'conflicts_with', 'derived_from', 'depends_on', 'supersedes'));
alter table links add column note text;

-- A version's links are created with it as a draft (0004), except `supersedes`: it is written later, from the
-- already approved version of the later task, when knowledge finds that it supersedes a built one.
create or replace function link_in_draft() returns trigger language plpgsql as $$
begin
  if new.type <> 'supersedes' and new.from_type = 'record_version' and not exists (
    select 1 from record_versions v where v.id = new.from_id and v.project_id = new.project_id and v.state = 'draft'
  ) then
    raise exception 'A version''s links are created with it, as a draft and in the same project' using errcode = 'P0001';
  end if;
  if new.type = 'supersedes' and new.from_type = 'record_version' and not exists (
    select 1 from record_versions v where v.id = new.from_id and v.project_id = new.project_id
  ) then
    raise exception 'The superseding task belongs to another project' using errcode = 'P0001';
  end if;
  if new.to_type = 'record_version' and not exists (
    select 1 from record_versions v where v.id = new.to_id and v.project_id = new.project_id
  ) then
    raise exception 'The link target belongs to another project' using errcode = 'P0001';
  end if;
  return new;
end $$;
