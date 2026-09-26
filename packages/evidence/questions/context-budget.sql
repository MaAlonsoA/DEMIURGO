-- ¿Cuánto presupuesto de contexto se llena y cuánto se descarta por sección? Por constructor y
-- sección: packs, presupuesto y caracteres que entraron (media por pack), proporción de llenado media
-- y máxima, y fragmentos incluidos, recortados, resumidos y descartados en total (spec §15.3, vista
-- v_context_budget). Una sección sin presupuesto declarado sale con la proporción vacía.
-- Usage: pnpm evidence ask context-budget --project <project id | all>
-- Every parameter is required; `all` lifts the project filter.
select
  b.builder,
  b.section,
  count(distinct b.pack_hash) as packs,
  round(avg(b.budget_chars)::numeric) as avg_budget_chars,
  round(avg(b.included_chars)::numeric) as avg_included_chars,
  round(avg(b.fill_ratio)::numeric, 3) as avg_fill_ratio,
  round(max(b.fill_ratio)::numeric, 3) as max_fill_ratio,
  sum(b.included_count) as included,
  sum(b.truncated_count) as truncated,
  sum(b.summarized_count) as summarized,
  sum(b.dropped_count) as dropped,
  count(*) filter (where b.dropped_count > 0) as packs_with_drops
from v_context_budget b
where (:project = 'all' or b.project_id = uuid_or_null(:project))
group by b.builder, b.section
order by b.builder, b.section;
