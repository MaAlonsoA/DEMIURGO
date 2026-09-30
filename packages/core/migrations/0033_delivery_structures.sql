-- A criterion written as Given/When/Then keeps its three parts; `statement` stays the composed sentence.
alter table criteria add column given_text text, add column when_text text, add column then_text text;
-- The practice sources (list of {title, url, used_for}, unverified) a version was based on.
alter table record_versions add column practice_sources jsonb;
-- Evidence result; null means pass (older manual evidence).
alter table evidence add column result text check (result in ('pass', 'fail'));
-- The practice sources are part of a version's content: immutable like the rest.
create or replace function record_versions_content_immutable() returns trigger language plpgsql as $$
begin
  if (new.project_id, new.record_id, new.n, new.title, new.sections, new.annexes, new.increment, new.change_note,
      new.origin, new.author, new.content_hash, new.created_at, new.practice_sources)
     is distinct from
     (old.project_id, old.record_id, old.n, old.title, old.sections, old.annexes, old.increment, old.change_note,
      old.origin, old.author, old.content_hash, old.created_at, old.practice_sources) then
    raise exception 'A version''s content is immutable; create a new version' using errcode = 'P0001';
  end if;
  return new;
end
$$;
