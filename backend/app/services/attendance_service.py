"""
Attendance Service — Phase 4 (Multi-Timezone)
==============================================
Responsibilities:
  - Check-in:  GPS validation (Haversine), shift matching, status determination
  - Check-out: work_duration_minutes calculation, manual or auto
  - Auto-checkout worker: batch-checkout any open record whose shift has ended
  - List / get queries (with IDOR for EMPLOYEE role)

All timestamps stored as UTC (TIMESTAMPTZ).  Business logic uses site-local time
via ZoneInfo(site.timezone).  day_of_week mapping: DB 0=Sunday, 1=Monday ... 6=Saturday
"""

import math
from datetime import date, datetime, time, timedelta, timezone
utc = timezone.utc  # singleton instance — astimezone() requires an instance, not the class
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.attendance_repository import AttendanceRepository
from app.repositories.overtime_repository import OvertimeRepository
from app.repositories.shift_repository import ShiftRepository
from app.repositories.site_repository import SiteRepository
from app.schemas.attendance import (
    AttendanceResponse,
    AutoCheckoutResult,
    CheckinRequest,
    CheckoutRequest,
    TeamAttendanceRecord,
)


# ── Utilities ──────────────────────────────────────────────────────────────────

def _now_site(tz_str: str) -> datetime:
    """Return the current moment as an aware datetime in the given site timezone."""
    return datetime.now(ZoneInfo(tz_str))


def _python_weekday_to_db(py_weekday: int) -> int:
    """
    Convert Python weekday (Mon=0 … Sun=6)
    to DB day_of_week        (Sun=0 … Sat=6).
    """
    return (py_weekday + 1) % 7


def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the great-circle distance in **metres** between two GPS points."""
    R = 6_371_000  # Earth radius in metres
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))


def _find_active_shift(shifts, now: datetime):
    """
    Return the Shift whose schedule covers *now* (site-local aware datetime), or None.

    Matching rules:
    - Normal shift  (is_cross_midnight=False): start_time <= now.time() <= end_time
      AND work_schedule exists for today's DB day_of_week.
    - Cross-midnight shift (e.g. 22:00 → 06:00):
        * Evening window  (start_time <= now.time() <= 23:59):
          check today's day_of_week.
        * Early-morning window (00:00 <= now.time() < end_time):
          check yesterday's day_of_week (the shift *began* yesterday).
    """
    current_time: time = now.time()
    today_db_dow = _python_weekday_to_db(now.weekday())
    yesterday_db_dow = (today_db_dow - 1) % 7

    for shift in shifts:
        days = {ws.day_of_week for ws in shift.work_schedules}

        if shift.is_cross_midnight:
            # Evening part: shift starts today
            if today_db_dow in days and current_time >= shift.start_time:
                return shift
            # Morning part: shift started yesterday
            if yesterday_db_dow in days and current_time < shift.end_time:
                return shift
        else:
            if today_db_dow in days and shift.start_time <= current_time <= shift.end_time:
                return shift

    return None


def _get_tolerance(shift, db_dow: int) -> int:
    """Return toleransi_telat_menit for today's schedule, or 0."""
    for ws in shift.work_schedules:
        if ws.day_of_week == db_dow:
            return ws.toleransi_telat_menit
    return 0


def _find_upcoming_shift(shifts, now: datetime, early_hours: int = 2):
    """
    Return the first Shift whose start_time is within the next `early_hours` hours
    but has not started yet, considering today's work_schedule.

    Used to allow early check-in up to 2 hours before shift start.
    """
    today_db_dow = _python_weekday_to_db(now.weekday())

    for shift in shifts:
        days = {ws.day_of_week for ws in shift.work_schedules}
        if today_db_dow not in days:
            continue

        shift_start_dt = datetime.combine(now.date(), shift.start_time, tzinfo=now.tzinfo)
        early_window_start = shift_start_dt - timedelta(hours=early_hours)

        if early_window_start <= now < shift_start_dt:
            return shift

    return None


def _determine_status(
    checkin_now: datetime,
    shift,
    in_radius: bool,
) -> str:
    """
    Determine attendance status string.
    Priority: OUT_OF_RADIUS is still recorded (not blocked) per spec design.
    Within radius: ONTIME or LATE based on shift start + tolerance.

    checkin_now must be an aware datetime in the site's local timezone.
    """
    if not in_radius:
        return "OUT_OF_RADIUS"

    today_db_dow = _python_weekday_to_db(checkin_now.weekday())
    tolerance_min = _get_tolerance(shift, today_db_dow)

    # For cross-midnight shifts whose morning part falls on the *next* day,
    # the start_time reference is still from the original (previous) day.
    # For status we always compare against shift.start_time.
    shift_start_dt = datetime.combine(
        checkin_now.date(), shift.start_time, tzinfo=checkin_now.tzinfo
    )

    # If checking in during the *morning* window of a cross-midnight shift,
    # the start was "yesterday" — we're obviously late from a time standpoint
    # so just mark ONTIME (they made it in for their shift).
    if shift.is_cross_midnight and checkin_now.time() < shift.end_time:
        return "ONTIME"

    deadline = shift_start_dt + timedelta(minutes=tolerance_min)
    return "ONTIME" if checkin_now <= deadline else "LATE"


def _work_duration(checkin: datetime, checkout: datetime) -> int:
    """Duration in minutes between two aware datetimes."""
    return max(0, int((checkout - checkin).total_seconds() / 60))


def _attendance_response(att, site_tz: Optional[str] = None) -> AttendanceResponse:
    """Build AttendanceResponse and set site_timezone from site relationship or fallback."""
    r = AttendanceResponse.model_validate(att)
    r.site_timezone = site_tz or (att.site.timezone if att.site else "Asia/Jakarta")
    # Populate overtime_request fields from the latest linked OT request
    if att.overtime_requests:
        # Prefer PENDING (user needs to act), then APPROVED, then REJECTED
        status_priority = {"PENDING": 0, "APPROVED": 1, "REJECTED": 2}
        latest = min(
            att.overtime_requests,
            key=lambda x: (status_priority.get(x.status, 3), -x.id),
        )
        r.overtime_request_id = latest.id
        r.overtime_request_status = latest.status
    return r


# ── Service ────────────────────────────────────────────────────────────────────

class AttendanceService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = AttendanceRepository(db)
        self.ot_repo = OvertimeRepository(db)
        self.shift_repo = ShiftRepository(db)
        self.site_repo = SiteRepository(db)

    # ── Check-in ──────────────────────────────────────────────────────────────

    async def checkin(self, current_user, data: CheckinRequest) -> AttendanceResponse:
        # 1. User must belong to a site
        if not current_user.site_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="User is not assigned to any site. Contact ADMIN.",
            )

        site = await self.site_repo.get_by_id(current_user.site_id)
        if not site:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Assigned site not found.",
            )

        # 2. Get current time in site's local timezone
        now = _now_site(site.timezone)

        # 2b. Check for a temporary assignment — overrides site and shift
        from app.repositories.assignment_repository import AssignmentRepository
        _assignment = await AssignmentRepository(self.db).get_active_for_user(
            current_user.id, now.date()
        )
        _prefetched_shift = None
        if _assignment:
            _override_site = await self.site_repo.get_by_id(_assignment.site_id)
            if _override_site:
                site = _override_site
                now = _now_site(site.timezone)
                # Pre-load the assigned shift from the override site
                _all_shifts = await self.shift_repo.get_all(site_id=site.id)
                _prefetched_shift = next(
                    (s for s in _all_shifts if s.id == _assignment.shift_id), None
                )

        # 3. Prevent double check-in (same site-local calendar day)
        existing = await self.repo.get_today_checkin(current_user.id, now.date(), site.timezone)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Already checked in today at {existing.checkin_time.strftime('%H:%M:%S')}.",
            )

        # 4. GPS validation
        distance_m = haversine_meters(
            data.latitude, data.longitude,
            site.latitude, site.longitude,
        )
        in_radius = distance_m <= site.radius_meter

        # SALES role: always treated as within radius (no location restriction)
        if current_user.role.name == "SALES":
            in_radius = True

        # 5. Find active shift (use pre-fetched shift from temporary assignment if available)
        is_early_checkin = False
        if _prefetched_shift is not None:
            active_shift = _prefetched_shift
        else:
            shifts = await self.shift_repo.get_all(site_id=site.id)
            active_shift = _find_active_shift(shifts, now)
            if active_shift is None:
                # Try early check-in: allow up to 2 hours before shift start
                active_shift = _find_upcoming_shift(shifts, now)
                if active_shift is not None:
                    is_early_checkin = True

        checkin_utc = now.astimezone(utc)

        if active_shift is None:
            # No regular shift — check for an APPROVED standalone overtime covering now
            active_ot = await self.ot_repo.get_approved_standalone_covering(
                current_user.id, checkin_utc
            )
            if active_ot is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="No active shift found for the current time. Check shift schedules.",
                )
            # Overtime check-in: no shift, status is ONTIME/OUT_OF_RADIUS only
            att_status = "ONTIME" if in_radius else "OUT_OF_RADIUS"
            today_db_dow = _python_weekday_to_db(now.weekday())
            is_weekend = today_db_dow in {0, 6}
            holiday = await self.shift_repo.get_holiday_by_date(now.date())
            is_holiday = holiday is not None
            att = await self.repo.create(
                user_id=current_user.id,
                site_id=site.id,
                shift_id=None,
                checkin_time=checkin_utc,
                latitude=data.latitude,
                longitude=data.longitude,
                status=att_status,
                is_weekend=is_weekend,
                is_holiday=is_holiday,
            )
            await self.db.commit()
            att = await self.repo.get_by_id(att.id)
            return _attendance_response(att, site.timezone)

        # 6. Determine status
        if is_early_checkin:
            att_status = "EARLY" if in_radius else "OUT_OF_RADIUS"
        else:
            att_status = _determine_status(now, active_shift, in_radius)

        # 7. Weekend / holiday flags (using site-local date/weekday)
        today_db_dow = _python_weekday_to_db(now.weekday())
        is_weekend = today_db_dow in {0, 6}  # Sunday=0, Saturday=6
        holiday = await self.shift_repo.get_holiday_by_date(now.date())
        is_holiday = holiday is not None

        # 8. Persist (store UTC)
        att = await self.repo.create(
            user_id=current_user.id,
            site_id=site.id,
            shift_id=active_shift.id,
            checkin_time=checkin_utc,
            latitude=data.latitude,
            longitude=data.longitude,
            status=att_status,
            is_weekend=is_weekend,
            is_holiday=is_holiday,
        )
        await self.db.commit()
        att = await self.repo.get_by_id(att.id)
        return _attendance_response(att, site.timezone)

    # ── Check-out ─────────────────────────────────────────────────────────────

    async def checkout(self, current_user, data: CheckoutRequest) -> AttendanceResponse:
        att = await self.repo.get_open_for_user(current_user.id)
        if not att:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No open check-in found. Please check in first.",
            )

        site_tz = att.site.timezone if att.site else "Asia/Jakarta"
        now = _now_site(site_tz)
        checkout_utc = now.astimezone(utc)

        work_min = _work_duration(att.checkin_time, checkout_utc)
        # Weekend / holiday → all hours are overtime automatically (no approval needed)
        overtime_min = work_min if (att.is_weekend or att.is_holiday) else 0

        # ── Overtime auto-detection for regular weekday shifts ─────────────────
        if att.shift is not None and not (att.is_weekend or att.is_holiday):
            checkin_local = att.checkin_time.astimezone(ZoneInfo(site_tz))
            if att.shift.is_cross_midnight:
                shift_end_local = datetime.combine(
                    checkin_local.date() + timedelta(days=1),
                    att.shift.end_time,
                    tzinfo=ZoneInfo(site_tz),
                )
            else:
                shift_end_local = datetime.combine(
                    checkin_local.date(),
                    att.shift.end_time,
                    tzinfo=ZoneInfo(site_tz),
                )
            shift_end_utc = shift_end_local.astimezone(utc)

            if checkout_utc > shift_end_utc:
                overtime_min = max(0, int((checkout_utc - shift_end_utc).total_seconds() / 60))
                # Auto-create a PENDING overtime_request if none exists yet
                existing_ot = await self.ot_repo.get_active_for_attendance(att.id)
                if existing_ot is None:
                    await self.ot_repo.create(
                        user_id=current_user.id,
                        requested_start=shift_end_utc,
                        requested_end=checkout_utc,
                        attendance_id=att.id,
                    )

        att = await self.repo.checkout(
            att,
            checkout_time=checkout_utc,
            work_duration_minutes=work_min,
            auto_checkout=False,
            overtime_minutes=overtime_min,
        )
        # Re-fetch with full relationships (including overtime_requests) after commit
        att = await self.repo.get_by_id(att.id)
        return _attendance_response(att, site_tz)

    # ── Auto-checkout (background worker) ────────────────────────────────────

    async def run_auto_checkout(self) -> int:
        """
        Checkout all open attendance records whose shift end time has passed.
        Also applies a 16-hour safety fallback: any open record older than 16 hours
        is auto-checked-out at the shift end time (or check-in + 16h if no shift).
        Called by the background asyncio task every 60 s.
        Returns the count of records processed.
        """
        open_records = await self.repo.get_open_attendances()
        processed = 0
        now_utc = datetime.now(utc)

        for att in open_records:
            site_tz = att.site.timezone if att.site else "Asia/Jakarta"
            now_site = _now_site(site_tz)

            # ── 16-hour safety fallback ────────────────────────────────────────
            # If more than 16 hours have elapsed since check-in, force checkout
            # at the shift end time regardless of other conditions.
            hours_since_checkin = (now_utc - att.checkin_time).total_seconds() / 3600
            if hours_since_checkin >= 16:
                checkin_local = att.checkin_time.astimezone(ZoneInfo(site_tz))
                checkin_local_date: date = checkin_local.date()
                if att.shift is not None:
                    if att.shift.is_cross_midnight:
                        fallback_end_local = datetime.combine(
                            checkin_local_date + timedelta(days=1),
                            att.shift.end_time,
                            tzinfo=ZoneInfo(site_tz),
                        )
                    else:
                        fallback_end_local = datetime.combine(
                            checkin_local_date,
                            att.shift.end_time,
                            tzinfo=ZoneInfo(site_tz),
                        )
                    fallback_end_utc = fallback_end_local.astimezone(utc)
                else:
                    fallback_end_utc = att.checkin_time + timedelta(hours=16)
                work_min = _work_duration(att.checkin_time, fallback_end_utc)
                overtime_min = work_min if (att.is_weekend or att.is_holiday) else 0
                await self.repo.checkout(
                    att,
                    checkout_time=fallback_end_utc,
                    work_duration_minutes=work_min,
                    auto_checkout=True,
                    overtime_minutes=overtime_min,
                )
                processed += 1
                continue

            if att.shift is None:
                # Overtime-only check-in (no regular shift): use the approved OT end time
                active_ot = await self.ot_repo.get_approved_standalone_for_checkin(
                    att.user_id, att.checkin_time
                )
                if active_ot is None:
                    continue
                ot_end_utc = active_ot.requested_end
                if now_site >= ot_end_utc.astimezone(ZoneInfo(site_tz)):
                    work_min = _work_duration(att.checkin_time, ot_end_utc)
                    overtime_min = work_min
                    await self.repo.checkout(
                        att,
                        checkout_time=ot_end_utc,
                        work_duration_minutes=work_min,
                        auto_checkout=True,
                        overtime_minutes=overtime_min,
                    )
                    processed += 1
                continue

            # Determine the site-local date when the check-in occurred
            checkin_local = att.checkin_time.astimezone(ZoneInfo(site_tz))
            checkin_local_date = checkin_local.date()

            if att.shift.is_cross_midnight:
                # Shift ends on the day *after* check-in (in site-local time)
                shift_end_local = datetime.combine(
                    checkin_local_date + timedelta(days=1),
                    att.shift.end_time,
                    tzinfo=ZoneInfo(site_tz),
                )
            else:
                shift_end_local = datetime.combine(
                    checkin_local_date,
                    att.shift.end_time,
                    tzinfo=ZoneInfo(site_tz),
                )

            if now_site >= shift_end_local:
                shift_end_utc = shift_end_local.astimezone(utc)
                work_min = _work_duration(att.checkin_time, shift_end_utc)
                # Weekend/holiday auto-checkout still earns overtime
                overtime_min = work_min if (att.is_weekend or att.is_holiday) else 0
                await self.repo.checkout(
                    att,
                    checkout_time=shift_end_utc,
                    work_duration_minutes=work_min,
                    auto_checkout=True,
                    overtime_minutes=overtime_min,
                )
                processed += 1

        return processed

    # ── Queries ───────────────────────────────────────────────────────────────

    async def list_attendance(
        self,
        user_id: Optional[int] = None,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        att_status: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[AttendanceResponse]:
        records = await self.repo.get_all(
            user_id=user_id,
            from_date=from_date,
            to_date=to_date,
            status=att_status,
            limit=limit,
            offset=offset,
        )
        return [_attendance_response(r) for r in records]

    async def list_my_attendance(
        self,
        user_id: int,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        site_timezone: str = "UTC",
        limit: int = 50,
        offset: int = 0,
    ) -> List[AttendanceResponse]:
        records = await self.repo.get_by_user(
            user_id=user_id,
            from_date=from_date,
            to_date=to_date,
            site_timezone=site_timezone,
            limit=limit,
            offset=offset,
        )
        return [_attendance_response(r) for r in records]

    async def list_team_attendance(
        self,
        current_user,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        site_timezone: str = "UTC",
        limit: int = 500,
        offset: int = 0,
    ) -> List[TeamAttendanceRecord]:
        """Return attendance records for the supervisor's direct subordinates.
        ADMIN receives all records without restriction."""
        from app.repositories.user_repository import UserRepository

        role = current_user.role.name
        if role == "SUPERVISOR":
            user_ids = await UserRepository(self.db).get_subordinate_ids(current_user.id)
        else:  # ADMIN — no restriction
            user_ids = None

        records = await self.repo.get_team_attendance(
            user_ids=user_ids,
            from_date=from_date,
            to_date=to_date,
            site_timezone=site_timezone,
            limit=limit,
            offset=offset,
        )
        return [TeamAttendanceRecord.from_attendance(r) for r in records]

    async def get_attendance_by_id(
        self, attendance_id: int, current_user
    ) -> AttendanceResponse:
        att = await self.repo.get_by_id(attendance_id)
        if not att:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attendance record not found.",
            )
        # IDOR protection: EMPLOYEE can only view their own records
        if current_user.role.name == "EMPLOYEE" and att.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied.",
            )
        return _attendance_response(att)
