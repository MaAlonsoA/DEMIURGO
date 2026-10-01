-- Engine marks (salud-del-harness §9.3): which engine answered each call (provider, model asked and reported, CLI
-- version, Jev's model), so results of different engine versions are not mixed. Nullable jsonb: rows from before this
-- migration have none. The builder steps carry the same mark in their `detail` (no column).
alter table ai_runs add column engine jsonb;
alter table classifier_calls add column engine jsonb;
