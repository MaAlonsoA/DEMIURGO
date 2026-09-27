#!/bin/bash
# Runs once, on the first start of the evidence postgres (docker-entrypoint-initdb.d), connected to
# demiurgo_evidence as the superuser `evidence`. The read-only role's password comes from the
# EVIDENCE_READER_PASSWORD variable that compose.yaml passes (from .env); never a fixed value.
set -euo pipefail
: "${EVIDENCE_READER_PASSWORD:?EVIDENCE_READER_PASSWORD must be set (compose.yaml, from .env)}"
psql -v ON_ERROR_STOP=1 -v reader_password="$EVIDENCE_READER_PASSWORD" \
     --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
-- Phoenix keeps its own database on this server.
CREATE DATABASE phoenix OWNER evidence;

-- Read-only role for the dashboards (Metabase) and for anyone asking questions by hand.
CREATE ROLE evidence_reader LOGIN PASSWORD :'reader_password';
GRANT CONNECT ON DATABASE demiurgo_evidence TO evidence_reader;
GRANT USAGE ON SCHEMA public TO evidence_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO evidence_reader;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO evidence_reader;
-- Tables the migrations create later (run as `evidence`), monthly partitions and views included.
ALTER DEFAULT PRIVILEGES FOR ROLE evidence IN SCHEMA public GRANT SELECT ON TABLES TO evidence_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE evidence IN SCHEMA public GRANT SELECT ON SEQUENCES TO evidence_reader;
SQL
