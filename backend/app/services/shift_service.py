from datetime import date
from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.shift_repository import ShiftRepository
from app.repositories.site_repository import SiteRepository
from app.schemas.shift import (
    HolidayCreate,
    HolidayResponse,
    HolidayUpdate,
    ShiftCreate,
    ShiftResponse,
    ShiftUpdate,
    WorkScheduleCreate,
    WorkScheduleResponse,
)


def _shift_to_response(shift) -> ShiftResponse:
    return ShiftResponse(
        id=shift.id,
        site_id=shift.site_id,
        name=shift.name,
        start_time=shift.start_time,
        end_time=shift.end_time,
        is_cross_midnight=shift.is_cross_midnight,
        work_hours_standard=shift.work_hours_standard,
        created_at=shift.created_at,
        schedules=[
            WorkScheduleResponse(
                id=ws.id,
                day_of_week=ws.day_of_week,
                toleransi_telat_menit=ws.toleransi_telat_menit,
            )
            for ws in (shift.work_schedules or [])
        ],
    )


class ShiftService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = ShiftRepository(db)
        self.site_repo = SiteRepository(db)

    # ── Helpers ───────────────────────────────────────────────────────────────

    async def _assert_site_exists(self, site_id: int):
        site = await self.site_repo.get_by_id(site_id)
        if not site:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Site {site_id} not found",
            )

    def _validate_time_logic(self, start_time, end_time, is_cross_midnight: bool):
        """Validate that shift time makes sense."""
        if start_time == end_time:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="start_time and end_time cannot be equal",
            )
        # Cross-midnight shifts: end_time < start_time is expected
        if not is_cross_midnight and end_time < start_time:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="end_time is before start_time. Set is_cross_midnight=true for overnight shifts.",
            )

    # ── Shifts ────────────────────────────────────────────────────────────────

    async def list_shifts(self, site_id: Optional[int] = None) -> List[ShiftResponse]:
        shifts = await self.repo.get_all(site_id=site_id)
        return [_shift_to_response(s) for s in shifts]

    async def get_shift(self, shift_id: int) -> ShiftResponse:
        shift = await self.repo.get_by_id(shift_id)
        if not shift:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
        return _shift_to_response(shift)

    async def create_shift(self, data: ShiftCreate) -> ShiftResponse:
        await self._assert_site_exists(data.site_id)
        self._validate_time_logic(data.start_time, data.end_time, data.is_cross_midnight)

        shift = await self.repo.create(
            site_id=data.site_id,
            name=data.name,
            start_time=data.start_time,
            end_time=data.end_time,
            is_cross_midnight=data.is_cross_midnight,
            work_hours_standard=data.work_hours_standard,
        )

        # Add work schedules if provided
        if data.schedules:
            days_seen = set()
            for s in data.schedules:
                if s.day_of_week in days_seen:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail=f"Duplicate day_of_week={s.day_of_week} in schedules",
                    )
                days_seen.add(s.day_of_week)
                await self.repo.add_schedule(shift.id, s.day_of_week, s.toleransi_telat_menit)

        await self.db.commit()
        # Reload with schedules
        shift = await self.repo.get_by_id(shift.id)
        return _shift_to_response(shift)

    async def update_shift(self, shift_id: int, data: ShiftUpdate) -> ShiftResponse:
        shift = await self.repo.get_by_id(shift_id)
        if not shift:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")

        updates = data.model_dump(exclude_none=True)
        if not updates:
            return _shift_to_response(shift)

        # Re-validate time logic if times are being changed
        new_start = updates.get("start_time", shift.start_time)
        new_end = updates.get("end_time", shift.end_time)
        new_cross = updates.get("is_cross_midnight", shift.is_cross_midnight)
        self._validate_time_logic(new_start, new_end, new_cross)

        shift = await self.repo.update(shift, **updates)
        return _shift_to_response(shift)

    async def delete_shift(self, shift_id: int) -> None:
        shift = await self.repo.get_by_id(shift_id)
        if not shift:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")
        await self.repo.delete(shift)

    # ── Work Schedules ────────────────────────────────────────────────────────

    async def add_schedule(
        self, shift_id: int, data: WorkScheduleCreate
    ) -> WorkScheduleResponse:
        shift = await self.repo.get_by_id(shift_id)
        if not shift:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shift not found")

        # Check duplicate day
        existing_days = {ws.day_of_week for ws in shift.work_schedules}
        if data.day_of_week in existing_days:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"day_of_week={data.day_of_week} already exists for this shift",
            )

        ws = await self.repo.add_schedule(shift_id, data.day_of_week, data.toleransi_telat_menit)
        await self.db.commit()
        return WorkScheduleResponse(
            id=ws.id,
            day_of_week=ws.day_of_week,
            toleransi_telat_menit=ws.toleransi_telat_menit,
        )

    async def delete_schedule(self, schedule_id: int) -> None:
        ws = await self.repo.get_schedule(schedule_id)
        if not ws:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Schedule not found"
            )
        await self.repo.delete_schedule(ws)

    # ── Holidays ──────────────────────────────────────────────────────────────

    async def list_holidays(self) -> List[HolidayResponse]:
        holidays = await self.repo.get_all_holidays()
        return [
            HolidayResponse(
                id=h.id,
                holiday_date=str(h.holiday_date),
                description=h.description,
                is_national=h.is_national,
            )
            for h in holidays
        ]

    async def create_holiday(self, data: HolidayCreate) -> HolidayResponse:
        hdate = date.fromisoformat(data.holiday_date)
        existing = await self.repo.get_holiday_by_date(hdate)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Holiday on {data.holiday_date} already exists",
            )
        holiday = await self.repo.create_holiday(hdate, data.description, data.is_national)
        return HolidayResponse(
            id=holiday.id,
            holiday_date=str(holiday.holiday_date),
            description=holiday.description,
            is_national=holiday.is_national,
        )

    async def update_holiday(self, holiday_id: int, data: HolidayUpdate) -> HolidayResponse:
        holiday = await self.repo.get_holiday_by_id(holiday_id)
        if not holiday:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Holiday not found"
            )
        updates = data.model_dump(exclude_none=True)
        if updates:
            holiday = await self.repo.update_holiday(holiday, **updates)
        return HolidayResponse(
            id=holiday.id,
            holiday_date=str(holiday.holiday_date),
            description=holiday.description,
            is_national=holiday.is_national,
        )

    async def delete_holiday(self, holiday_id: int) -> None:
        holiday = await self.repo.get_holiday_by_id(holiday_id)
        if not holiday:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Holiday not found"
            )
        await self.repo.delete_holiday(holiday)
