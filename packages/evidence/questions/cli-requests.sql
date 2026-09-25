-- What did the CLI do under each call of this run? One row per API request Claude Code or Codex
-- reported (§13): attempt, model, time, tokens per class as the CLI counted them, cost and status,
-- under the call it belongs to. Compare with the call's official usage in v_cli_requests_by_call.
-- Usage: pnpm evidence ask cli-requests --run <run id>
select
  c.call_id,
  c.attempt as call_attempt,
  c.provider,
  r.source,
  r.attributes->>'event.name' as event,
  r.attempt,
  r.request_id,
  r.model,
  r.at,
  r.duration_ms,
  r.ttft_ms,
  r.stop_reason,
  r.tokens_uncached_input as uncached,
  r.tokens_cache_read as cache_read,
  r.tokens_cache_write as cache_write,
  r.tokens_output as output,
  r.tokens_reasoning as reasoning,
  r.cost_usd,
  r.error_status
from provider_calls c
join cli_requests r on r.call_id = c.call_id
where c.run_id = :run::uuid
order by c.started_at, c.attempt, r.at;
