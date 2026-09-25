-- What exactly did this run's agent receive, and where did each piece come from? One row per
-- fragment of the run's context pack, in the order the builder weighed them: the section, the
-- authority entity it derives from (type, id, version and the journal event that created it), its
-- size before and after cutting, what the builder did with it and why, and its position in the
-- pack. Dropped fragments are listed too: that is what the agent did not get (spec §9.3).
-- Usage: pnpm evidence ask context-of-run --run <run id>
select
  f.seq,
  f.section,
  f.source_type,
  f.source_id,
  f.source_version as version,
  f.source_event_seq as event_seq,
  f.original_chars,
  f.chars,
  f.decision,
  f.reason,
  round(f.score::numeric, 3) as score,
  f.position,
  left(f.text_hash, 12) as text_hash,
  m.builder,
  left(m.pack_hash, 12) as pack
from runs r
join context_manifests m on m.pack_hash = r.pack_hash
join context_fragments f on f.pack_hash = m.pack_hash
where r.run_id = :run::uuid
order by f.seq;
