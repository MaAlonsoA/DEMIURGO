-- A cache miss does not prove that a resumed provider conversation was lost. Keep absent figures
-- unknown and report the source of a complete pair of input/cache-read figures.
create or replace view v_session_reuse as
with telemetry as (
  select
    call_id,
    sum(tokens_uncached_input)::bigint as uncached,
    sum(tokens_cache_read)::bigint as cache_read,
    sum(tokens_cache_write)::bigint as cache_write
  from cli_requests
  where call_id is not null
  group by call_id
),
figures as (
  select
    c.*,
    case when t.uncached is not null and t.cache_read is not null
      then t.uncached else c.tokens_uncached_input end as f_uncached,
    case when t.uncached is not null and t.cache_read is not null
      then t.cache_read else c.tokens_cache_read end as f_cache_read,
    case when t.uncached is not null and t.cache_read is not null
      then coalesce(t.cache_write, c.tokens_cache_write) else c.tokens_cache_write end as f_cache_write,
    case
      when t.uncached is null or t.cache_read is null then 'official'
      when t.cache_write is null and c.tokens_cache_write is not null then 'mixed'
      else 'telemetry'
    end as figures_source
  from provider_calls c
  left join telemetry t on t.call_id = c.call_id
)
select
  f.call_id, f.run_id, f.trace_id, f.provider, f.requested_model, f.agent,
  f.session_id, f.session_mode as mode, f.base_run_id, f.delta_hash, f.attempt,
  f.started_at, f.f_uncached as tokens_uncached_input,
  f.f_cache_read as tokens_cache_read, f.f_cache_write as tokens_cache_write,
  f.tokens_output,
  case
    when f.f_uncached is null or f.f_cache_read is null then null
    when f.f_uncached + f.f_cache_read + coalesce(f.f_cache_write, 0) = 0 then null
    else f.f_cache_read::double precision
      / (f.f_uncached + f.f_cache_read + coalesce(f.f_cache_write, 0))
  end as cache_ratio,
  case
    when f.session_mode is distinct from 'resumed' then 'none'
    when f.f_uncached is null or f.f_cache_read is null then 'unknown'
    when f.f_cache_read = 0 then 'no_cache'
    when f.f_cache_read::double precision
      / nullif(f.f_uncached + f.f_cache_read + coalesce(f.f_cache_write, 0), 0) >= 0.5
      then 'reused'
    else 'partial'
  end as verdict,
  f.figures_source
from figures f;
