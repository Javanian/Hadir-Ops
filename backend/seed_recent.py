"""
seed_recent.py — Generates realistic attendance records for the last 7 days.

Patterns per employee per day:
  ~10% absent (no record)
  ~70% ONTIME  — checkin 06:40–07:15 local
  ~15% LATE    — checkin 07:16–08:45 local
   ~5% OUT_OF_RADIUS — checkin at correct time but GPS outside radius
  ~10% no checkout (forgot / still on shift)
  ~30% overtime (checkout after 17:00)

All timestamps stored as UTC using ZoneInfo.

Usage (inside backend container):
    python seed_recent.py
    SEED_TODAY=2026-03-11 python seed_recent.py   # fixed window
"""

import asyncio
import hashlib
import os
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from datetime import timezone as dt_tz

from sqlalchemy import select, text, func

from app.core.database import AsyncSessionLocal
from app.models.models import Attendance, Shift, Site, User

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

# The last DAYS_BACK days up to today. Set SEED_TODAY=YYYY-MM-DD for a fixed,
# reproducible window (e.g. for screenshots).
TODAY = date.fromisoformat(os.environ["SEED_TODAY"]) if os.environ.get("SEED_TODAY") else date.today()
DAYS_BACK = 7   # TODAY inclusive

SHIFT_START_H, SHIFT_START_M = 7, 0    # 07:00 local
SHIFT_END_H,   SHIFT_END_M   = 17, 0   # 17:00 local
LATE_TOLERANCE_MIN = 15                 # 15 min grace → late threshold 07:15

UTC = dt_tz.utc

# ---------------------------------------------------------------------------
# Deterministic "random" from a seed string — no random module needed
# ---------------------------------------------------------------------------

def _hash_int(s: str, modulo: int) -> int:
    """Deterministic integer 0..modulo-1 derived from a string."""
    return int(hashlib.sha256(s.encode()).hexdigest(), 16) % modulo


def _hash_float(s: str) -> float:
    """Deterministic float 0.0..1.0 derived from a string."""
    return _hash_int(s, 10_000_000) / 10_000_000


def _choice(s: str, options: list):
    return options[_hash_int(s, len(options))]


# ---------------------------------------------------------------------------
# Day-of-week helpers (DB convention: 0=Sun … 6=Sat)
# ---------------------------------------------------------------------------

def _python_to_db_dow(d: date) -> int:
    return (d.weekday() + 1) % 7   # Mon=1, Sat=6, Sun=0


def _is_weekend(d: date) -> bool:
    db_dow = _python_to_db_dow(d)
    return db_dow in {0, 6}    # Sun or Sat


# ---------------------------------------------------------------------------
# Build one attendance scenario for (employee_id, date, site_tz)
# Returns None → absent (skip record)
# ---------------------------------------------------------------------------

def _build_scenario(emp_id: str, d: date, site_tz: str) -> dict | None:
    seed_base = f"{emp_id}|{d.isoformat()}"
    weekend = _is_weekend(d)

    # --- Absence probability ---
    absence_threshold = 0.35 if weekend else 0.10
    if _hash_float(seed_base + "|absent") < absence_threshold:
        return None   # absent today

    tz = ZoneInfo(site_tz)

    # --- Status ---
    r_status = _hash_float(seed_base + "|status")
    if weekend:
        # Weekends: mostly ONTIME (coming in for overtime), rarely late/oob
        if r_status < 0.80:
            status = "ONTIME"
        elif r_status < 0.93:
            status = "LATE"
        else:
            status = "OUT_OF_RADIUS"
    else:
        if r_status < 0.68:
            status = "ONTIME"
        elif r_status < 0.88:
            status = "LATE"
        else:
            status = "OUT_OF_RADIUS"

    # --- Check-in time (local) ---
    if status == "ONTIME":
        # 06:40 to 07:15
        ci_min_offset = _hash_int(seed_base + "|ci", 36)   # 0..35 min
        ci_local_minutes = (6 * 60 + 40) + ci_min_offset   # 400..435
    elif status == "LATE":
        # 07:16 to 08:45
        ci_min_offset = _hash_int(seed_base + "|ci", 90)   # 0..89 min
        ci_local_minutes = (7 * 60 + 16) + ci_min_offset   # 436..525
    else:  # OUT_OF_RADIUS — check-in time same as ONTIME
        ci_min_offset = _hash_int(seed_base + "|ci", 30)
        ci_local_minutes = (6 * 60 + 50) + ci_min_offset   # 410..439

    ci_h = ci_local_minutes // 60
    ci_m = ci_local_minutes % 60

    # --- Check-out time (local) ---
    # ~12% chance of no checkout (especially on today's records)
    no_checkout_threshold = 0.30 if d == TODAY else 0.08
    has_checkout = _hash_float(seed_base + "|has_co") >= no_checkout_threshold

    if has_checkout:
        # 16:30 to 19:30 (some overtime)
        co_min_offset = _hash_int(seed_base + "|co", 181)  # 0..180 min
        co_local_minutes = (16 * 60 + 30) + co_min_offset  # 990..1170
        co_h = co_local_minutes // 60
        co_m = co_local_minutes % 60
    else:
        co_h, co_m = None, None

    # --- Build UTC datetimes ---
    ci_local = datetime(d.year, d.month, d.day, ci_h, ci_m, 0, tzinfo=tz)
    ci_utc = ci_local.astimezone(UTC)

    if co_h is not None:
        co_local = datetime(d.year, d.month, d.day, co_h % 24, co_m, 0, tzinfo=tz)
        # If checkout crosses midnight (hours >= 24 is impossible here, max 19:30)
        co_utc = co_local.astimezone(UTC)
    else:
        co_utc = None

    # --- Work duration ---
    if co_utc:
        work_min = max(0, int((co_utc - ci_utc).total_seconds() / 60))
    else:
        work_min = 0

    # --- Overtime minutes ---
    shift_end_local = datetime(d.year, d.month, d.day, SHIFT_END_H, SHIFT_END_M, tzinfo=tz)
    shift_end_utc = shift_end_local.astimezone(UTC)

    if weekend:
        overtime_min = work_min   # entire shift is overtime on weekends
    elif co_utc and co_utc > shift_end_utc:
        overtime_min = int((co_utc - shift_end_utc).total_seconds() / 60)
    else:
        overtime_min = 0

    # --- GPS ---
    in_radius = (status != "OUT_OF_RADIUS")

    return {
        "status": status,
        "checkin_utc": ci_utc,
        "checkout_utc": co_utc,
        "work_duration_minutes": work_min,
        "overtime_minutes": overtime_min,
        "is_weekend": weekend,
        "in_radius": in_radius,
    }


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

async def seed_recent():
    async with AsyncSessionLocal() as db:

        # Fetch site data
        result = await db.execute(select(Site).where(
            Site.name.in_(["Site Jakarta", "Site Makassar", "Site Jayapura"])
        ))
        sites: dict[int, Site] = {s.id: s for s in result.scalars().all()}

        # Fetch shift for each site
        result = await db.execute(select(Shift).where(Shift.site_id.in_(list(sites.keys()))))
        shifts: dict[int, Shift] = {sh.site_id: sh for sh in result.scalars().all()}

        if not sites or not shifts:
            print("ERROR: Sites or shifts not found. Run seed.py first.")
            return

        # Fetch all employees + supervisors from these sites
        result = await db.execute(
            select(User).where(User.site_id.in_(list(sites.keys())), User.is_active == True)
        )
        users = result.scalars().all()
        print(f"Found {len(users)} active users across 3 sites.")

        # Date range
        date_range: list[date] = [
            TODAY - timedelta(days=i) for i in range(DAYS_BACK - 1, -1, -1)
        ]
        print(f"Date range: {date_range[0].isoformat()} → {date_range[-1].isoformat()}")

        inserted = 0
        skipped_exists = 0
        skipped_absent = 0
        errors = 0

        for user in users:
            site = sites.get(user.site_id)
            shift = shifts.get(user.site_id)
            if not site or not shift:
                continue

            for d in date_range:
                # Check for existing record (search by UTC range for this site's calendar day)
                tz = ZoneInfo(site.timezone)
                day_start_local = datetime(d.year, d.month, d.day, 0, 0, 0, tzinfo=tz)
                day_end_local   = datetime(d.year, d.month, d.day, 23, 59, 59, tzinfo=tz)
                day_start_utc = day_start_local.astimezone(UTC)
                day_end_utc   = day_end_local.astimezone(UTC)

                existing = await db.execute(
                    select(Attendance).where(
                        Attendance.user_id == user.id,
                        Attendance.checkin_time >= day_start_utc,
                        Attendance.checkin_time <= day_end_utc,
                    )
                )
                if existing.scalar_one_or_none():
                    skipped_exists += 1
                    continue

                scenario = _build_scenario(user.employee_id, d, site.timezone)
                if scenario is None:
                    skipped_absent += 1
                    continue

                # GPS offset for out-of-radius records
                lat = site.latitude + (0.005 if not scenario["in_radius"] else 0.0)
                lon = site.longitude + (0.005 if not scenario["in_radius"] else 0.0)

                try:
                    db.add(Attendance(
                        user_id=user.id,
                        site_id=site.id,
                        shift_id=shift.id,
                        checkin_time=scenario["checkin_utc"],
                        checkout_time=scenario["checkout_utc"],
                        auto_checkout=False,
                        latitude=lat,
                        longitude=lon,
                        work_duration_minutes=scenario["work_duration_minutes"],
                        overtime_minutes=scenario["overtime_minutes"],
                        is_weekend=scenario["is_weekend"],
                        is_holiday=False,
                        status=scenario["status"],
                        work_date=d,
                    ))
                    inserted += 1
                except Exception as e:
                    print(f"    ERROR {user.employee_id} {d}: {e}")
                    errors += 1

            await db.commit()

        print()
        print("=" * 56)
        print("✅ seed_recent complete!")
        print(f"   Inserted : {inserted}")
        print(f"   Absent   : {skipped_absent}")
        print(f"   Existed  : {skipped_exists}")
        if errors:
            print(f"   Errors   : {errors}")
        print("=" * 56)


if __name__ == "__main__":
    asyncio.run(seed_recent())
