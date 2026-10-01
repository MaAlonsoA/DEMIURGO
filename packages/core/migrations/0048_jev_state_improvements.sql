-- Jev's testability and layers opinions after the A/B audit of 01-10-2026. The tables stay append-only:
-- new rows carry the new shape and old rows keep theirs.
--
-- Testability: the policy no longer reads `can_check_in_ci`, and each criterion gets a Choice (what its
-- check needs) so the page can say which kind of problem it is.
alter table task_testability_opinions alter column can_check_in_ci drop not null;
alter table task_testability_opinions add column needs_kind text
  check (needs_kind in ('ci_automated', 'needs_production', 'needs_person', 'needs_unbuilt_part'));
-- Layers: only the schema question is asked now (a Score stored as score / 2); the other four layers are
-- no longer asked, so their columns accept null.
alter table task_layers_opinions alter column server_p drop not null;
alter table task_layers_opinions alter column ui_p drop not null;
alter table task_layers_opinions alter column tests_only_p drop not null;
alter table task_layers_opinions alter column deploy_p drop not null;
