-- ¿Cuántas intervenciones pide cada hilo y cuántas preguntas quedan sin responder? Una fila por
-- hilo: interacciones de personas y del sistema, comandos por tipo de actor, preguntas planteadas,
-- respondidas y abiertas ahora, y decisiones aceptadas y rechazadas (spec §15.3, vista v_interventions).
-- Una interacción sin hilo conocido aparece agrupada bajo el hilo vacío.
-- Usage: pnpm evidence ask interventions --project <project id | all>
-- Every parameter is required; `all` lifts the project filter.
select
  v.project_id,
  v.thread_id,
  min(v.started_at) as first_at,
  max(v.last_seen_at) as last_at,
  count(*) as interactions,
  count(*) filter (where v.actor_type = 'human') as person_interactions,
  count(*) filter (where v.actor_type <> 'human') as other_interactions,
  sum(v.person_commands) as person_commands,
  sum(v.agent_commands) as agent_commands,
  sum(v.system_commands) as system_commands,
  sum(v.failed_commands) as failed_commands,
  sum(v.questions_raised) as questions,
  sum(v.questions_answered) as answered,
  coalesce((select count(*) from v_question_status q where q.thread_id = v.thread_id and q.pending), 0) as pending_now,
  sum(v.proposals_accepted) as accepted,
  sum(v.proposals_rejected) as rejected
from v_interventions v
where (:project = 'all' or v.project_id = uuid_or_null(:project))
group by v.project_id, v.thread_id
order by first_at desc;
