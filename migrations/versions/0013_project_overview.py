"""Versioned editorial project summaries and unique card decisions."""
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

def upgrade():
    op.execute("CREATE TABLE project_summaries (id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), version INTEGER NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','accepted','superseded')), facts_hash TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(project_id,version))")
    op.execute("CREATE INDEX ix_project_summaries_project ON project_summaries(project_id,status,version)")

def downgrade():
    op.execute("DROP INDEX ix_project_summaries_project")
    op.execute("DROP TABLE project_summaries")
