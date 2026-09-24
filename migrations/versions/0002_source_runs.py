"""Track supervised source analysis.

Revision ID: 0002
Revises: 0001
"""
from alembic import op

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

def upgrade():
    op.execute("CREATE TABLE source_runs (id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id), status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, finished_at TEXT)")

def downgrade():
    op.execute("DROP TABLE source_runs")
