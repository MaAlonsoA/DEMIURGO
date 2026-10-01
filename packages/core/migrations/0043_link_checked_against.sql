-- Deterministic impact («suspect links»): when what a record rests on gets a newer approved version, the
-- record is suspect until the person says it still holds. «Still valid» (link.revalidate) records the
-- upstream version the link was last confirmed against; nothing else about the link changes.
alter table links add column checked_against integer;
