-- How did the context change between two runs? The fragments that are in only one of the two
-- packs, and those in both whose decision or text changed: a message that fell out of the budget,
-- a decision that moved to a new version, a knowledge node that stopped being relevant. Fragments
-- are matched by section and origin (type and id). `difference` says which side has it or what
-- differs (spec §9.3).
-- Usage: pnpm evidence ask context-diff --run_a <run id> --run_b <run id>
with a as (
  select f.*
  from runs r
  join context_fragments f on f.pack_hash = r.pack_hash
  where r.run_id = :run_a::uuid
),
b as (
  select f.*
  from runs r
  join context_fragments f on f.pack_hash = r.pack_hash
  where r.run_id = :run_b::uuid
)
select
  coalesce(a.section, b.section) as section,
  coalesce(a.source_type, b.source_type) as source_type,
  coalesce(a.source_id, b.source_id) as source_id,
  case
    when b.pack_hash is null then 'only_a'
    when a.pack_hash is null then 'only_b'
    when a.decision is distinct from b.decision then 'decision'
    else 'text'
  end as difference,
  a.source_version as version_a,
  b.source_version as version_b,
  a.decision as decision_a,
  b.decision as decision_b,
  a.reason as reason_a,
  b.reason as reason_b,
  a.chars as chars_a,
  b.chars as chars_b,
  left(a.text_hash, 12) as text_a,
  left(b.text_hash, 12) as text_b
from a
full outer join b
  on a.section = b.section and a.source_type = b.source_type and a.source_id = b.source_id
where a.pack_hash is null
   or b.pack_hash is null
   or a.decision is distinct from b.decision
   or a.text_hash is distinct from b.text_hash
order by section, source_type, source_id;
