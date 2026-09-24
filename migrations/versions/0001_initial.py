"""Initial traceable workspace.

Revision ID: 0001
Revises:
"""
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.execute("CREATE TABLE sources (id TEXT PRIMARY KEY, name TEXT NOT NULL, digest TEXT NOT NULL UNIQUE, content TEXT NOT NULL, created_at TEXT NOT NULL)")
    op.execute("CREATE TABLE explorations (id TEXT PRIMARY KEY, title TEXT NOT NULL, parent_id TEXT REFERENCES explorations(id), source_id TEXT REFERENCES sources(id), created_at TEXT NOT NULL)")
    op.execute("CREATE TABLE cards (id TEXT PRIMARY KEY, exploration_id TEXT NOT NULL REFERENCES explorations(id), question TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', conclusion TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', origin_message_id TEXT, created_at TEXT NOT NULL)")
    op.execute("CREATE TABLE messages (id TEXT PRIMARY KEY, exploration_id TEXT NOT NULL REFERENCES explorations(id), card_id TEXT REFERENCES cards(id), role TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)")
    op.execute("CREATE TABLE records (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, current_revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL)")
    op.execute("CREATE TABLE revisions (record_id TEXT NOT NULL REFERENCES records(id), version INTEGER NOT NULL, body TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL, origin_type TEXT NOT NULL, origin_id TEXT, created_at TEXT NOT NULL, PRIMARY KEY(record_id,version))")
    op.execute("CREATE TABLE criteria (id TEXT PRIMARY KEY, body TEXT NOT NULL, record_id TEXT NOT NULL, record_version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, FOREIGN KEY(record_id,record_version) REFERENCES revisions(record_id,version))")
    op.execute("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', area TEXT NOT NULL DEFAULT '', domain TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)")
    op.execute("CREATE TABLE task_criteria (task_id TEXT NOT NULL REFERENCES tasks(id), criterion_id TEXT NOT NULL REFERENCES criteria(id), PRIMARY KEY(task_id,criterion_id))")
    op.execute("CREATE TABLE changesets (id TEXT PRIMARY KEY, title TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL)")
    op.execute("CREATE TABLE changeset_criteria (changeset_id TEXT NOT NULL REFERENCES changesets(id), criterion_id TEXT NOT NULL REFERENCES criteria(id), PRIMARY KEY(changeset_id,criterion_id))")
    op.execute("CREATE TABLE changeset_tasks (changeset_id TEXT NOT NULL REFERENCES changesets(id), task_id TEXT NOT NULL REFERENCES tasks(id), PRIMARY KEY(changeset_id,task_id))")
    op.execute("CREATE TABLE links (id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_id TEXT NOT NULL, source_version INTEGER, target_type TEXT NOT NULL, target_id TEXT NOT NULL, target_version INTEGER, relation TEXT NOT NULL, review_status TEXT NOT NULL DEFAULT 'current', created_at TEXT NOT NULL)")
    op.execute("CREATE TABLE evidence (id TEXT PRIMARY KEY, criterion_id TEXT NOT NULL REFERENCES criteria(id), task_id TEXT REFERENCES tasks(id), result_ref TEXT NOT NULL, method TEXT NOT NULL, outcome TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)")
    op.execute("CREATE TABLE proposal_batches (id TEXT PRIMARY KEY, source_type TEXT NOT NULL, source_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL)")
    op.execute("CREATE TABLE proposals (id TEXT PRIMARY KEY, batch_id TEXT NOT NULL REFERENCES proposal_batches(id), kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL)")
    op.execute("CREATE TABLE codex_runs (id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES messages(id), status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, finished_at TEXT)")
    op.execute("CREATE TABLE audit_events (id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, origin_type TEXT NOT NULL, origin_id TEXT, reason TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)")
    op.execute("CREATE VIRTUAL TABLE search_index USING fts5(entity_type UNINDEXED, entity_id UNINDEXED, title, body)")

def downgrade():
    for table in ('search_index','audit_events','codex_runs','proposals','proposal_batches','evidence','links','changeset_tasks','changeset_criteria','changesets','task_criteria','tasks','criteria','revisions','records','messages','cards','explorations','sources'):
        op.execute(f"DROP TABLE {table}")
