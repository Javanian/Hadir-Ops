from datetime import date, datetime, timedelta, timezone
utc = timezone.utc  # singleton instance — datetime() and astimezone() require an instance, not the class
from typing import List, Optional
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.models import Attendance, OvertimeRequest, Shift


def _date_to_utc(d: date, site_timezone: str = "UTC") -> datetime:
    """Convert a site-local calendar date to its midnight expressed as UTC.

    e.g. 2026-03-15 in Asia/Jakarta (UTC+7) → 2026-03-14T17:00:00Z
    Defaults to treating the date as UTC when no timezone is provided (safe
    fallback for admin/supervisor endpoints that span multiple sites).
    """
    tz = ZoneInfo(site_timezone)
    local_midnight = datetime(d.year, d.month, d.day, tzinfo=tz)
    return local_midnight.astimezone(utc)


class AttendanceRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _with_relations(self):
        return (
            select(Attendance)
            .options(
                selectinload(Attendance.shift).selectinload(Shift.work_schedules),
                selectinload(Attendance.user),
                selectinload(Attendance.site),
                selectinload(Attendance.overtime_requests),
            )
        )

    # ── Queries ───────────────────────────────────────────────────────────────

    async def get_today_checkin(
        self, user_id: int, today_local: date, site_timezone: str
    ) -> Optional[Attendance]:
        """Return the check-in record for a user on the given site-local calendar date (or None).

        Uses a UTC range spanning [midnight_local, midnight_local+1day) to correctly
        handle multi-timezone sites — avoids DATE(checkin_time) which returns UTC date.
        """
        tz = ZoneInfo(site_timezone)
        day_start_local = datetime(today_local.year, today_local.month, today_local.day, tzinfo=tz)
        day_end_local = day_start_local + timedelta(days=1)
        day_start_utc = day_start_local.astimezone(utc)
        day_end_utc = day_end_local.astimezone(utc)

        result = await self.db.execute(
            self._with_relations().where(
                Attendance.user_id == user_id,
                Attendance.checkin_time >= day_start_utc,
                Attendance.checkin_time < day_end_utc,
            )
        )
        return result.scalar_one_or_none()

    async def get_open_for_user(self, user_id: int) -> Optional[Attendance]:
        """Return the most-recent open check-in (no checkout) for a user."""
        result = await self.db.execute(
            self._with_relations()
            .where(
                Attendance.user_id == user_id,
                Attendance.checkout_time.is_(None),
            )
            .order_by(Attendance.checkin_time.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_open_attendances(self) -> List[Attendance]:
        """Return all records without a checkout (for auto-checkout worker)."""
        result = await self.db.execute(
            self._with_relations().where(Attendance.checkout_time.is_(None))
        )
        return list(result.scalars().all())

    async def get_by_id(self, attendance_id: int) -> Optional[Attendance]:
        result = await self.db.execute(
            self._with_relations().where(Attendance.id == attendance_id)
        )
        return result.scalar_one_or_none()

    async def get_all(
        self,
        user_id: Optional[int] = None,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        status: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[Attendance]:
        stmt = self._with_relations().order_by(Attendance.checkin_time.desc())
        if user_id is not None:
            stmt = stmt.where(Attendance.user_id == user_id)
        if from_date is not None:
            stmt = stmt.where(Attendance.checkin_time >= _date_to_utc(from_date))
        if to_date is not None:
            stmt = stmt.where(Attendance.checkin_time < _date_to_utc(to_date + timedelta(days=1)))
        if status is not None:
            stmt = stmt.where(Attendance.status == status)
        stmt = stmt.limit(limit).offset(offset)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    async def get_by_user(
        self,
        user_id: int,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        site_timezone: str = "UTC",
        limit: int = 50,
        offset: int = 0,
    ) -> List[Attendance]:
        stmt = (
            self._with_relations()
            .where(Attendance.user_id == user_id)
            .order_by(Attendance.checkin_time.desc())
        )
        if from_date is not None:
            stmt = stmt.where(Attendance.checkin_time >= _date_to_utc(from_date, site_timezone))
        if to_date is not None:
            stmt = stmt.where(Attendance.checkin_time < _date_to_utc(to_date + timedelta(days=1), site_timezone))
        stmt = stmt.limit(limit).offset(offset)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

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
        stmt = self._with_relations().order_by(Attendance.checkin_time.desc())
        if user_ids is not None:
            stmt = stmt.where(Attendance.user_id.in_(user_ids))
        if from_date is not None:
            stmt = stmt.where(Attendance.checkin_time >= _date_to_utc(from_date, site_timezone))
        if to_date is not None:
            stmt = stmt.where(Attendance.checkin_time < _date_to_utc(to_date + timedelta(days=1), site_timezone))
        stmt = stmt.limit(limit).offset(offset)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

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
    ) -> Attendance:
        att = Attendance(
            user_id=user_id,
            site_id=site_id,
            shift_id=shift_id,
            checkin_time=checkin_time,
            latitude=latitude,
            longitude=longitude,
            status=status,
            is_weekend=is_weekend,
            is_holiday=is_holiday,
            work_duration_minutes=0,
            overtime_minutes=0,
            auto_checkout=False,
        )
        self.db.add(att)
        await self.db.flush()
        await self.db.refresh(att)
        return att

    async def checkout(
        self,
        att: Attendance,
        checkout_time: datetime,
        work_duration_minutes: int,
        auto_checkout: bool = False,
        overtime_minutes: int = 0,
    ) -> Attendance:
        att.checkout_time = checkout_time
        att.work_duration_minutes = work_duration_minutes
        att.auto_checkout = auto_checkout
        att.overtime_minutes = overtime_minutes
        await self.db.commit()
        await self.db.refresh(att)
        return att

    async def get_open_with_approved_overtime_due(self, now_utc: datetime) -> List[Attendance]:
        """Return open attendance records whose APPROVED overtime end time has passed.

        Used by the auto-checkout worker to close sessions when the approved overtime
        period expires (cross-midnight aware — requested_end is stored as UTC TIMESTAMPTZ).
        """
        from sqlalchemy import join
        stmt = (
            self._with_relations()
            .join(OvertimeRequest, OvertimeRequest.attendance_id == Attendance.id)
            .where(
                Attendance.checkout_time.is_(None),
                OvertimeRequest.status == "APPROVED",
                OvertimeRequest.requested_end <= now_utc,
            )
        )
        result = await self.db.execute(stmt)
        return list(result.scalars().unique().all())

    async def set_overtime_minutes(self, attendance_id: int, overtime_minutes: int) -> None:
        """Update overtime_minutes on an existing attendance record (called on OT approval)."""
        result = await self.db.execute(
            select(Attendance).where(Attendance.id == attendance_id)
        )
        att = result.scalar_one_or_none()
        if att is not None:
            att.overtime_minutes = overtime_minutes
            await self.db.commit()
