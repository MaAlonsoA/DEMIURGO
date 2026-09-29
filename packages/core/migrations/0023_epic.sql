-- The epic (EPC): a capability of the first version too big for one feature. It lists its features
-- in order, each FDR rests on it, and it grows by versions as features are added.

alter table records drop constraint records_type_check;
alter table records add constraint records_type_check
  check (type in ('decision', 'epic', 'fdr', 'adr', 'bug', 'requirement', 'quality_requirement', 'threat_model', 'production_readiness', 'product_definition'));
