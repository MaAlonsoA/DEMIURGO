-- Phase 4 (spec §13, §17): the native telemetry of the CLIs next to the official usage of each call.
-- The official usage still comes from each engine's own output (ADR-AGE-001); what Claude Code and
-- Codex report per API request is kept in `cli_requests` and compared here.

-- Per call: the API requests the CLI reported under it (count, attempts, times, tokens per class,
-- cost), the official figures of the call, and the difference telemetry − official.
create view v_cli_requests_by_call as
with t as (
  select
    r.call_id,
    min(r.source) as source,
    count(*) filter (where r.attributes->>'event.name' in ('claude_code.api_request', 'codex.api_request')) as requests,
    count(*) filter (where r.error_status is not null and r.error_status !~ '^2') as errors,
    max(r.attempt) as max_attempt,
    min(r.at) as first_request_at,
    max(r.at) as last_request_at,
    -- Only the request events: Codex's sse_event repeats the time of its request.
    sum(r.duration_ms) filter (where r.attributes->>'event.name' in ('claude_code.api_request', 'codex.api_request')) as duration_ms,
    sum(r.tokens_uncached_input)::bigint as tokens_uncached_input,
    sum(r.tokens_cache_read)::bigint as tokens_cache_read,
    sum(r.tokens_cache_write)::bigint as tokens_cache_write,
    sum(r.tokens_output)::bigint as tokens_output,
    sum(r.tokens_reasoning)::bigint as tokens_reasoning,
    sum(r.cost_usd) as cost_usd
  from cli_requests r
  where r.call_id is not null
  group by r.call_id
)
select
  c.call_id,
  c.run_id,
  c.trace_id,
  c.provider,
  c.requested_model,
  c.agent,
  c.attempt as call_attempt,
  c.started_at,
  t.source,
  coalesce(t.requests, 0) as requests,
  coalesce(t.errors, 0) as errors,
  t.max_attempt,
  t.first_request_at,
  t.last_request_at,
  t.duration_ms as telemetry_duration_ms,
  t.tokens_uncached_input as telemetry_uncached_input,
  t.tokens_cache_read as telemetry_cache_read,
  t.tokens_cache_write as telemetry_cache_write,
  t.tokens_output as telemetry_output,
  t.tokens_reasoning as telemetry_reasoning,
  t.cost_usd as telemetry_cost_usd,
  c.duration_api_ms as official_duration_api_ms,
  c.tokens_uncached_input as official_uncached_input,
  c.tokens_cache_read as official_cache_read,
  c.tokens_cache_write as official_cache_write,
  c.tokens_output as official_output,
  c.tokens_reasoning as official_reasoning,
  c.declared_cost_usd as official_cost_usd,
  t.tokens_uncached_input - c.tokens_uncached_input as delta_uncached,
  t.tokens_cache_read - c.tokens_cache_read as delta_cache_read,
  t.tokens_cache_write - c.tokens_cache_write as delta_cache_write,
  t.tokens_output - c.tokens_output as delta_output
from provider_calls c
left join t on t.call_id = c.call_id;

-- v_session_reuse stops estimating (§13): when the CLI reported its requests, the cache figures per
-- request replace the call's own; otherwise the call's figures stay. Same columns as in 0001 (a view
-- can only be replaced with its columns kept, in order), plus `figures_source` at the end.
create or replace view v_session_reuse as
with t as (
  select
    r.call_id,
    sum(r.tokens_uncached_input)::bigint as tokens_uncached_input,
    sum(r.tokens_cache_read)::bigint as tokens_cache_read,
    sum(r.tokens_cache_write)::bigint as tokens_cache_write
  from cli_requests r
  where r.call_id is not null
  group by r.call_id
),
f as (
  select
    c.*,
    coalesce(t.tokens_uncached_input, c.tokens_uncached_input) as f_uncached,
    coalesce(t.tokens_cache_read, c.tokens_cache_read) as f_cache_read,
    coalesce(t.tokens_cache_write, c.tokens_cache_write) as f_cache_write,
    case when t.tokens_cache_read is not null then 'telemetry' else 'official' end as figures_source
  from provider_calls c
  left join t on t.call_id = c.call_id
)
select
  f.call_id,
  f.run_id,
  f.trace_id,
  f.provider,
  f.requested_model,
  f.agent,
  f.session_id,
  f.session_mode as mode,
  f.base_run_id,
  f.delta_hash,
  f.attempt,
  f.started_at,
  f.f_uncached as tokens_uncached_input,
  f.f_cache_read as tokens_cache_read,
  f.f_cache_write as tokens_cache_write,
  f.tokens_output,
  case
    when coalesce(f.f_uncached, 0) + coalesce(f.f_cache_read, 0) + coalesce(f.f_cache_write, 0) = 0
      then null
    else f.f_cache_read::double precision
      / (coalesce(f.f_uncached, 0) + coalesce(f.f_cache_read, 0) + coalesce(f.f_cache_write, 0))
  end as cache_ratio,
  case
    when f.session_mode is distinct from 'resumed' then 'none'
    when coalesce(f.f_cache_read, 0) = 0 then 'lost'
    when f.f_cache_read::double precision
      / (coalesce(f.f_uncached, 0) + coalesce(f.f_cache_read, 0) + coalesce(f.f_cache_write, 0)) >= 0.5
      then 'reused'
    else 'partial'
  end as verdict,
  f.figures_source
from f;

-- The read-only role exists in the evidence container (postgres/init.sql), not in the test bases.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'evidence_reader') then
    grant select on all tables in schema public to evidence_reader;
  end if;
end
$$;
