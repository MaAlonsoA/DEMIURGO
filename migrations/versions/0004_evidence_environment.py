"""Tie manual checks to an evaluated environment.

Revision ID: 0004
Revises: 0003
"""
from alembic import op

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

def upgrade():
    for column in ("environment","configuration","anomalies"):
        op.execute(f"ALTER TABLE evidence ADD COLUMN {column} TEXT NOT NULL DEFAULT ''")

def downgrade():
    with op.batch_alter_table("evidence") as batch:
        for column in ("environment","configuration","anomalies"):
            batch.drop_column(column)
