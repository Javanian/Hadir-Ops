"""
Per-employee attendance recap: day classification and access scope.
"""

from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.services.recap_service import DayInputs, count_days

asyncio_test = pytest.mark.asyncio(loop_scope="session")

JKT = ZoneInfo("Asia/Jakarta")


def _today() -> date:
    return datetime.now(JKT).date()


# ── Pure day rules ───────────────────────────────────────────────────────────

def test_day_rules():
    today = date(2026, 10, 15)
    days = [today - timedelta(days=i) for i in range(6, -1, -1)]  # 9th .. 15th
    sat, sun = date(2026, 10, 10), date(2026, 10, 11)
    workdays = set(days) - {sat, sun}
    c = count_days(days, DayInputs(
        workdays=workdays,
        attended={
            date(2026, 10, 9): "ONTIME",
            date(2026, 10, 10): "LATE",          # Saturday work still counts as present
            date(2026, 10, 12): "OUT_OF_RADIUS",
            date(2026, 10, 13): "EARLY",
        },
        leave={
            sun: "ANNUAL",                        # leave on a non-workday is not counted
            date(2026, 10, 13): "SICK",           # attended anyway: present wins
            date(2026, 10, 14): "PERMIT",
        },
        today=today,                              # no check-in yet today: not absent
    ))
    assert (c.workdays, c.present, c.ontime, c.late, c.out_of_radius) == (5, 4, 2, 1, 1)
    assert (c.sick, c.permit, c.annual, c.absent) == (0, 1, 0, 0)


def test_missing_past_workday_is_absent_without_notice():
    today = date(2026, 10, 15)
    days = [date(2026, 10, 13), date(2026, 10, 14), today]
    c = count_days(days, DayInputs(workdays=set(days), attended={}, leave={}, today=today))
    assert c.absent == 2
    assert c.absent_dates == [date(2026, 10, 13), date(2026, 10, 14)]
    assert c.workdays == 3


# ── Endpoint against MongoDB ─────────────────────────────────────────────────

async def _add_attendance(db, user_id, site_id, day, status, minutes=480, overtime=0):
    from app.db.ids import next_id

    checkin = datetime.combine(day, time(8, 0), tzinfo=JKT)
    await db.attendance.insert_one({
        "_id": await next_id(db, "attendance"), "user_id": user_id, "site_id": site_id,
        "checkin_time": checkin, "checkout_time": checkin + timedelta(minutes=minutes),
        "status": status, "work_date": day.isoformat(), "work_duration_minutes": minutes,
        "overtime_minutes": overtime, "risk_flags": [], "needs_review": False,
    })


@asyncio_test
async def test_recap_counts_presence_leave_holidays_and_absence(client, seed, mongo):
    today = _today()
    d = {i: today - timedelta(days=i) for i in range(7)}
    await _add_attendance(mongo, seed["emp_id"], seed["site_id"], d[6], "ONTIME", overtime=30)
    await _add_attendance(mongo, seed["emp_id"], seed["site_id"], d[5], "LATE")
    await mongo.leave_requests.insert_many([
        {"_id": 901, "user_id": seed["emp_id"], "leave_type": "SICK", "start_date": d[4].isoformat(),
         "end_date": d[3].isoformat(), "reason": "flu", "status": "APPROVED"},
        {"_id": 902, "user_id": seed["emp_id"], "leave_type": "ANNUAL", "start_date": d[1].isoformat(),
         "end_date": d[1].isoformat(), "reason": "x", "status": "REJECTED"},
    ])
    await mongo.holidays.insert_one({"_id": 901, "holiday_date": d[2].isoformat(), "description": "Libur"})

    r = await client.get(
        "/reports/recap",
        headers=seed["sup_a"],
        params={"from_date": d[6].isoformat(), "to_date": today.isoformat()},
    )
    assert r.status_code == 200, r.text
    rows = {row["employee_id"]: row for row in r.json()}
    assert set(rows) == {"EMP1", "EMP2"}

    emp = rows["EMP1"]
    # 7 days, one holiday -> 6 workdays; a rejected leave does not excuse d[1]
    assert emp["workdays"] == 6
    assert (emp["present"], emp["ontime"], emp["late"]) == (2, 1, 1)
    assert (emp["sick"], emp["permit"], emp["annual"]) == (2, 0, 0)
    assert emp["absent"] == 1
    assert emp["absent_dates"] == [d[1].isoformat()]
    assert (emp["work_minutes"], emp["overtime_minutes"]) == (960, 30)

    # Nothing on record: every past workday is absent, today is not.
    assert rows["EMP2"]["absent"] == 5
    assert rows["EMP2"]["present"] == 0


@asyncio_test
async def test_recap_scope_and_limits(client, seed):
    today = _today().isoformat()
    params = {"from_date": today, "to_date": today}

    r = await client.get("/reports/recap", headers=seed["sup_b"], params=params)
    assert r.status_code == 200 and r.json() == []

    r = await client.get("/reports/recap", headers=seed["admin"], params=params)
    assert sorted(x["employee_id"] for x in r.json()) == ["EMP1", "EMP2", "SUP1", "SUP2"]

    r = await client.get("/reports/recap", headers=seed["emp"], params=params)
    assert r.status_code == 403

    start = (_today() - timedelta(days=62)).isoformat()
    r = await client.get("/reports/recap", headers=seed["admin"], params={"from_date": start, "to_date": today})
    assert r.status_code == 422
