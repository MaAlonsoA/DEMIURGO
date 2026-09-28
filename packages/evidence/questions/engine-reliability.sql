-- ¿Qué falla, cuánto y en qué motor? Por proveedor, modelo, effort, agente y versión: llamadas y
-- fallos por tipo, planes B, reintentos y cómo valoraron las personas lo que
-- salió (spec §15.3, vista v_engine_reliability).
-- Usage: pnpm evidence ask engine-reliability
-- No parameters: every call of the evidence base counts.
select
  r.provider,
  r.requested_model as model,
  r.effort,
  r.agent,
  r.agent_version as version,
  r.calls,
  r.runs,
  r.failed_calls,
  r.failures,
  r.fallback_calls as plan_b,
  r.failed_runs,
  r.retry_runs,
  r.retried_runs,
  r.sessions_resumed as resumed,
  (select count(*) from v_session_reuse v join provider_calls c on c.call_id = v.call_id
    where c.provider is not distinct from r.provider and c.requested_model is not distinct from r.requested_model
      and c.effort is not distinct from r.effort and c.agent is not distinct from r.agent
      and c.agent_version is not distinct from r.agent_version and v.verdict = 'no_cache') as no_cache,
  (select count(*) from v_session_reuse v join provider_calls c on c.call_id = v.call_id
    where c.provider is not distinct from r.provider and c.requested_model is not distinct from r.requested_model
      and c.effort is not distinct from r.effort and c.agent is not distinct from r.agent
      and c.agent_version is not distinct from r.agent_version and v.verdict = 'unknown') as unknown_cache,
  r.sessions_partial as partial,
  r.accepted_unedited as accepted,
  r.accepted_edited,
  r.rejected,
  r.retried_same_engine + r.retried_other_engine as retried,
  round(r.avg_duration_ms::numeric) as avg_ms
from v_engine_reliability r
order by r.calls desc, r.provider, r.requested_model, r.effort, r.agent, r.agent_version;
