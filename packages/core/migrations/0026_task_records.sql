-- The task (TSK): a piece of the construction of a feature, with its own acceptance criteria. It rests
-- on its feature (based_on the FDR) and comes from the feature's thread or is written by hand.

alter table records drop constraint records_type_check;
alter table records add constraint records_type_check
  check (type in ('decision', 'epic', 'fdr', 'task', 'adr', 'bug', 'requirement', 'quality_requirement', 'threat_model', 'production_readiness', 'product_definition'));
