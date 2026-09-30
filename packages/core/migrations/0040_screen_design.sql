-- The screen design (SCR) of a feature: its flow, each screen with its states and the design-system
-- components it uses. Based on its FDR version (a `based_on` link); the machine-readable part lives in
-- the version's `spec`, which already exists and is immutable.

alter table records drop constraint records_type_check;
alter table records add constraint records_type_check
  check (type in ('decision', 'epic', 'fdr', 'task', 'adr', 'bug', 'requirement', 'quality_requirement', 'threat_model', 'production_readiness', 'product_definition', 'design_system', 'screen_design'));

-- Like the design system, its aspect is the product's; new records take it from domain/aspects.ts.
update records set aspect = 'product' where type = 'screen_design' and aspect is null;
