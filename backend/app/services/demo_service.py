"""
Public demo mode (DEMO_MODE=true)
=================================
  - One-click sign-in: the demo admin and supervisor are shared accounts; every
    visitor who signs in as an employee gets an account of their own, so their
    check-ins and the face they enrol never mix with another visitor's.
  - The database is replaced with the sample dataset every day at 00:00 UTC,
    face embeddings included. Face photos are never stored, demo or not.
  - The shared accounts cannot be edited, deleted or have their password
    changed, so one visitor cannot lock out the next.

Every API process runs the reset loop; a lease lets one of them do the work.
"""

import logging
from datetime import datetime, time, timedelta, UTC

from fastapi import HTTPException, status
from pymongo.asynchronous.database import AsyncDatabase

from app.core.security import create_access_token, create_refresh_token
from app.db import locks
from app.db.schema import ensure_schema
from app.schemas.auth import TokenResponse
from app.services import demo_data

log = logging.getLogger("rollproof.demo")

RESET_LOCK = "demo_reset"
STATE_ID = "demo"
# Kept across a reset: id counters (another process may still hand out ids
# from a block it reserved) and the lease that guards the reset itself.
_KEEP = {"counters", "locks"}
PROTECTED_EMAILS = frozenset({demo_data.ADMIN_EMAIL, demo_data.SUPERVISOR_EMAIL})


def next_reset_after(moment: datetime) -> datetime:
    return datetime.combine(moment.astimezone(UTC).date() + timedelta(days=1), time(0, 0), tzinfo=UTC)


async def last_reset(db: AsyncDatabase) -> datetime | None:
    doc = await db.demo_state.find_one({"_id": STATE_ID})
    if not doc:
        return None
    at = doc["reset_at"]
    return at if at.tzinfo else at.replace(tzinfo=UTC)


async def reset(db: AsyncDatabase, now: datetime | None = None) -> dict:
    """Replace every record with a fresh sample dataset."""
    now = now or datetime.now(UTC)
    for name in await db.list_collection_names():
        if name not in _KEEP and not name.startswith("system."):
            await db[name].delete_many({})
    await ensure_schema(db)
    counts = await demo_data.seed_dataset(db, now)
    await db.demo_state.replace_one({"_id": STATE_ID}, {"_id": STATE_ID, "reset_at": now}, upsert=True)
    return counts


async def reset_if_due(db: AsyncDatabase, worker_id: str, now: datetime | None = None) -> bool:
    """Reset when the data predates the last 00:00 UTC (or was never seeded).
    Returns whether this call did the reset."""
    now = now or datetime.now(UTC)
    previous = await last_reset(db)
    if previous is not None and now < next_reset_after(previous):
        return False
    if not await locks.acquire(db, RESET_LOCK, worker_id, ttl_seconds=600):
        return False
    try:
        previous = await last_reset(db)  # another process may have just finished
        if previous is not None and now < next_reset_after(previous):
            return False
        counts = await reset(db, now)
        log.info("demo data reset: %(sites)d sites, %(people)d people, %(attendance)d attendance records", counts)
        return True
    finally:
        await locks.release(db, RESET_LOCK, worker_id)


async def login(db: AsyncDatabase, role: str) -> TokenResponse:
    if role == "EMPLOYEE":
        try:
            user = await demo_data.add_visitor(db)
        except LookupError as exc:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    else:
        email = demo_data.ADMIN_EMAIL if role == "ADMIN" else demo_data.SUPERVISOR_EMAIL
        user = await db.users.find_one({"email": email})
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="The demo dataset is missing; it is restored at the next reset.",
            )
    claims = {"sub": str(user["_id"]), "role": user["role"]}
    return TokenResponse(access_token=create_access_token(claims), refresh_token=create_refresh_token(claims))


def refuse() -> HTTPException:
    return HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail={"code": "DEMO_READ_ONLY"})


async def protect_shared_account(db: AsyncDatabase, user_id: int) -> None:
    """The shared demo admin and supervisor stay as they are for the next visitor."""
    doc = await db.users.find_one({"_id": user_id}, {"email": 1})
    if doc and doc["email"] in PROTECTED_EMAILS:
        raise refuse()
