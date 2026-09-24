from alembic import context
from sqlalchemy import create_engine
from sqlalchemy.pool import NullPool
from app.db import DB_PATH

config = context.config
url = f"sqlite:///{DB_PATH.as_posix()}"

def run_migrations_offline():
    context.configure(url=url, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()

def run_migrations_online():
    engine = create_engine(url, poolclass=NullPool)
    with engine.begin() as connection:
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        context.configure(connection=connection)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
