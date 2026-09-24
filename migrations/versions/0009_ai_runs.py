"""Unify Codex executions and retain local trace data."""
from alembic import op

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""CREATE TABLE ai_runs (
        id TEXT PRIMARY KEY, trace_id TEXT NOT NULL, project_id TEXT REFERENCES projects(id),
        source_id TEXT REFERENCES sources(id), exploration_id TEXT REFERENCES explorations(id),
        card_id TEXT REFERENCES cards(id), message_id TEXT REFERENCES messages(id),
        attempt INTEGER NOT NULL, status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '',
        requested_model TEXT, observed_model TEXT, reasoning_effort TEXT,
        agent TEXT, agent_version TEXT, method_version TEXT,
        started_at TEXT NOT NULL, finished_at TEXT, prompt TEXT, result_json TEXT,
        context_ms INTEGER, invocation_ms INTEGER, validation_ms INTEGER, persistence_ms INTEGER,
        input_tokens INTEGER, cached_input_tokens INTEGER, output_tokens INTEGER,
        reasoning_output_tokens INTEGER, cli_invocations INTEGER,
        turns INTEGER, tool_calls INTEGER, model_calls INTEGER,
        usage_provenance TEXT NOT NULL DEFAULT '{}', traceparent TEXT,
        semconv_version TEXT NOT NULL DEFAULT 'genai-2026-09'
    )""")
    op.execute("CREATE INDEX ix_ai_runs_project ON ai_runs(project_id,started_at DESC)")
    op.execute("CREATE INDEX ix_ai_runs_source ON ai_runs(source_id,started_at DESC)")
    op.execute("CREATE INDEX ix_ai_runs_message ON ai_runs(message_id,attempt)")
    op.execute("CREATE TABLE ai_events (run_id TEXT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE, seq INTEGER NOT NULL, received_at TEXT NOT NULL, raw_json TEXT NOT NULL, PRIMARY KEY(run_id,seq))")
    op.execute("CREATE TABLE ai_spans (span_id TEXT PRIMARY KEY, run_id TEXT NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE, trace_id TEXT NOT NULL, parent_span_id TEXT, name TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT NOT NULL, attributes_json TEXT NOT NULL)")
    op.execute("""INSERT INTO ai_runs(id,trace_id,project_id,exploration_id,card_id,message_id,attempt,status,error,started_at,finished_at,usage_provenance)
        SELECT c.id,lower(hex(randomblob(16))),e.project_id,m.exploration_id,m.card_id,c.message_id,
        (SELECT count(*) FROM codex_runs prior WHERE prior.message_id=c.message_id AND (prior.started_at<c.started_at OR (prior.started_at=c.started_at AND prior.id<=c.id))),
        c.status,c.error,c.started_at,c.finished_at,'{"historical":"not_available"}'
        FROM codex_runs c JOIN messages m ON m.id=c.message_id JOIN explorations e ON e.id=m.exploration_id""")
    op.execute("""INSERT INTO ai_runs(id,trace_id,source_id,attempt,status,error,started_at,finished_at,usage_provenance)
        SELECT s.id,lower(hex(randomblob(16))),s.source_id,
        (SELECT count(*) FROM source_runs prior WHERE prior.source_id=s.source_id AND (prior.started_at<s.started_at OR (prior.started_at=s.started_at AND prior.id<=s.id))),
        s.status,s.error,s.started_at,s.finished_at,'{"historical":"not_available"}' FROM source_runs s""")
    op.execute("DROP TABLE codex_runs")
    op.execute("DROP TABLE source_runs")


def downgrade():
    op.execute("CREATE TABLE codex_runs (id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id), status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, finished_at TEXT)")
    op.execute("CREATE TABLE source_runs (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, finished_at TEXT)")
    op.execute("INSERT INTO codex_runs SELECT id,message_id,status,error,started_at,finished_at FROM ai_runs WHERE message_id IS NOT NULL")
    op.execute("INSERT INTO source_runs SELECT id,source_id,status,error,started_at,finished_at FROM ai_runs WHERE source_id IS NOT NULL")
    op.execute("DROP TABLE ai_spans")
    op.execute("DROP TABLE ai_events")
    op.execute("DROP TABLE ai_runs")
