from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings

engine = create_async_engine(
    settings.DATABASE_URL,
    echo=False,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,
    connect_args={
        "server_settings": {
            "search_path": f"{settings.DB_SCHEMA},public",
        }
    },
)

# Register pgvector type for asyncpg connections
@event.listens_for(engine.sync_engine, "connect")
def connect(dbapi_connection, connection_record):
    try:
        from pgvector.asyncpg import register_vector
        dbapi_connection.run_sync(register_vector)
    except Exception:
        pass  # pgvector not available yet (migration phase)


AsyncSessionLocal = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
