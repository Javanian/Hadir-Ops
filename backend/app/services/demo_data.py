"""
Sample dataset for the public demo and for local development
=============================================================
A fictional company, Acme Field Services, with four sites on three continents
and a field office in UTC for demo visitors. Attendance, overtime, leave and the
review queue are generated for the two weeks before `now`, so the dashboard
always shows recent activity whenever the data was generated.

Generation is deterministic for a given day: the same date gives the same
people, times and flags.

    seed_dataset(db, now, password=None)   # empty database expected
"""

import random
import secrets
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, UTC
from zoneinfo import ZoneInfo

from pymongo.asynchronous.database import AsyncDatabase

from app.core.security import get_password_hash
from app.db.documents import encode
from app.db.ids import next_id
from app.services import checkin_rules as rules

DEMO_DOMAIN = "demo.rollproof.app"
ADMIN_EMAIL = f"admin@{DEMO_DOMAIN}"
SUPERVISOR_EMAIL = f"supervisor@{DEMO_DOMAIN}"
# Demo visitors who sign in as an employee get an account at this site. Its
# three shifts cover the whole day, so a check-in works at any hour.
VISITOR_SITE = "Greenwich Field Office"

HISTORY_DAYS = 14
WEEKDAYS = (1, 2, 3, 4, 5)          # 0 = Sunday … 6 = Saturday
MON_TO_SAT = (1, 2, 3, 4, 5, 6)
EVERY_DAY = (0, 1, 2, 3, 4, 5, 6)


@dataclass(frozen=True)
class ShiftPlan:
    name: str
    start: time
    end: time
    days: tuple[int, ...]
    tolerance_min: int = 10

    @property
    def cross_midnight(self) -> bool:
        return self.end <= self.start


@dataclass(frozen=True)
class SitePlan:
    name: str
    lat: float
    lon: float
    radius_m: int
    tz: str
    shifts: tuple[ShiftPlan, ...]
    supervisor: tuple[str, str]       # (employee id, name)
    employees: tuple[str, ...]


SITES = (
    SitePlan(
        "Rotterdam Port Terminal", 51.9490, 4.1420, 250, "Europe/Amsterdam",
        (ShiftPlan("Day", time(7, 0), time(15, 30), WEEKDAYS),),
        ("SPV001", "Sofia Martins"),
        ("Lars de Vries", "Amira Haddad", "Tomasz Nowak", "Eva Jansen", "Kwame Mensah", "Noor Bakker"),
    ),
    SitePlan(
        "Jakarta Assembly Plant", -6.2297, 106.8295, 200, "Asia/Jakarta",
        (
            ShiftPlan("Morning", time(7, 0), time(15, 0), MON_TO_SAT, 15),
            ShiftPlan("Afternoon", time(15, 0), time(23, 0), MON_TO_SAT, 15),
        ),
        ("SPV002", "Budi Santoso"),
        ("Siti Rahma", "Agus Pratama", "Dewi Lestari", "Rizky Hidayat", "Putri Anggraini", "Fajar Nugroho"),
    ),
    SitePlan(
        "Houston Distribution Center", 29.7499, -95.3584, 300, "America/Chicago",
        (ShiftPlan("Day", time(8, 0), time(16, 30), WEEKDAYS),),
        ("SPV003", "Daniel Okafor"),
        ("Maria Gonzalez", "James Carter", "Linh Nguyen", "Carlos Rivera", "Ashley Brooks"),
    ),
    SitePlan(
        "Singapore Service Hub", 1.2966, 103.7764, 150, "Asia/Singapore",
        (ShiftPlan("Day", time(9, 0), time(18, 0), WEEKDAYS),),
        ("SPV004", "Mei Lin Tan"),
        ("Arjun Raman", "Hui Min Lee", "Farah Aziz", "Wei Jie Ong"),
    ),
    SitePlan(
        VISITOR_SITE, 51.4779, -0.0015, 150, "UTC",
        (
            ShiftPlan("Early", time(6, 0), time(14, 0), EVERY_DAY, 15),
            ShiftPlan("Late", time(14, 0), time(22, 0), EVERY_DAY, 15),
            ShiftPlan("Night", time(22, 0), time(6, 0), EVERY_DAY, 15),
        ),
        ("SPV005", "Oliver Bennett"),
        ("Grace Wilson", "Mohammed Ali"),
    ),
)

# Risk flags of records that went to the review queue, with a note a
# supervisor would write when deciding on them.
_REVIEW_CASES = (
    ([rules.LOW_GPS_ACCURACY], "Inside the warehouse, GPS was weak. Confirmed with the shift lead."),
    ([rules.OFFLINE_SYNC, rules.CLOCK_UNVERIFIED], "No signal in the basement; delivered when back upstairs."),
    ([rules.FACE_NOT_VERIFIED, rules.OFFLINE_SYNC], "Checked in offline; badge log confirms arrival."),
    ([rules.MOCK_LOCATION], "Mock location app was active. Please uninstall it."),
)

_LEAVE_PLAN = (
    # (offset from today, days, type, status, reason, review note)
    (0, 2, "SICK", "APPROVED", "Fever, doctor's note from the clinic", None),
    (-4, 1, "PERMIT", "APPROVED", "Renewing my driving licence", None),
    (2, 1, "PERMIT", "PENDING", "My daughter's graduation ceremony", None),
    (8, 5, "ANNUAL", "PENDING", "Family visit abroad", None),
    (0, 3, "ANNUAL", "APPROVED", "Long weekend with family", None),
    (5, 2, "ANNUAL", "REJECTED", "Short trip", "Clashes with the safety audit; please pick the week after."),
    (1, 1, "SICK", "PENDING", "Dentist appointment", None),
    (-7, 1, "PERMIT", "CANCELLED", "Bank appointment", None),
)


def _email(name: str) -> str:
    return f"{name.lower().replace(' ', '.')}@{DEMO_DOMAIN}"


def _password_hash(password: str | None) -> str:
    # Without a password (public demo) nobody can sign in except through the
    # one-click demo login, so a wrong guess can never lock a demo account.
    return get_password_hash(password or secrets.token_urlsafe(24))


def _user_doc(user_id, employee_id, name, email, password_hash, role, site_id, supervisor_id, now) -> dict:
    return {
        "_id": user_id, "employee_id": employee_id, "name": name, "email": email,
        "password_hash": password_hash, "role": role, "site_id": site_id,
        "supervisor_id": supervisor_id, "face_embedding": None, "face_model": None,
        "is_active": True, "failed_login_attempts": 0, "locked_until": None,
        "password_changed_at": None, "created_at": now,
    }


def _db_dow(d: date) -> int:
    return (d.weekday() + 1) % 7


class _Generator:
    def __init__(self, db: AsyncDatabase, now: datetime):
        self.db = db
        self.now = now
        self.sites: dict[str, dict] = {}
        self.shifts: dict[int, list[tuple[ShiftPlan, dict]]] = {}

    async def site(self, plan: SitePlan) -> dict:
        doc = {
            "_id": await next_id(self.db, "sites"), "name": plan.name, "latitude": plan.lat,
            "longitude": plan.lon, "radius_meter": plan.radius_m, "timezone": plan.tz, "created_at": self.now,
        }
        await self.db.sites.insert_one(doc)
        self.sites[plan.name] = doc
        self.shifts[doc["_id"]] = []
        for sp in plan.shifts:
            shift = encode({
                "_id": await next_id(self.db, "shifts"), "site_id": doc["_id"], "name": sp.name,
                "start_time": sp.start, "end_time": sp.end, "is_cross_midnight": sp.cross_midnight,
                "work_hours_standard": 8, "created_at": self.now,
                "work_schedules": [
                    {"id": await next_id(self.db, "work_schedules"), "day_of_week": dow,
                     "toleransi_telat_menit": sp.tolerance_min}
                    for dow in sp.days
                ],
            })
            await self.db.shifts.insert_one(shift)
            self.shifts[doc["_id"]].append((sp, shift))
        return doc

    async def attendance(self, user: dict, site: dict, rng: random.Random, reviewer_id: int | None,
                         leave_days: set[date], skip_days: int = 0) -> int:
        """Two weeks of attendance for one person, leaving out the last `skip_days`
        days. Returns the number of records."""
        tz = ZoneInfo(site["timezone"])
        local_now = self.now.astimezone(tz)
        shift_options = self.shifts[site["_id"]]
        # Everyone keeps one shift, as a roster would assign it
        plan, shift = shift_options[user["_id"] % len(shift_options)]
        count = 0
        for back in range(HISTORY_DAYS - 1, skip_days - 1, -1):
            day = local_now.date() - timedelta(days=back)
            if _db_dow(day) not in plan.days or day in leave_days:
                continue
            roll = rng.random()
            if roll < 0.04:
                continue  # absent without notice: shows up in the recap
            late = roll > 0.84
            start = datetime.combine(day, plan.start, tzinfo=tz)
            offset = rng.randint(plan.tolerance_min + 1, 70) if late else rng.randint(-25, plan.tolerance_min)
            checkin = start + timedelta(minutes=offset)
            if checkin > local_now:
                continue

            end = datetime.combine(day + timedelta(days=1 if plan.cross_midnight else 0), plan.end, tzinfo=tz)
            overtime = rng.random() < 0.10
            checkout = end + timedelta(minutes=rng.randint(60, 150) if overtime else rng.randint(-5, 20))
            if checkout > local_now:
                checkout = None  # still on shift

            dow = _db_dow(day)
            is_weekend = dow in (0, 6)
            worked = int((checkout - checkin).total_seconds() // 60) if checkout else 0
            if not checkout:
                overtime_min = 0
            elif is_weekend:
                overtime_min = worked
            else:
                overtime_min = max(0, int((checkout - end).total_seconds() // 60))

            outside = user["role"] != "SALES" and rng.random() < 0.03
            status = "OUT_OF_RADIUS" if outside else ("LATE" if late else "ONTIME")
            flags: list[str] = []
            review_status = review_note = reviewed_by = reviewed_at = None
            needs_review = False
            accuracy = round(rng.uniform(4, 25), 1)
            similarity = round(rng.uniform(0.55, 0.86), 3)
            received = checkin
            if rng.random() < 0.07:
                flags, note = rng.choice(_REVIEW_CASES)
                flags = list(flags)
                if rules.LOW_GPS_ACCURACY in flags:
                    accuracy = round(rng.uniform(80, 140), 1)
                if rules.FACE_NOT_VERIFIED in flags:
                    similarity = None
                if rules.OFFLINE_SYNC in flags:
                    received = checkin + timedelta(minutes=rng.randint(40, 180))
                if back <= 3 or reviewer_id is None:
                    needs_review = True
                else:
                    review_status = "REJECTED" if rules.MOCK_LOCATION in flags else "APPROVED"
                    review_note, reviewed_by = note, reviewer_id
                    reviewed_at = (received + timedelta(hours=rng.randint(2, 20))).astimezone(UTC)

            drift = 0.01 if outside else rng.uniform(-0.0004, 0.0004)
            att_id = await next_id(self.db, "attendance")
            await self.db.attendance.insert_one({
                "_id": att_id, "user_id": user["_id"], "site_id": site["_id"], "shift_id": shift["_id"],
                "checkin_time": checkin.astimezone(UTC),
                "checkout_time": checkout.astimezone(UTC) if checkout else None,
                "auto_checkout": False,
                "latitude": site["latitude"] + drift, "longitude": site["longitude"] + drift,
                "work_duration_minutes": worked, "overtime_minutes": overtime_min,
                "is_weekend": is_weekend, "is_holiday": False, "status": status,
                "work_date": day.isoformat(), "created_at": received.astimezone(UTC),
                "captured_at": checkin.astimezone(UTC), "received_at": received.astimezone(UTC),
                "gps_accuracy_m": accuracy, "is_offline": rules.OFFLINE_SYNC in flags,
                "face_similarity": similarity, "risk_flags": flags, "needs_review": needs_review,
                "review_status": review_status, "review_note": review_note,
                "reviewed_by": reviewed_by, "reviewed_at": reviewed_at,
            })
            count += 1

            if overtime_min and not is_weekend and rng.random() < 0.6:
                # Older requests are decided; the last two days still wait
                state = rng.choice(("APPROVED", "APPROVED", "APPROVED", "REJECTED")) if back > 2 else "PENDING"
                await self.db.overtime_requests.insert_one({
                    "_id": await next_id(self.db, "overtime_requests"),
                    "user_id": user["_id"], "attendance_id": att_id,
                    "requested_start": end.astimezone(UTC), "requested_end": checkout.astimezone(UTC),
                    "approved_by": reviewer_id if state != "PENDING" else None, "status": state,
                    "notes": rng.choice((
                        "Late container arrival, finished unloading",
                        "Covering for a colleague on sick leave",
                        "Month-end stock count",
                        "Machine breakdown, stayed for the repair",
                    )),
                    "supervisor_notes": {"APPROVED": "Approved, thanks", "REJECTED": "Not pre-agreed"}.get(state),
                    "created_at": checkout.astimezone(UTC),
                })
        return count


async def seed_dataset(db: AsyncDatabase, now: datetime | None = None, password: str | None = None) -> dict:
    """Fill an empty database with the sample company. With `password`, every
    named account can sign in with it (local development); without it, only
    the one-click demo login can sign in. Returns counts for the summary."""
    now = now or datetime.now(UTC)
    rng = random.Random(now.date().toordinal())
    gen = _Generator(db, now)
    pw_hash = _password_hash(password)
    today = now.date()

    admin_id = await next_id(db, "users")
    await db.users.insert_one(_user_doc(admin_id, "ADM001", "Morgan Lee", ADMIN_EMAIL, pw_hash, "ADMIN", None, None, now))

    people: list[tuple[dict, dict, int]] = []   # (user, site, supervisor id)
    emp_no = 100
    for plan in SITES:
        site = await gen.site(plan)
        spv_code, spv_name = plan.supervisor
        spv_email = SUPERVISOR_EMAIL if spv_code == "SPV001" else _email(spv_name)
        spv = _user_doc(await next_id(db, "users"), spv_code, spv_name, spv_email, pw_hash,
                        "SUPERVISOR", site["_id"], None, now)
        await db.users.insert_one(spv)
        for name in plan.employees:
            emp_no += 1
            emp = _user_doc(await next_id(db, "users"), f"EMP{emp_no}", name, _email(name), pw_hash,
                            "EMPLOYEE", site["_id"], spv["_id"], now)
            await db.users.insert_one(emp)
            people.append((emp, site, spv["_id"]))
        people.append((spv, site, admin_id))

    # Field sales work anywhere: their check-ins skip the site radius
    for code, name, site_name in (("SAL001", "Isabella Rossi", "Rotterdam Port Terminal"),
                                  ("SAL002", "Ethan Walker", "Houston Distribution Center")):
        site = gen.sites[site_name]
        sales = _user_doc(await next_id(db, "users"), code, name, _email(name), pw_hash,
                          "SALES", site["_id"], None, now)
        await db.users.insert_one(sales)
        people.append((sales, site, admin_id))

    # Leave first, so nobody has attendance on a day they were away
    leave_days: dict[int, set[date]] = {}
    employees = [p for p in people if p[0]["role"] == "EMPLOYEE"]
    for (emp, _, spv_id), (offset, days, kind, state, reason, note) in zip(employees[::3], _LEAVE_PLAN, strict=False):
        start = today + timedelta(days=offset)
        end = start + timedelta(days=days - 1)
        decided = state in ("APPROVED", "REJECTED")
        await db.leave_requests.insert_one(encode({
            "_id": await next_id(db, "leave_requests"), "user_id": emp["_id"], "leave_type": kind,
            "start_date": start, "end_date": end, "reason": reason, "status": state,
            "reviewed_by": spv_id if decided else None, "reviewed_at": now if decided else None,
            "review_note": note, "created_at": now - timedelta(days=max(1, -offset + 1)),
        }))
        if state == "APPROVED":
            leave_days[emp["_id"]] = {start + timedelta(days=i) for i in range(days)}

    records = 0
    for user, site, reviewer in people:
        records += await gen.attendance(user, site, rng, reviewer, leave_days.get(user["_id"], set()))

    # A few failed attempts, so a supervisor can see why someone has no record
    for (user, _, _), reason, detail in zip(employees[1::5], ("NO_GPS", "FACE_MISMATCH", "NETWORK"), (
        "Location permission denied", "Face did not match the enrolled face", "Request timed out",
    ), strict=False):
        await db.checkin_attempts.insert_one({
            "_id": await next_id(db, "checkin_attempts"), "user_id": user["_id"],
            "client_event_id": secrets.token_hex(16), "kind": "CHECKIN", "reason": reason,
            "detail": detail, "captured_at": now - timedelta(days=1, hours=2), "received_at": now - timedelta(days=1),
        })

    # Weekday overtime agreed in advance, and a company holiday next week
    planner, _, planner_spv = employees[0]
    ot_start = datetime.combine(today + timedelta(days=3), time(16, 0), tzinfo=UTC)
    await db.overtime_requests.insert_one({
        "_id": await next_id(db, "overtime_requests"), "user_id": planner["_id"], "attendance_id": None,
        "requested_start": ot_start, "requested_end": ot_start + timedelta(hours=3), "approved_by": None,
        "status": "PENDING", "notes": "Vessel arrives late on Thursday", "supervisor_notes": None, "created_at": now,
    })
    await db.holidays.insert_one(encode({
        "_id": await next_id(db, "holidays"), "holiday_date": today + timedelta(days=9),
        "description": "Founders' Day (company holiday)", "is_national": False,
    }))

    # A temporary transfer: one Jakarta technician supports Singapore next week
    jakarta = gen.sites["Jakarta Assembly Plant"]
    singapore = gen.sites["Singapore Service Hub"]
    transfer = next(u for u, s, _ in employees if s["_id"] == jakarta["_id"])
    await db.temporary_assignments.insert_one(encode({
        "_id": await next_id(db, "temporary_assignments"), "user_id": transfer["_id"],
        "site_id": singapore["_id"], "shift_id": gen.shifts[singapore["_id"]][0][1]["_id"],
        "start_date": today + timedelta(days=4), "end_date": today + timedelta(days=10),
        "notes": "Commissioning support for the new line", "created_by": admin_id, "created_at": now,
    }))

    return {"sites": len(SITES), "people": len(people) + 1, "attendance": records}


async def add_visitor(db: AsyncDatabase, now: datetime | None = None) -> dict:
    """A new employee account for one demo visitor, with a few days of history
    and today left open so they can check in themselves."""
    now = now or datetime.now(UTC)
    site = await db.sites.find_one({"name": VISITOR_SITE})
    supervisor = await db.users.find_one({"email": SUPERVISOR_EMAIL})
    if site is None or supervisor is None:
        raise LookupError("The demo dataset is missing; it is restored at the next reset.")
    gen = _Generator(db, now)
    gen.sites[site["name"]] = site
    # Day shifts only, and nothing from the last two days: a visitor can be in
    # any time zone, and a record must never look like their own "today".
    gen.shifts[site["_id"]] = [
        (ShiftPlan(s["name"], time.fromisoformat(s["start_time"]), time.fromisoformat(s["end_time"]),
                   tuple(ws["day_of_week"] for ws in s["work_schedules"])), s)
        async for s in db.shifts.find({"site_id": site["_id"], "is_cross_midnight": False}).sort("_id", 1)
    ]
    user_id = await next_id(db, "users")
    tag = f"{user_id:04d}"
    user = _user_doc(user_id, f"VIS{tag}", f"Demo Visitor {tag}", f"visitor-{tag}@{DEMO_DOMAIN}",
                     _password_hash(None), "EMPLOYEE", site["_id"], supervisor["_id"], now)
    await db.users.insert_one(user)
    await gen.attendance(user, site, random.Random(user_id), None, set(), skip_days=2)
    return user
