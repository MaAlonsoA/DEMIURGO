"""Require every exploration to belong to a project.

Revision ID: 0007
Revises: 0006
"""
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(
        "CREATE TRIGGER IF NOT EXISTS explorations_project_insert "
        "BEFORE INSERT ON explorations "
        "WHEN NEW.project_id IS NULL OR NOT EXISTS "
        "(SELECT 1 FROM projects WHERE id=NEW.project_id) "
        "BEGIN SELECT RAISE(ABORT, 'exploration requires an existing project'); END"
    )
    op.execute(
        "CREATE TRIGGER IF NOT EXISTS explorations_project_update "
        "BEFORE UPDATE OF project_id ON explorations "
        "WHEN NEW.project_id IS NULL OR NOT EXISTS "
        "(SELECT 1 FROM projects WHERE id=NEW.project_id) "
        "BEGIN SELECT RAISE(ABORT, 'exploration requires an existing project'); END"
    )


def downgrade():
    op.execute("DROP TRIGGER IF EXISTS explorations_project_update")
    op.execute("DROP TRIGGER IF EXISTS explorations_project_insert")
