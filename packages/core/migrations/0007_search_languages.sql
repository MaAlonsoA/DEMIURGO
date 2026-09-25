-- Knowledge search in the product's language, whether English or Spanish: the text is indexed as
-- written (simple) and stemmed in both languages, so a word matches its plural and its other forms.

drop index knowledge_nodes_search;
alter table knowledge_nodes drop column search;
alter table knowledge_nodes add column search tsvector generated always as (
  to_tsvector('simple', label || ' ' || body)
  || to_tsvector('english', label || ' ' || body)
  || to_tsvector('spanish', label || ' ' || body)
) stored;
create index knowledge_nodes_search on knowledge_nodes using gin (search);
