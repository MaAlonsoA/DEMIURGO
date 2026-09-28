-- The product definition (DEF): one record per project, composed by the system from the product
-- definition stage's confirmed answers; its changes are versions of the same record. And the
-- evidence of an inference: the exact words of the person it rests on, each with its message.

alter table records drop constraint records_type_check;
alter table records add constraint records_type_check
  check (type in ('decision', 'fdr', 'adr', 'bug', 'requirement', 'quality_requirement', 'threat_model', 'production_readiness', 'product_definition'));

create unique index records_one_product_definition on records (project_id) where type = 'product_definition';

alter table questions add column evidence jsonb not null default '[]';
