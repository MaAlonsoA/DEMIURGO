-- Did this run resume a conversation session, from which base run, with what delta, and how much of
-- the input came back from the provider's cache? One row per provider call of the run and of the
-- runs it was resumed from, following `base_run_id` backwards (spec §10, §15.3).
-- Usage: pnpm evidence ask session-reuse --run <run id>
with recursive chain as (
  select r.run_id, 0 as depth
  from runs r
  where r.run_id = :run::uuid
  union all
  select r.run_id, chain.depth + 1
  from chain
  join runs base on base.run_id = chain.run_id
  join runs r on r.run_id = base.base_run_id
  where chain.depth < 50
)
select
  chain.depth,
  v.run_id,
  v.call_id,
  v.attempt,
  v.provider,
  v.requested_model as model,
  v.mode,
  v.base_run_id,
  left(v.delta_hash, 12) as delta,
  v.tokens_uncached_input as uncached,
  v.tokens_cache_read as cache_read,
  v.tokens_cache_write as cache_write,
  v.tokens_output as output,
  round(v.cache_ratio::numeric, 3) as cache_ratio,
  v.verdict,
  v.started_at
from chain
join v_session_reuse v on v.run_id = chain.run_id
order by chain.depth desc, v.started_at, v.attempt;
