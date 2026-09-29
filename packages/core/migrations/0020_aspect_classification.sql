-- What Jev (TypeSafe) says each text is about (domain/aspects.ts), derived and replaceable: the
-- aspect of each message a person writes in a thread, and of each proposal's own text, to check the
-- one its agent chose. Only with the ADR that allows sending that text to TypeSafe approved.
alter table messages add column aspect text;
alter table messages add column aspect_confidence real;
alter table proposals add column aspect_check jsonb;
