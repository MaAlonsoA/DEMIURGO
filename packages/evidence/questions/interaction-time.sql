-- ¿Cuánto tarda la respuesta y cuánto dura toda la actividad derivada? Una fila por interacción.
-- Las duraciones de comandos, pasos y modelo pueden estar anidadas: no son partes sumables del total.
-- Usage: pnpm evidence ask interaction-time --project <project id | all> --since <YYYY-MM-DD | all>
-- Every parameter is required; `all` lifts a filter.
select
  s.started_at,
  s.interaction_id,
  s.environment,
  s.thread_id,
  s.actor,
  s.root_command,
  round(s.total_ms::numeric) as elapsed_ms,
  round((case when s.channel in ('api', 'mcp') then s.api_ms end)::numeric) as response_ms,
  round(s.commands_ms::numeric) as commands_ms,
  round(s.steps_ms::numeric) as steps_ms,
  round(s.prepare_ms::numeric) as context_ms,
  round(s.provider_ms::numeric) as model_ms,
  round(s.apply_ms::numeric) as apply_ms,
  s.commands,
  s.runs,
  s.provider_calls as calls,
  s.errors,
  s.tokens_input as input,
  s.tokens_output as output
from v_interaction_summary s
where (:project = 'all' or s.project_id = uuid_or_null(:project))
  and (:since = 'all' or s.started_at >= nullif(:since, 'all')::timestamptz)
order by s.started_at desc;
