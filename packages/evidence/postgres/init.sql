-- Runs once, on the first start of the evidence postgres (docker-entrypoint-initdb.d), connected to
-- demiurgo_evidence as the superuser `evidence`.

-- Phoenix (phase 4) keeps its own database on this server.
CREATE DATABASE phoenix OWNER evidence;

-- Read-only role for the dashboards (Metabase, phase 5) and for anyone asking questions by hand.
CREATE ROLE evidence_reader LOGIN PASSWORD 'evidence-reader';
GRANT CONNECT ON DATABASE demiurgo_evidence TO evidence_reader;
GRANT USAGE ON SCHEMA public TO evidence_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO evidence_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO evidence_reader;
-- Tables the migrations create later (run as `evidence`), monthly partitions and views included.
ALTER DEFAULT PRIVILEGES FOR ROLE evidence IN SCHEMA public GRANT SELECT ON TABLES TO evidence_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE evidence IN SCHEMA public GRANT SELECT ON SEQUENCES TO evidence_reader;
