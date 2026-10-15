from datetime import date, datetime, timedelta, timezone
from typing import List, Optional
from zoneinfo import ZoneInfo

from pymongo import DESCENDING
from pymongo.asynchronous.database import AsyncDatabase

from app.db.documents import Attendance, encode
from app.db.ids import next_id
from app.db.relations import attach_attendance

utc = timezone.utc  # singleton instance — datetime() and astimezone() require an instance, not the class


def _date_to_utc(d: date, site_timezone: str = "UTC") -> datetime:
    """Convert a site-local calendar date to its midnight expressed as UTC.

    e.g. 2026-03-15 in Asia/Jakarta (UTC+7) → 2026-03-14T17:00:00Z
    Defaults to treating the date as UTC when no timezone is provided (safe
    fallback for admin/supervisor endpoints that span multiple sites).
    """
    tz = ZoneInfo(site_timezone)
    local_midnight = datetime(d.year, d.month, d.day, tzinfo=tz)
    return local_midnight.astimezone(utc)


def _checkin_range(from_date: Optional[date], to_date: Optional[date], site_timezone: str = "UTC") -> dict:
    rng: dict = {}
    if from_date is not None:
        rng["$gte"] = _date_to_utc(from_date, site_timezone)
    if to_date is not None:
        rng["$lt"] = _date_to_utc(to_date + timedelta(days=1), site_timezone)
    return {"checkin_time": rng} if rng else {}


def _indexed_str(value: str) -> dict:
    """Equality on a field covered by a partial unique index.

    The partial indexes only hold string values (`$type: "string"`), and the
    query planner uses a partial index only when the query states that
    condition itself; plain `{field: value}` would scan the collection.
    """
    return {"$eq": value, "$type": "string"}


class AttendanceRepository:
    def __init__(self, db: AsyncDatabase):
        self.db = db

    # ── Helpers ───────────────────────────────────────────────────────────────

    async def _many(self, query: dict, limit: int = 0, offset: int = 0) -> List[Attendance]:
        cursor = self.db.attendance.find(query).sort("checkin_time", DESCENDING).skip(offset)
        if limit:
            cursor = cursor.limit(limit)
        records = [Attendance.from_doc(d) async for d in cursor]
        return await attach_attendance(self.db, records)

    async def _one(self, query: dict, latest: bool = False) -> Optional[Attendance]:
        if latest:
            found = await self._many(query, limit=1)
            return found[0] if found else None
        doc = await self.db.attendance.find_one(query)
        if doc is None:
            return None
        return (await attach_attendance(self.db, [Attendance.from_doc(doc)]))[0]

    # ── Queries ───────────────────────────────────────────────────────────────

    async def get_today_checkin(
        self, user_id: int, today_local: date, site_timezone: str
    ) -> Optional[Attendance]:
        """Return the check-in record for a user on the given site-local calendar date (or None).

        Uses a UTC range spanning [midnight_local, midnight_local+1day) so a
        multi-timezone deployment compares against the site's own day.
        """
        query = {"user_id": user_id, **_checkin_range(today_local, today_local, site_timezone)}
        return await self._one(query, latest=True)

    async def get_open_for_user(self, user_id: int) -> Optional[Attendance]:
        """Return the most-recent open check-in (no checkout) for a user."""
        return await self._one({"user_id": user_id, "checkout_time": None}, latest=True)

    async def get_open_attendances(self) -> List[Attendance]:
        """Return all records without a checkout (for auto-checkout worker)."""
        return await self._many({"checkout_time": None})

    async def get_by_id(self, attendance_id: int) -> Optional[Attendance]:
        return await self._one({"_id": attendance_id})

    async def get_all(
        self,
        user_id: Optional[int] = None,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        status: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        user_ids: Optional[List[int]] = None,
    ) -> List[Attendance]:
        """`user_ids=None` means no restriction; an empty list matches nothing."""
        query: dict = {**_checkin_range(from_date, to_date)}
        if user_id is not None:
            query["user_id"] = user_id
        if user_ids is not None:
            if not user_ids:
                return []
            query.setdefault("$and", []).append({"user_id": {"$in": user_ids}})
        if status is not None:
            query["status"] = status
        return await self._many(query, limit, offset)

    async def get_by_user(
        self,
        user_id: int,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        site_timezone: str = "UTC",
        limit: int = 50,
        offset: int = 0,
    ) -> List[Attendance]:
        query = {"user_id": user_id, **_checkin_range(from_date, to_date, site_timezone)}
        return await self._many(query, limit, offset)

    async def get_team_attendance(
        self,
        user_ids: Optional[list] = None,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        site_timezone: str = "UTC",
        limit: int = 500,
        offset: int = 0,
    ) -> List[Attendance]:
        """Return attendance records for a set of users (team/subordinate view).
        user_ids=None means no filter — ADMIN sees all."""
        query: dict = {**_checkin_range(from_date, to_date, site_timezone)}
        if user_ids is not None:
            query["user_id"] = {"$in": list(user_ids)}
        return await self._many(query, limit, offset)

    async def get_by_client_event(self, client_event_id: str) -> Optional[Attendance]:
        return await self._one({"client_event_id": _indexed_str(client_event_id)})

    async def get_by_checkout_event(self, checkout_event_id: str) -> Optional[Attendance]:
        return await self._one({"checkout_event_id": _indexed_str(checkout_event_id)})

    async def get_auto_closed_before(
        self, user_id: int, event_utc: datetime, window_hours: int = 24
    ) -> Optional[Attendance]:
        """Latest record closed by the auto-checkout worker that a late (offline)
        manual check-out at `event_utc` could belong to."""
        query = {
            "user_id": user_id,
            "auto_checkout": True,
            "checkin_time": {"$lt": event_utc, "$gte": event_utc - timedelta(hours=window_hours)},
        }
        return await self._one(query, latest=True)

    async def get_review_queue(
        self,
        user_ids: Optional[List[int]],
        pending_only: bool = True,
        limit: int = 200,
        offset: int = 0,
    ) -> List[Attendance]:
        if pending_only:
            query: dict = {"needs_review": True}
        else:
            query = {"$or": [{"needs_review": True}, {"review_status": {"$ne": None}}]}
        if user_ids is not None:
            if not user_ids:
                return []
            query["user_id"] = {"$in": user_ids}
        return await self._many(query, limit, offset)

    async def get_open_with_approved_overtime_due(self, now_utc: datetime) -> List[Attendance]:
        """Open records whose APPROVED overtime has ended (closes overtime sessions)."""
        att_ids = await self.db.overtime_requests.distinct(
            "attendance_id",
            {"status": "APPROVED", "requested_end": {"$lte": now_utc}, "attendance_id": {"$ne": None}},
        )
        if not att_ids:
            return []
        return await self._many({"_id": {"$in": att_ids}, "checkout_time": None})

    # ── Mutations ─────────────────────────────────────────────────────────────

    async def create(
        self,
        user_id: int,
        site_id: Optional[int],
        shift_id: Optional[int],
        checkin_time: datetime,
        latitude: Optional[float],
        longitude: Optional[float],
        status: str,
        is_weekend: bool,
        is_holiday: bool,
        **durable,
    ) -> Attendance:
        """Insert a check-in. `durable` carries the device-event fields
        (work_date, client_event_id, captured_at, risk_flags, ...).
        Raises DuplicateKeyError when the user already has a record for that
        work date or the event id was already stored."""
        doc = {
            "_id": await next_id(self.db, "attendance"),
            "user_id": user_id,
            "site_id": site_id,
            "shift_id": shift_id,
            "checkin_time": checkin_time,
            "checkout_time": None,
            "auto_checkout": False,
            "latitude": latitude,
            "longitude": longitude,
            "work_duration_minutes": 0,
            "overtime_minutes": 0,
            "is_weekend": is_weekend,
            "is_holiday": is_holiday,
            "status": status,
            "created_at": datetime.now(utc),
            "risk_flags": [],
            "needs_review": False,
            "is_offline": False,
            "review_status": None,
            **durable,
        }
        # Unique indexes are partial on string values: leave absent ids out
        # instead of storing nulls.
        for key in ("client_event_id", "checkout_event_id", "work_date"):
            if doc.get(key) is None:
                doc.pop(key, None)
        await self.db.attendance.insert_one(encode(doc))
        return Attendance.from_doc(encode(doc))

    async def update(self, attendance_id: int, fields: dict) -> None:
        if fields:
            await self.db.attendance.update_one({"_id": attendance_id}, {"$set": encode(fields)})

    async def checkout(
        self,
        att: Attendance,
        checkout_time: datetime,
        work_duration_minutes: int,
        auto_checkout: bool = False,
        overtime_minutes: int = 0,
        **extra,
    ) -> Attendance:
        """Close a record. `extra` carries fields changed alongside the check-out
        (risk flags, review state, the check-out event id)."""
        fields = {
            "checkout_time": checkout_time,
            "work_duration_minutes": work_duration_minutes,
            "auto_checkout": auto_checkout,
            "overtime_minutes": overtime_minutes,
            **extra,
        }
        await self.update(att.id, fields)
        for key, value in fields.items():
            setattr(att, key, value)
        return att

    async def set_overtime_minutes(self, attendance_id: int, overtime_minutes: int) -> None:
        """Update overtime_minutes on an existing attendance record (called on OT approval)."""
        await self.update(attendance_id, {"overtime_minutes": overtime_minutes})

    async def count_for_user(self, user_id: int) -> int:
        return await self.db.attendance.count_documents({"user_id": user_id})
