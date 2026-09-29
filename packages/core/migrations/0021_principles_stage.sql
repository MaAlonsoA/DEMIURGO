-- The onboarding's stage of architecture and security principles (domain/stages.ts): its answers
-- make a section of the product definition; the full architecture waits for the features.

alter table stages drop constraint stages_stage_check;
alter table stages
  add constraint stages_stage_check
  check (stage in ('requirements', 'quality', 'principles', 'architecture', 'security', 'production'));
