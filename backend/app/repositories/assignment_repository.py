from datetime import date, datetime, timezone
from typing import List, Optional

from pymongo import DESCENDING
from pymongo.asynchronous.database import AsyncDatabase

from app.db.documents import TemporaryAssignment, encode
from app.db.ids import next_id
from app.db.relations import attach_assignments


class AssignmentRepository:
    def __init__(self, db: AsyncDatabase):
        self.db = db

    async def _many(self, query: dict, skip: int = 0, limit: int = 0) -> List[TemporaryAssignment]:
        cursor = self.db.temporary_assignments.find(query).sort("start_date", DESCENDING).skip(skip)
        if limit:
            cursor = cursor.limit(limit)
        items = [TemporaryAssignment.from_doc(d) async for d in cursor]
        return await attach_assignments(self.db, items)

    async def get_all(
        self,
        skip: int = 0,
        limit: int = 100,
        user_id: Optional[int] = None,
        site_id: Optional[int] = None,
        active_only: bool = False,
    ) -> List[TemporaryAssignment]:
        query: dict = {}
        if user_id is not None:
            query["user_id"] = user_id
        if site_id is not None:
            query["site_id"] = site_id
        if active_only:
            today = date.today().isoformat()
            query["start_date"] = {"$lte": today}
            query["end_date"] = {"$gte": today}
        return await self._many(query, skip, limit)

    async def get_by_id(self, assignment_id: int) -> Optional[TemporaryAssignment]:
        found = await self._many({"_id": assignment_id})
        return found[0] if found else None

    async def get_active_for_user(self, user_id: int, target_date: date) -> Optional[TemporaryAssignment]:
        """Return the first active assignment for a user on the given date."""
        day = target_date.isoformat()
        found = await self._many(
            {"user_id": user_id, "start_date": {"$lte": day}, "end_date": {"$gte": day}}, limit=1
        )
        return found[0] if found else None

    async def active_between(self, user_ids: List[int], start: date, end: date) -> List[TemporaryAssignment]:
        cursor = self.db.temporary_assignments.find({
            "user_id": {"$in": user_ids},
            "start_date": {"$lte": end.isoformat()},
            "end_date": {"$gte": start.isoformat()},
        })
        return [TemporaryAssignment.from_doc(d) async for d in cursor]

    async def check_overlap(
        self,
        user_id: int,
        start_date: date,
        end_date: date,
        exclude_id: Optional[int] = None,
    ) -> bool:
        """Return True if an overlapping assignment exists for the user."""
        query: dict = {
            "user_id": user_id,
            "start_date": {"$lte": end_date.isoformat()},
            "end_date": {"$gte": start_date.isoformat()},
        }
        if exclude_id is not None:
            query["_id"] = {"$ne": exclude_id}
        return await self.db.temporary_assignments.count_documents(query, limit=1) > 0

    async def create(self, data, created_by: Optional[int]) -> TemporaryAssignment:
        assignment_id = await next_id(self.db, "temporary_assignments")
        await self.db.temporary_assignments.insert_one(encode({
            "_id": assignment_id,
            "user_id": data.user_id,
            "site_id": data.site_id,
            "shift_id": data.shift_id,
            "start_date": data.start_date,
            "end_date": data.end_date,
            "notes": data.notes,
            "created_by": created_by,
            "created_at": datetime.now(timezone.utc),
        }))
        return await self.get_by_id(assignment_id)

    async def delete(self, assignment: TemporaryAssignment) -> None:
        await self.db.temporary_assignments.delete_one({"_id": assignment.id})
