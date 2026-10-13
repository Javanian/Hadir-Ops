from datetime import date, time
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.models import Holiday, Shift, WorkSchedule


class ShiftRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Shifts ────────────────────────────────────────────────────────────────

    async def get_all(self, site_id: Optional[int] = None) -> List[Shift]:
        stmt = (
            select(Shift)
            .options(selectinload(Shift.work_schedules))
            .order_by(Shift.id)
        )
        if site_id is not None:
            stmt = stmt.where(Shift.site_id == site_id)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def get_by_id(self, shift_id: int) -> Optional[Shift]:
        result = await self.db.execute(
            select(Shift)
            .options(selectinload(Shift.work_schedules))
            .where(Shift.id == shift_id)
        )
        return result.scalar_one_or_none()

    async def create(
        self,
        site_id: int,
        name: str,
        start_time: time,
        end_time: time,
        is_cross_midnight: bool,
        work_hours_standard: int,
    ) -> Shift:
        shift = Shift(
            site_id=site_id,
            name=name,
            start_time=start_time,
            end_time=end_time,
            is_cross_midnight=is_cross_midnight,
            work_hours_standard=work_hours_standard,
        )
        self.db.add(shift)
        await self.db.flush()  # get the ID before adding schedules
        return shift

    async def update(self, shift: Shift, **kwargs) -> Shift:
        for key, value in kwargs.items():
            if value is not None:
                setattr(shift, key, value)
        await self.db.commit()
        await self.db.refresh(shift, ["work_schedules"])
        return shift

    async def delete(self, shift: Shift) -> None:
        await self.db.delete(shift)
        await self.db.commit()

    # ── Work Schedules ────────────────────────────────────────────────────────

    async def add_schedule(
        self, shift_id: int, day_of_week: int, toleransi_telat_menit: int
    ) -> WorkSchedule:
        ws = WorkSchedule(
            shift_id=shift_id,
            day_of_week=day_of_week,
            toleransi_telat_menit=toleransi_telat_menit,
        )
        self.db.add(ws)
        await self.db.flush()
        return ws

    async def get_schedule(self, schedule_id: int) -> Optional[WorkSchedule]:
        result = await self.db.execute(
            select(WorkSchedule).where(WorkSchedule.id == schedule_id)
        )
        return result.scalar_one_or_none()

    async def delete_schedule(self, ws: WorkSchedule) -> None:
        await self.db.delete(ws)
        await self.db.commit()

    async def replace_schedules(
        self,
        shift_id: int,
        schedules: list,
    ) -> None:
        """Delete all existing schedules for a shift and insert new ones."""
        existing = await self.db.execute(
            select(WorkSchedule).where(WorkSchedule.shift_id == shift_id)
        )
        for ws in existing.scalars().all():
            await self.db.delete(ws)
        await self.db.flush()

        for s in schedules:
            ws = WorkSchedule(
                shift_id=shift_id,
                day_of_week=s.day_of_week,
                toleransi_telat_menit=s.toleransi_telat_menit,
            )
            self.db.add(ws)

    # ── Holidays ──────────────────────────────────────────────────────────────

    async def get_all_holidays(self) -> List[Holiday]:
        result = await self.db.execute(select(Holiday).order_by(Holiday.holiday_date))
        return list(result.scalars().all())

    async def get_holiday_by_id(self, holiday_id: int) -> Optional[Holiday]:
        result = await self.db.execute(
            select(Holiday).where(Holiday.id == holiday_id)
        )
        return result.scalar_one_or_none()

    async def get_holiday_by_date(self, holiday_date: date) -> Optional[Holiday]:
        result = await self.db.execute(
            select(Holiday).where(Holiday.holiday_date == holiday_date)
        )
        return result.scalar_one_or_none()

    async def create_holiday(
        self, holiday_date: date, description: Optional[str], is_national: bool
    ) -> Holiday:
        holiday = Holiday(
            holiday_date=holiday_date,
            description=description,
            is_national=is_national,
        )
        self.db.add(holiday)
        await self.db.commit()
        await self.db.refresh(holiday)
        return holiday

    async def update_holiday(self, holiday: Holiday, **kwargs) -> Holiday:
        for key, value in kwargs.items():
            if value is not None:
                setattr(holiday, key, value)
        await self.db.commit()
        await self.db.refresh(holiday)
        return holiday

    async def delete_holiday(self, holiday: Holiday) -> None:
        await self.db.delete(holiday)
        await self.db.commit()
