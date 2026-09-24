-- Revision of S1: per-project integrity and closed versions (I4, I9). The database enforces
-- this even if a guard fails: a version belongs to its record's project, a criterion to its
-- version's project, and a link to its endpoints' project; and a version's criteria and links
-- can only be added while it is a draft (afterwards its content does not change).

create function version_of_project() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from records r where r.id = new.record_id and r.project_id = new.project_id) then
    raise exception 'The version and its record belong to different projects' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger record_versions_of_project before insert on record_versions
  for each row execute function version_of_project();

create function criterion_in_draft() returns trigger language plpgsql as $$
begin
  if not exists (
    select 1 from record_versions v
    where v.id = new.record_version_id and v.project_id = new.project_id and v.state = 'draft'
  ) then
    raise exception 'Criteria can only be added to a draft version of the same project' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger criteria_in_draft before insert on criteria
  for each row execute function criterion_in_draft();

create function link_in_draft() returns trigger language plpgsql as $$
begin
  if new.from_type = 'record_version' and not exists (
    select 1 from record_versions v where v.id = new.from_id and v.project_id = new.project_id and v.state = 'draft'
  ) then
    raise exception 'A version''s links are created with it, as a draft and in the same project' using errcode = 'P0001';
  end if;
  if new.to_type = 'record_version' and not exists (
    select 1 from record_versions v where v.id = new.to_id and v.project_id = new.project_id
  ) then
    raise exception 'The link target belongs to another project' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger links_in_draft before insert on links
  for each row execute function link_in_draft();
