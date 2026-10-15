"""
Attendance recap per employee
=============================
For a date range, each employee gets one row: workdays, days present (on
time / late / outside the radius), sick / permit / annual leave days, days
absent without notice, worked minutes and overtime.

Day rules (all dates are site-local calendar dates):
  - A workday is a day whose day-of-week has a work schedule on one of the
    shifts of the employee's site (or of the assigned shift, on days covered
    by a temporary assignment), and that is not a holiday.
  - A day with a check-in counts as present, whatever else is on record.
  - A workday without a check-in but covered by APPROVED leave counts as that
    leave type. Leave on non-workdays is not counted.
  - A workday before today with neither counts as absent without notice.
    Today is never counted as absent: the day is not over yet.
"""

from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Dict, Iterable, List, Optional, Set
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from pymongo.asynchronous.database import AsyncDatabase

from app.db.documents import User
from app.db.relations import attach_user_sites
from app.repositories.assignment_repository import AssignmentRepository
from app.repositories.leave_repository import LeaveRepository
from app.repositories.shift_repository import ShiftRepository
from app.schemas.recap import RecapRow

MAX_RANGE_DAYS = 62


def db_dow(d: date) -> int:
    """DB day_of_week: 0=Sunday … 6=Saturday."""
    return (d.weekday() + 1) % 7


@dataclass
class DayInputs:
    workdays: Set[date]
    attended: Dict[date, Optional[str]]  # date -> attendance status
    leave: Dict[date, str]               # date -> leave type (approved only)
    today: date


@dataclass
class DayCounts:
    workdays: int = 0
    present: int = 0
    ontime: int = 0
    late: int = 0
    out_of_radius: int = 0
    sick: int = 0
    permit: int = 0
    annual: int = 0
    absent: int = 0
    absent_dates: List[date] = field(default_factory=list)


def count_days(days: Iterable[date], inp: DayInputs) -> DayCounts:
    c = DayCounts()
    for d in days:
        is_workday = d in inp.workdays
        if is_workday and d <= inp.today:
            c.workdays += 1
        if d in inp.attended:
            c.present += 1
            st = inp.attended[d]
            if st in ("ONTIME", "EARLY"):
                c.ontime += 1
            elif st == "LATE":
                c.late += 1
            elif st == "OUT_OF_RADIUS":
                c.out_of_radius += 1
            continue
        if not is_workday:
            continue
        leave_type = inp.leave.get(d)
        if leave_type == "SICK":
            c.sick += 1
        elif leave_type == "PERMIT":
            c.permit += 1
        elif leave_type == "ANNUAL":
            c.annual += 1
        elif d < inp.today:
            c.absent += 1
            c.absent_dates.append(d)
    return c


def _date_range(start: date, end: date) -> List[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


class RecapService:
    def __init__(self, db: AsyncDatabase):
        self.db = db

    async def _users_in_scope(self, current_user) -> List[User]:
        query: dict = {"is_active": True, "role": {"$ne": "ADMIN"}}
        if current_user.role.name == "SUPERVISOR":
            query["supervisor_id"] = current_user.id
        users = [User.from_doc(d) async for d in self.db.users.find(query).sort("name", 1)]
        await attach_user_sites(self.db, users)
        return users

    async def recap(self, current_user, from_date: date, to_date: date) -> List[RecapRow]:
        if to_date < from_date:
            raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "to_date must be on or after from_date.")
        if (to_date - from_date).days + 1 > MAX_RANGE_DAYS:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                f"A recap covers at most {MAX_RANGE_DAYS} days.",
            )

        users = await self._users_in_scope(current_user)
        if not users:
            return []
        user_ids = [u.id for u in users]
        days = _date_range(from_date, to_date)

        # Scheduled days of week per shift, and the shifts of each site
        shift_repo = ShiftRepository(self.db)
        shifts = await shift_repo.get_all()
        shift_dows = {s.id: {ws.day_of_week for ws in s.work_schedules} for s in shifts}
        site_dows: Dict[int, Set[int]] = {}
        for s in shifts:
            site_dows.setdefault(s.site_id, set()).update(shift_dows[s.id])

        holidays = await shift_repo.holiday_dates_between(from_date, to_date)
        assignments = await AssignmentRepository(self.db).active_between(user_ids, from_date, to_date)
        leaves = await LeaveRepository(self.db).approved_between(user_ids, from_date, to_date)

        # Only the fields the recap needs; work_date is the site-local day.
        att_rows = self.db.attendance.find(
            {
                "user_id": {"$in": user_ids},
                # $type lets the planner use the partial (user_id, work_date) index
                "work_date": {"$type": "string", "$gte": from_date.isoformat(), "$lte": to_date.isoformat()},
            },
            {"user_id": 1, "work_date": 1, "status": 1, "work_duration_minutes": 1,
             "overtime_minutes": 1, "needs_review": 1},
        )

        attended: Dict[int, Dict[date, Optional[str]]] = {uid: {} for uid in user_ids}
        minutes: Dict[int, List[int]] = {uid: [0, 0, 0] for uid in user_ids}  # work, overtime, review
        async for r in att_rows:
            attended[r["user_id"]][date.fromisoformat(r["work_date"])] = r.get("status")
            m = minutes[r["user_id"]]
            m[0] += r.get("work_duration_minutes") or 0
            m[1] += r.get("overtime_minutes") or 0
            m[2] += 1 if r.get("needs_review") else 0

        leave_days: Dict[int, Dict[date, str]] = {uid: {} for uid in user_ids}
        for lv in leaves:
            d = max(lv.start_date, from_date)
            while d <= min(lv.end_date, to_date):
                leave_days[lv.user_id][d] = lv.leave_type
                d += timedelta(days=1)

        rows: List[RecapRow] = []
        for u in users:
            tz = u.site.timezone if u.site else "Asia/Jakarta"
            today = datetime.now(ZoneInfo(tz)).date()
            base_dows = site_dows.get(u.site_id, set())
            user_assignments = [a for a in assignments if a.user_id == u.id]

            workdays: Set[date] = set()
            for d in days:
                if d in holidays:
                    continue
                active = next((a for a in user_assignments if a.start_date <= d <= a.end_date), None)
                dows = shift_dows.get(active.shift_id, set()) if active else base_dows
                if db_dow(d) in dows:
                    workdays.add(d)

            c = count_days(days, DayInputs(workdays, attended[u.id], leave_days[u.id], today))
            work_min, ot_min, review = minutes[u.id]
            rows.append(RecapRow(
                user_id=u.id,
                employee_id=u.employee_id,
                name=u.name,
                role=u.role.name,
                site_name=u.site.name if u.site else None,
                workdays=c.workdays,
                present=c.present,
                ontime=c.ontime,
                late=c.late,
                out_of_radius=c.out_of_radius,
                sick=c.sick,
                permit=c.permit,
                annual=c.annual,
                absent=c.absent,
                absent_dates=c.absent_dates,
                work_minutes=work_min,
                overtime_minutes=ot_min,
                needs_review=review,
            ))
        return rows
