from datetime import datetime, timezone
from typing import List, Optional

from pymongo import DESCENDING
from pymongo.asynchronous.database import AsyncDatabase

from app.db.documents import OvertimeRequest
from app.db.ids import next_id
from app.db.relations import attach_overtime

ACTIVE = ["PENDING", "APPROVED"]


class OvertimeRepository:
    def __init__(self, db: AsyncDatabase):
        self.db = db

    async def _many(self, query: dict, sort: str = "created_at", limit: int = 0, offset: int = 0) -> List[OvertimeRequest]:
        cursor = self.db.overtime_requests.find(query).sort([(sort, DESCENDING), ("_id", DESCENDING)]).skip(offset)
        if limit:
            cursor = cursor.limit(limit)
        items = [OvertimeRequest.from_doc(d) async for d in cursor]
        return await attach_overtime(self.db, items)

    async def _first(self, query: dict, sort: str = "created_at") -> Optional[OvertimeRequest]:
        found = await self._many(query, sort=sort, limit=1)
        return found[0] if found else None

    # ── Queries ───────────────────────────────────────────────────────────────

    async def get_by_id(self, request_id: int) -> Optional[OvertimeRequest]:
        return await self._first({"_id": request_id})

    async def get_by_attendance(self, attendance_id: int) -> List[OvertimeRequest]:
        return await self._many({"attendance_id": attendance_id})

    async def get_active_for_attendance(self, attendance_id: int) -> Optional[OvertimeRequest]:
        """Return the latest PENDING or APPROVED request for an attendance (prevents duplicates)."""
        return await self._first({"attendance_id": attendance_id, "status": {"$in": ACTIVE}})

    async def get_active_for_user_window(
        self, user_id: int, window_start: datetime, window_end: datetime
    ) -> Optional[OvertimeRequest]:
        """Return an active request that overlaps the given window for a user (standalone OT)."""
        return await self._first({
            "user_id": user_id,
            "attendance_id": None,
            "status": {"$in": ACTIVE},
            "requested_start": {"$lt": window_end},
            "requested_end": {"$gt": window_start},
        })

    async def get_approved_standalone_covering(self, user_id: int, moment: datetime) -> Optional[OvertimeRequest]:
        """The APPROVED standalone request (no attendance) whose window contains
        *moment*. Lets an employee clock in for approved overtime outside any shift."""
        return await self._first({
            "user_id": user_id,
            "attendance_id": None,
            "status": "APPROVED",
            "requested_start": {"$lte": moment},
            "requested_end": {"$gt": moment},
        }, sort="requested_start")

    async def get_approved_standalone_for_checkin(self, user_id: int, checkin_utc: datetime) -> Optional[OvertimeRequest]:
        """Used by auto-checkout to find the overtime end for a shift-less record."""
        return await self.get_approved_standalone_covering(user_id, checkin_utc)

    async def get_all(
        self,
        user_id: Optional[int] = None,          # filter by owner (works for all roles)
        subordinate_ids: Optional[list] = None,  # SUPERVISOR: direct subordinates only
        ot_status: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[OvertimeRequest]:
        query: dict = {}
        if user_id is not None:
            query["user_id"] = user_id
        if subordinate_ids is not None:
            query.setdefault("$and", []).append({"user_id": {"$in": list(subordinate_ids)}})
        if ot_status is not None:
            query["status"] = ot_status
        return await self._many(query, limit=limit, offset=offset)

    # ── Mutations ─────────────────────────────────────────────────────────────

    async def create(
        self,
        user_id: int,
        requested_start: datetime,
        requested_end: datetime,
        attendance_id: Optional[int] = None,
        notes: Optional[str] = None,
    ) -> OvertimeRequest:
        request_id = await next_id(self.db, "overtime_requests")
        await self.db.overtime_requests.insert_one({
            "_id": request_id,
            "user_id": user_id,
            "attendance_id": attendance_id,
            "requested_start": requested_start,
            "requested_end": requested_end,
            "approved_by": None,
            "status": "PENDING",
            "notes": notes,
            "supervisor_notes": None,
            "created_at": datetime.now(timezone.utc),
        })
        return await self.get_by_id(request_id)

    async def update_status(
        self,
        req: OvertimeRequest,
        new_status: str,
        approved_by: int,
        **fields,
    ) -> Optional[OvertimeRequest]:
        """Decide a PENDING request. `fields` carries an adjusted window or the
        supervisor's note. Returns None if it was no longer PENDING."""
        result = await self.db.overtime_requests.update_one(
            {"_id": req.id, "status": "PENDING"},
            {"$set": {"status": new_status, "approved_by": approved_by, **fields}},
        )
        if result.modified_count != 1:
            return None
        return await self.get_by_id(req.id)
