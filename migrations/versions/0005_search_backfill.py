"""Include exploration and conversation text in search.

Revision ID: 0005
Revises: 0004
"""
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

def upgrade():
    op.execute("INSERT INTO search_index SELECT 'source',s.id,s.name,s.content FROM sources s WHERE NOT EXISTS (SELECT 1 FROM search_index i WHERE i.entity_type='source' AND i.entity_id=s.id)")
    op.execute("INSERT INTO search_index SELECT 'exploration',e.id,e.title,'' FROM explorations e WHERE NOT EXISTS (SELECT 1 FROM search_index i WHERE i.entity_type='exploration' AND i.entity_id=e.id)")
    op.execute("INSERT INTO search_index SELECT 'card',c.id,c.question,c.reason||' '||c.conclusion FROM cards c WHERE NOT EXISTS (SELECT 1 FROM search_index i WHERE i.entity_type='card' AND i.entity_id=c.id)")
    op.execute("INSERT INTO search_index SELECT 'message',m.id,'Conversación',m.body FROM messages m WHERE NOT EXISTS (SELECT 1 FROM search_index i WHERE i.entity_type='message' AND i.entity_id=m.id)")

def downgrade():
    op.execute("DELETE FROM search_index WHERE entity_type IN ('source','exploration','card','message')")
