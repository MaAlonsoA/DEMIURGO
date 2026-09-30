-- The design system (DSY): how the product looks and moves, one per project, versioned and approved
-- only by the person. Its machine-readable part (tokens, components, patterns) lives in the
-- version's `spec`, part of the immutable content.

alter table records drop constraint records_type_check;
alter table records add constraint records_type_check
  check (type in ('decision', 'epic', 'fdr', 'task', 'adr', 'bug', 'requirement', 'quality_requirement', 'threat_model', 'production_readiness', 'product_definition', 'design_system'));

create unique index records_one_design_system on records (project_id) where type = 'design_system';

alter table record_versions add column spec jsonb;

create or replace function record_versions_content_immutable() returns trigger language plpgsql as $$
begin
  if (new.project_id, new.record_id, new.n, new.title, new.sections, new.annexes, new.increment, new.change_note,
      new.origin, new.author, new.content_hash, new.created_at, new.practice_sources, new.spec)
     is distinct from
     (old.project_id, old.record_id, old.n, old.title, old.sections, old.annexes, old.increment, old.change_note,
      old.origin, old.author, old.content_hash, old.created_at, old.practice_sources, old.spec) then
    raise exception 'A version''s content is immutable; create a new version' using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- Its aspect is the product's (how it looks is part of what the product is); new records take it
-- from domain/aspects.ts.
update records set aspect = 'product' where type = 'design_system' and aspect is null;
