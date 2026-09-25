-- Phase 3 (spec §9.3, §10): how much of each section's budget a pack filled, and what fell out.

-- Per pack and section: the budget the builder declared for it (null when the section has none),
-- the characters of what entered (included, truncated or summarized), how many fragments entered
-- whole or cut, and how many were dropped. `candidates` is the pack's total.
create view v_context_budget as
select
  m.pack_hash,
  m.pack_id,
  m.project_id,
  m.builder,
  m.role,
  m.graph_version,
  m.candidates,
  f.section,
  (m.budget ->> f.section)::integer as budget_chars,
  coalesce(sum(f.chars) filter (where f.decision <> 'dropped'), 0)::integer as included_chars,
  count(*) filter (where f.decision = 'included') as included_count,
  count(*) filter (where f.decision = 'truncated') as truncated_count,
  count(*) filter (where f.decision = 'summarized') as summarized_count,
  count(*) filter (where f.decision = 'dropped') as dropped_count,
  case
    when coalesce((m.budget ->> f.section)::integer, 0) = 0 then null
    else coalesce(sum(f.chars) filter (where f.decision <> 'dropped'), 0)::double precision
      / (m.budget ->> f.section)::integer
  end as fill_ratio,
  m.built_at
from context_manifests m
join context_fragments f on f.pack_hash = m.pack_hash
group by m.pack_hash, m.pack_id, m.project_id, m.builder, m.role, m.graph_version, m.candidates, m.budget, m.built_at, f.section;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'evidence_reader') then
    grant select on v_context_budget to evidence_reader;
  end if;
end
$$;
