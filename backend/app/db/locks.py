"""
Lease locks: one holder at a time across processes and containers.

A lease expires on its own, so a worker that crashes mid-pass cannot block the
next one forever (the old Postgres advisory lock was tied to a connection).
"""

from datetime import datetime, timedelta, timezone

from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import DuplicateKeyError


async def acquire(db: AsyncDatabase, name: str, owner: str, ttl_seconds: int) -> bool:
    now = datetime.now(timezone.utc)
    try:
        doc = await db.locks.find_one_and_update(
            {"_id": name, "$or": [{"expires_at": {"$lte": now}}, {"owner": owner}]},
            {"$set": {"owner": owner, "expires_at": now + timedelta(seconds=ttl_seconds)}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
    except DuplicateKeyError:
        # The lock exists, is held by someone else and has not expired:
        # the filter did not match, so the upsert tried to insert a second _id.
        return False
    return doc is not None and doc["owner"] == owner


async def release(db: AsyncDatabase, name: str, owner: str) -> None:
    await db.locks.delete_one({"_id": name, "owner": owner})
