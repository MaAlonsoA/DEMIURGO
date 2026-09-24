"""Persist exploration rounds, observations, and isolated card threads."""
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

def upgrade():
    op.execute("ALTER TABLE cards ADD COLUMN round_id TEXT REFERENCES exploration_rounds(id)")
    op.execute("ALTER TABLE messages ADD COLUMN generated_for_message TEXT REFERENCES messages(id)")
    op.execute("CREATE UNIQUE INDEX uq_messages_generated_for ON messages(generated_for_message) WHERE generated_for_message IS NOT NULL")
    op.execute("CREATE TABLE exploration_rounds (id TEXT PRIMARY KEY, exploration_id TEXT NOT NULL REFERENCES explorations(id), source_message_id TEXT NOT NULL UNIQUE REFERENCES messages(id), status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL, closed_at TEXT)")
    # SQLite resolves the cards reference when the referenced table is created.
    op.execute("CREATE INDEX ix_rounds_exploration_status ON exploration_rounds(exploration_id,status)")
    op.execute("CREATE TABLE exploration_observations (id TEXT PRIMARY KEY, round_id TEXT NOT NULL REFERENCES exploration_rounds(id), source_message_id TEXT NOT NULL REFERENCES messages(id), kind TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(source_message_id,kind,content))")
    op.execute("CREATE INDEX ix_cards_round ON cards(round_id)")

def downgrade():
    op.execute("DROP TABLE exploration_observations")
    op.execute("DROP INDEX ix_cards_round")
    with op.batch_alter_table("cards") as batch:
        batch.drop_column("round_id")
    op.execute("DROP TABLE exploration_rounds")
    op.execute("DROP INDEX uq_messages_generated_for")
    with op.batch_alter_table("messages") as batch:
        batch.drop_column("generated_for_message")
