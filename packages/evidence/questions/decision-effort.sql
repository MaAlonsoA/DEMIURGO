-- ¿Cuánto cuesta una decisión aprobada, en tokens, en dinero declarado, en tiempo de persona y en
-- ejecuciones? Una fila por propuesta aceptada, con el esfuerzo de su hilo desde la primera
-- interacción hasta la aceptación (spec §15.3, vista v_decision_effort).
-- Usage: pnpm evidence ask decision-effort --project <project id | all>
-- Every parameter is required; `all` lifts the project filter.
select
  d.accepted_at,
  d.project_id,
  d.thread_id,
  d.proposal_id,
  d.run_id,
  d.accepted_by,
  d.edited,
  d.interactions,
  d.person_interventions as interventions,
  d.questions_raised as questions,
  d.questions_answered as answered,
  d.questions_pending as pending,
  round(d.time_to_accept_ms::numeric / 1000, 1) as seconds_to_accept,
  d.runs,
  d.provider_calls as calls,
  d.tokens_uncached_input as uncached,
  d.tokens_cache_read as cache_read,
  d.tokens_cache_write as cache_write,
  d.tokens_output as output,
  round(d.declared_cost_usd::numeric, 4) as cost_usd
from v_decision_effort d
where (:project = 'all' or d.project_id = uuid_or_null(:project))
order by d.accepted_at desc;
