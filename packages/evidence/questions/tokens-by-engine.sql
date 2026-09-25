-- ¿Cuántos tokens y cuántas llamadas gasta cada motor, y qué parte del contexto viene de caché?
-- Por proveedor, modelo, effort, agente y versión desde una fecha (spec §15.3; el mismo agrupado
-- que v_tokens_by_engine, que no tiene fecha, calculado sobre provider_calls).
-- Usage: pnpm evidence ask tokens-by-engine --since <YYYY-MM-DD | all>
-- Every parameter is required; `all` lifts the date filter.
select
  c.provider,
  c.requested_model as model,
  c.effort,
  c.agent,
  c.agent_version as version,
  count(*) as calls,
  count(distinct c.run_id) as runs,
  count(*) filter (where c.state = 'failed' or c.failure_kind is not null) as failed,
  sum(c.tokens_uncached_input) as uncached,
  sum(c.tokens_cache_read) as cache_read,
  sum(c.tokens_cache_write) as cache_write,
  sum(c.tokens_output) as output,
  sum(c.tokens_reasoning) as reasoning,
  round(
    (sum(c.tokens_cache_read)::numeric
      / nullif(sum(coalesce(c.tokens_uncached_input, 0) + coalesce(c.tokens_cache_read, 0) + coalesce(c.tokens_cache_write, 0)), 0)),
    3
  ) as cache_ratio,
  round(sum(c.declared_cost_usd)::numeric, 4) as cost_usd,
  round(avg(c.duration_ms)::numeric) as avg_ms
from provider_calls c
where (:since = 'all' or c.started_at >= nullif(:since, 'all')::timestamptz)
group by c.provider, c.requested_model, c.effort, c.agent, c.agent_version
order by calls desc, c.provider, c.requested_model, c.effort, c.agent, c.agent_version;
