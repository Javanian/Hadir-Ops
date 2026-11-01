from datetime import datetime, UTC

from pymongo import DESCENDING
from pymongo.asynchronous.database import AsyncDatabase
from pymongo.errors import BulkWriteError

from app.db.documents import CheckinAttempt
from app.db.ids import next_id
from app.db.relations import attach_attempts

_DUPLICATE_KEY = 11000


class AttemptRepository:
    def __init__(self, db: AsyncDatabase):
        self.db = db

    async def insert_many(self, user_id: int, rows: list[dict]) -> int:
        """Insert attempts, ignoring event ids already stored. Returns how many were new."""
        if not rows:
            return 0
        now = datetime.now(UTC)
        docs = [
            {"_id": await next_id(self.db, "checkin_attempts"), **row, "user_id": user_id, "received_at": now}
            for row in rows
        ]
        try:
            result = await self.db.checkin_attempts.insert_many(docs, ordered=False)
            return len(result.inserted_ids)
        except BulkWriteError as exc:
            errors = exc.details.get("writeErrors", [])
            if any(e.get("code") != _DUPLICATE_KEY for e in errors):
                raise
            return exc.details.get("nInserted", 0)

    async def list(
        self,
        user_ids: list[int] | None,
        from_utc: datetime | None = None,
        to_utc: datetime | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> list[CheckinAttempt]:
        query: dict = {}
        if user_ids is not None:
            if not user_ids:
                return []
            query["user_id"] = {"$in": user_ids}
        rng: dict = {}
        if from_utc is not None:
            rng["$gte"] = from_utc
        if to_utc is not None:
            rng["$lt"] = to_utc
        if rng:
            query["captured_at"] = rng
        cursor = self.db.checkin_attempts.find(query).sort("captured_at", DESCENDING).skip(offset).limit(limit)
        return await attach_attempts(self.db, [CheckinAttempt.from_doc(d) async for d in cursor])
