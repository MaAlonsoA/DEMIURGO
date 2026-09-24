"""Change Set scope and provenance fields.

Revision ID: 0003
Revises: 0002
"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

def upgrade():
    for column in ("reason","included","excluded","dependencies"):
        op.execute(f"ALTER TABLE changesets ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")

def downgrade():
    with op.batch_alter_table("changesets") as batch:
        for column in ("reason","included","excluded","dependencies"):
            batch.drop_column(column)
