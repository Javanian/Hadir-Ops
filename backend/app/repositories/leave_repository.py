from datetime import date, datetime, timezone
from typing import List, Optional

from pymongo import DESCENDING
from pymongo.asynchronous.client_session import AsyncClientSession
from pymongo.asynchronous.database import AsyncDatabase

from app.db.documents import LeaveRequest, encode
from app.db.ids import next_id
from app.db.relations import attach_leave

ACTIVE_STATUSES = ["PENDING", "APPROVED"]


class LeaveRepository:
    def __init__(self, db: AsyncDatabase):
        self.db = db

    async def get_by_id(self, leave_id: int) -> Optional[LeaveRequest]:
        doc = await self.db.leave_requests.find_one({"_id": leave_id})
        if doc is None:
            return None
        return (await attach_leave(self.db, [LeaveRequest.from_doc(doc)]))[0]

    async def lock_user(self, user_id: int, session: AsyncClientSession) -> None:
        """Write to the user's document inside the transaction. A second
        transaction doing the same for this user hits a write conflict and is
        retried after the first commits, so it sees the first one's request."""
        await self.db.users.update_one(
            {"_id": user_id}, {"$inc": {"leave_write_seq": 1}}, session=session
        )

    async def find_overlapping_active(
        self, user_id: int, start: date, end: date, session: Optional[AsyncClientSession] = None
    ) -> Optional[LeaveRequest]:
        doc = await self.db.leave_requests.find_one(
            {
                "user_id": user_id,
                "status": {"$in": ACTIVE_STATUSES},
                "start_date": {"$lte": end.isoformat()},
                "end_date": {"$gte": start.isoformat()},
            },
            sort=[("start_date", 1)],
            session=session,
        )
        return LeaveRequest.from_doc(doc) if doc else None

    async def list(
        self,
        user_ids: Optional[List[int]] = None,
        status: Optional[str] = None,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> List[LeaveRequest]:
        """`user_ids=None` means no restriction; an empty list matches nothing."""
        query: dict = {}
        if user_ids is not None:
            if not user_ids:
                return []
            query["user_id"] = {"$in": user_ids}
        if status:
            query["status"] = status
        if from_date:
            query["end_date"] = {"$gte": from_date.isoformat()}
        if to_date:
            query["start_date"] = {"$lte": to_date.isoformat()}
        cursor = (
            self.db.leave_requests.find(query)
            .sort([("start_date", DESCENDING), ("_id", DESCENDING)])
            .skip(offset)
            .limit(limit)
        )
        return await attach_leave(self.db, [LeaveRequest.from_doc(d) async for d in cursor])

    async def approved_between(self, user_ids: List[int], start: date, end: date) -> List[LeaveRequest]:
        cursor = self.db.leave_requests.find({
            "user_id": {"$in": user_ids},
            "status": "APPROVED",
            "start_date": {"$lte": end.isoformat()},
            "end_date": {"$gte": start.isoformat()},
        })
        return [LeaveRequest.from_doc(d) async for d in cursor]

    async def insert(self, fields: dict, session: Optional[AsyncClientSession] = None) -> int:
        leave_id = await next_id(self.db, "leave_requests", session=session)
        await self.db.leave_requests.insert_one(
            encode({"_id": leave_id, "created_at": datetime.now(timezone.utc), **fields}), session=session
        )
        return leave_id

    async def transition_from_pending(
        self,
        leave_id: int,
        new_status: str,
        reviewed_by: Optional[int] = None,
        reviewed_at: Optional[datetime] = None,
        review_note: Optional[str] = None,
    ) -> bool:
        """Move a PENDING request to `new_status`. Returns False if it was no
        longer PENDING (someone else decided first)."""
        values = {"status": new_status}
        if reviewed_by is not None:
            values.update(reviewed_by=reviewed_by, reviewed_at=reviewed_at, review_note=review_note)
        result = await self.db.leave_requests.update_one(
            {"_id": leave_id, "status": "PENDING"}, {"$set": values}
        )
        return result.modified_count == 1
