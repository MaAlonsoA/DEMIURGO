"""Add project workspaces and attach explorations to projects.

Revision ID: 0006
Revises: 0005
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    bind.exec_driver_sql(
        "CREATE TABLE IF NOT EXISTS projects ("
        "id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL)"
    )
    exploration_columns = {row[1] for row in bind.exec_driver_sql("PRAGMA table_info(explorations)")}
    if "project_id" not in exploration_columns:
        bind.exec_driver_sql(
            "ALTER TABLE explorations ADD COLUMN project_id TEXT REFERENCES projects(id)"
        )

    roots = bind.execute(sa.text(
        "SELECT id,title,created_at FROM explorations WHERE parent_id IS NULL"
    )).mappings().all()
    for root in roots:
        project_id = "project-legacy-" + root["id"]
        bind.execute(sa.text(
            "INSERT INTO projects(id,name,created_at) VALUES (:id,:name,:created_at)"
        ), {"id": project_id, "name": root["title"], "created_at": root["created_at"]})
        bind.execute(sa.text(
            "WITH RECURSIVE tree(id) AS ("
            "SELECT id FROM explorations WHERE id=:root "
            "UNION ALL SELECT e.id FROM explorations e JOIN tree t ON e.parent_id=t.id) "
            "UPDATE explorations SET project_id=:project "
            "WHERE id IN (SELECT id FROM tree)"
        ), {"root": root["id"], "project": project_id})

    bind.exec_driver_sql(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_explorations_initial_per_project "
        "ON explorations(project_id) WHERE parent_id IS NULL"
    )


def downgrade():
    op.drop_index("uq_explorations_initial_per_project", table_name="explorations")
    with op.batch_alter_table("explorations") as batch:
        batch.drop_column("project_id")
    op.drop_table("projects")
