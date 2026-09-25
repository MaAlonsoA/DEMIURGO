-- ¿Qué motor da más propuestas aceptadas sin edición por token gastado? Por proveedor, modelo,
-- effort, agente y versión: propuestas, aceptadas, aceptadas con edición y rechazadas, y cada una por
-- cada 1 000 tokens de salida (spec §15.3, vista v_engine_acceptance).
-- Usage: pnpm evidence ask engine-acceptance
-- No parameters: every call and every human evaluation of the evidence base counts.
select
  a.provider,
  a.requested_model as model,
  a.effort,
  a.agent,
  a.agent_version as version,
  a.runs,
  a.tokens_input as input,
  a.tokens_output as output,
  round(a.declared_cost_usd::numeric, 4) as cost_usd,
  a.proposals,
  a.accepted,
  a.accepted_edited,
  a.rejected,
  round(a.accepted_per_1k_output::numeric, 3) as accepted_per_1k,
  round(a.accepted_edited_per_1k_output::numeric, 3) as edited_per_1k,
  round(a.rejected_per_1k_output::numeric, 3) as rejected_per_1k,
  round(a.unedited_acceptance_rate::numeric, 3) as unedited_rate
from v_engine_acceptance a
order by a.accepted_per_1k_output desc nulls last, a.tokens_output desc;
