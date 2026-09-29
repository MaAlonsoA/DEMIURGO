-- The aspect of the product a record is about (domain/aspects.ts): one fixed tag the person reads
-- next to the noun. The typed records take it from their type; decisions and bugs from their
-- content (the agent that proposes them, or the classifier), so they may start without one.
alter table records add column aspect text
  check (aspect in ('product', 'feature', 'quality', 'architecture', 'security', 'operations', 'other'));
update records set aspect = case type
  when 'product_definition' then 'product'
  when 'fdr' then 'feature'
  when 'requirement' then 'feature'
  when 'quality_requirement' then 'quality'
  when 'adr' then 'architecture'
  when 'threat_model' then 'security'
  when 'production_readiness' then 'operations'
end;
