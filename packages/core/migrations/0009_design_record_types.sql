-- Design-stage record types: requirement, quality requirement, threat model and production readiness.

alter table records drop constraint records_type_check;
alter table records add constraint records_type_check
  check (type in ('decision', 'fdr', 'adr', 'bug', 'requirement', 'quality_requirement', 'threat_model', 'production_readiness'));
