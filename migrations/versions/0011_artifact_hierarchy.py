"""Attach decisions and designs to explorations and preserve new-line origins."""
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE records ADD COLUMN exploration_id TEXT REFERENCES explorations(id)")
    op.execute("ALTER TABLE explorations ADD COLUMN origin_record_id TEXT REFERENCES records(id)")
    op.execute("CREATE INDEX ix_records_exploration_kind ON records(exploration_id,kind)")
    op.execute("""UPDATE records SET exploration_id=(
        SELECT m.exploration_id FROM revisions v JOIN messages m ON v.origin_type='message' AND v.origin_id=m.id WHERE v.record_id=records.id ORDER BY v.version LIMIT 1
    ) WHERE exploration_id IS NULL""")
    op.execute("""UPDATE records SET exploration_id=(
        SELECT c.exploration_id FROM revisions v JOIN cards c ON v.origin_type='card' AND v.origin_id=c.id WHERE v.record_id=records.id ORDER BY v.version LIMIT 1
    ) WHERE exploration_id IS NULL""")
    op.execute("""UPDATE records SET exploration_id=(
        SELECT e.id FROM revisions v JOIN proposals p ON v.origin_type='proposal' AND v.origin_id=p.id JOIN proposal_batches b ON b.id=p.batch_id JOIN messages m ON b.source_type='message' AND b.source_id=m.id JOIN explorations e ON e.id=m.exploration_id WHERE v.record_id=records.id ORDER BY v.version LIMIT 1
    ) WHERE exploration_id IS NULL""")


def downgrade():
    op.execute("DROP INDEX ix_records_exploration_kind")
    with op.batch_alter_table("explorations") as batch:
        batch.drop_column("origin_record_id")
    with op.batch_alter_table("records") as batch:
        batch.drop_column("exploration_id")
