"""Correlate round reviews with their Codex executions."""
from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE ai_runs ADD COLUMN round_id TEXT REFERENCES exploration_rounds(id)")
    op.execute("CREATE INDEX ix_ai_runs_round ON ai_runs(round_id,started_at DESC)")


def downgrade():
    op.execute("DROP INDEX ix_ai_runs_round")
    with op.batch_alter_table("ai_runs") as batch:
        batch.drop_column("round_id")
