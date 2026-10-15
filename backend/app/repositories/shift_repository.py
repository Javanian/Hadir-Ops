from datetime import date, datetime, time, timezone
from typing import List, Optional

from pymongo.asynchronous.database import AsyncDatabase

from app.db import in_transaction
from app.db.documents import Holiday, Shift, WorkSchedule, encode
from app.db.ids import next_id


class ShiftRepository:
    """Shifts with their day schedules embedded (`work_schedules` array).

    A shift and its schedules are always read and changed together, so they
    live in one document; schedule ids stay globally unique for the API.
    """

    def __init__(self, db: AsyncDatabase):
        self.db = db

    # ── Shifts ────────────────────────────────────────────────────────────────

    async def get_all(self, site_id: Optional[int] = None) -> List[Shift]:
        query = {} if site_id is None else {"site_id": site_id}
        return [Shift.from_doc(d) async for d in self.db.shifts.find(query).sort("_id", 1)]

    async def get_by_id(self, shift_id: int) -> Optional[Shift]:
        doc = await self.db.shifts.find_one({"_id": shift_id})
        return Shift.from_doc(doc) if doc else None

    async def create(
        self,
        site_id: int,
        name: str,
        start_time: time,
        end_time: time,
        is_cross_midnight: bool,
        work_hours_standard: int,
        schedules: Optional[list] = None,
    ) -> Shift:
        """Insert a shift together with its day schedules."""
        shift_id = await next_id(self.db, "shifts")
        embedded = [
            {
                "id": await next_id(self.db, "work_schedules"),
                "day_of_week": s.day_of_week,
                "toleransi_telat_menit": s.toleransi_telat_menit,
            }
            for s in (schedules or [])
        ]
        doc = encode({
            "_id": shift_id,
            "site_id": site_id,
            "name": name,
            "start_time": start_time,
            "end_time": end_time,
            "is_cross_midnight": is_cross_midnight,
            "work_hours_standard": work_hours_standard,
            "created_at": datetime.now(timezone.utc),
            "work_schedules": embedded,
        })
        await self.db.shifts.insert_one(doc)
        return Shift.from_doc(doc)

    async def update(self, shift: Shift, **kwargs) -> Shift:
        fields = {k: v for k, v in kwargs.items() if v is not None}
        if fields:
            await self.db.shifts.update_one({"_id": shift.id}, {"$set": encode(fields)})
        return await self.get_by_id(shift.id)

    async def in_use(self, shift_id: int) -> bool:
        """True if attendance records point at this shift."""
        return await self.db.attendance.count_documents({"shift_id": shift_id}, limit=1) > 0

    async def delete(self, shift: Shift) -> None:
        """Delete a shift and the assignments that use it (the old ON DELETE CASCADE)."""
        db = self.db

        async def run(session):
            await db.temporary_assignments.delete_many({"shift_id": shift.id}, session=session)
            await db.shifts.delete_one({"_id": shift.id}, session=session)

        await in_transaction(run)

    # ── Work Schedules ────────────────────────────────────────────────────────

    async def add_schedule(
        self, shift_id: int, day_of_week: int, toleransi_telat_menit: int
    ) -> WorkSchedule:
        ws = WorkSchedule(
            id=await next_id(self.db, "work_schedules"),
            shift_id=shift_id,
            day_of_week=day_of_week,
            toleransi_telat_menit=toleransi_telat_menit,
        )
        await self.db.shifts.update_one(
            {"_id": shift_id},
            {"$push": {"work_schedules": {
                "id": ws.id, "day_of_week": day_of_week, "toleransi_telat_menit": toleransi_telat_menit,
            }}},
        )
        return ws

    async def get_schedule(self, schedule_id: int) -> Optional[WorkSchedule]:
        doc = await self.db.shifts.find_one({"work_schedules.id": schedule_id})
        if doc is None:
            return None
        return next(ws for ws in Shift.from_doc(doc).work_schedules if ws.id == schedule_id)

    async def delete_schedule(self, ws: WorkSchedule) -> None:
        await self.db.shifts.update_one({"_id": ws.shift_id}, {"$pull": {"work_schedules": {"id": ws.id}}})

    # ── Holidays ──────────────────────────────────────────────────────────────

    async def get_all_holidays(self) -> List[Holiday]:
        return [Holiday.from_doc(d) async for d in self.db.holidays.find().sort("holiday_date", 1)]

    async def get_holiday_by_id(self, holiday_id: int) -> Optional[Holiday]:
        doc = await self.db.holidays.find_one({"_id": holiday_id})
        return Holiday.from_doc(doc) if doc else None

    async def get_holiday_by_date(self, holiday_date: date) -> Optional[Holiday]:
        doc = await self.db.holidays.find_one({"holiday_date": holiday_date.isoformat()})
        return Holiday.from_doc(doc) if doc else None

    async def holiday_dates_between(self, start: date, end: date) -> set:
        cursor = self.db.holidays.find(
            {"holiday_date": {"$gte": start.isoformat(), "$lte": end.isoformat()}}, {"holiday_date": 1}
        )
        return {date.fromisoformat(d["holiday_date"]) async for d in cursor}

    async def create_holiday(
        self, holiday_date: date, description: Optional[str], is_national: bool
    ) -> Holiday:
        doc = encode({
            "_id": await next_id(self.db, "holidays"),
            "holiday_date": holiday_date,
            "description": description,
            "is_national": is_national,
        })
        await self.db.holidays.insert_one(doc)
        return Holiday.from_doc(doc)

    async def update_holiday(self, holiday: Holiday, **kwargs) -> Holiday:
        fields = {k: v for k, v in kwargs.items() if v is not None}
        if fields:
            await self.db.holidays.update_one({"_id": holiday.id}, {"$set": encode(fields)})
        return await self.get_holiday_by_id(holiday.id)

    async def delete_holiday(self, holiday: Holiday) -> None:
        await self.db.holidays.delete_one({"_id": holiday.id})
