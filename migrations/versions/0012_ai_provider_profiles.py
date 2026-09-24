"""Add per-action AI profiles and task-level model overrides."""
from alembic import op


revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE ai_runs ADD COLUMN provider TEXT NOT NULL DEFAULT 'codex'")
    op.execute("ALTER TABLE ai_runs ADD COLUMN requested_base_url TEXT NOT NULL DEFAULT ''")
    op.execute("""CREATE TABLE ai_action_profiles (
        action_key TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        reasoning_effort TEXT NOT NULL,
        base_url TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL
    )""")
    op.execute("""CREATE TABLE ai_task_overrides (
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        reasoning_effort TEXT NOT NULL,
        base_url TEXT NOT NULL DEFAULT '',
        updated_at TEXT NOT NULL,
        PRIMARY KEY(scope_type, scope_id)
    )""")
    op.execute("""INSERT INTO ai_action_profiles(action_key,provider,model,reasoning_effort,base_url,updated_at) VALUES
        ('exploration_initial','codex','gpt-6-sol','high','',CURRENT_TIMESTAMP),
        ('exploration_chat','codex','gpt-6-luna','medium','',CURRENT_TIMESTAMP),
        ('question_response','codex','gpt-6-sol','high','',CURRENT_TIMESTAMP),
        ('round_review','codex','gpt-6-sol','high','',CURRENT_TIMESTAMP),
        ('source_analysis','codex','gpt-6-sol','high','',CURRENT_TIMESTAMP),
        ('categorization','codex','gpt-6-luna','medium','',CURRENT_TIMESTAMP)""")


def downgrade():
    op.execute("DROP TABLE ai_task_overrides")
    op.execute("DROP TABLE ai_action_profiles")
    with op.batch_alter_table("ai_runs") as batch:
        batch.drop_column("requested_base_url")
        batch.drop_column("provider")
