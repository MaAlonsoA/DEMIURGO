-- ¿Qué porcentaje del contexto se reutiliza de caché por proveedor y qué sesiones se pierden? Por
-- proveedor y modelo desde una fecha: llamadas, tokens sin caché, leídos y escritos de caché, la
-- proporción de caché, y de las llamadas que reanudaron una sesión cuántas la encontraron entera,
-- a medias o perdida (spec §15.3, vista v_session_reuse; con las cifras por petición de las CLI
-- cuando las hay, `with_cli_figures`).
-- Usage: pnpm evidence ask cache-by-provider --since <YYYY-MM-DD | all>
-- Every parameter is required; `all` lifts the date filter.
select
  v.provider,
  v.requested_model as model,
  count(*) as calls,
  count(distinct v.run_id) as runs,
  sum(v.tokens_uncached_input) as uncached,
  sum(v.tokens_cache_read) as cache_read,
  sum(v.tokens_cache_write) as cache_write,
  round(
    (sum(v.tokens_cache_read)::numeric
      / nullif(sum(coalesce(v.tokens_uncached_input, 0) + coalesce(v.tokens_cache_read, 0) + coalesce(v.tokens_cache_write, 0)), 0)),
    3
  ) as cache_ratio,
  count(*) filter (where v.mode = 'resumed') as resumed,
  count(*) filter (where v.verdict = 'reused') as reused,
  count(*) filter (where v.verdict = 'partial') as partial,
  count(*) filter (where v.verdict = 'lost') as lost,
  count(*) filter (where v.figures_source = 'telemetry') as with_cli_figures
from v_session_reuse v
where (:since = 'all' or v.started_at >= nullif(:since, 'all')::timestamptz)
group by v.provider, v.requested_model
order by calls desc, v.provider, v.requested_model;
