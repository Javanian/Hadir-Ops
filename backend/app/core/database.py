"""
MongoDB connection.

One client per process (it pools connections). Datetimes come back as aware
UTC values (`tz_aware=True`), matching what the services compare against.
"""

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import settings

client: AsyncMongoClient = AsyncMongoClient(
    settings.MONGODB_URL,
    tz_aware=True,
    serverSelectionTimeoutMS=5000,
)


def get_database() -> AsyncDatabase:
    return client[settings.MONGODB_DB]


async def get_db():
    """FastAPI dependency: the application database."""
    yield get_database()
