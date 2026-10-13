"""
seed.py — Run this after the database is initialized to create initial data.

Creates:
  • Roles (ADMIN / SUPERVISOR / EMPLOYEE)
  • Original test site "Kantor Pusat" + 3 timezone-representative sites
  • Shifts + work schedules for each new site
  • Original test users (admin / supervisor / employee)
  • 5 supervisors + 5 employees with @example.com emails
  • 10 attendance records per employee (Jan 1–10, 2026)

Usage:
    python seed.py

Requires: DATABASE_URL in .env pointing to a running PostgreSQL instance
with the schema from database.sql already applied.
"""

import asyncio
import random
from datetime import date, datetime, time, timedelta

from sqlalchemy import func, select, text

from app.core.database import AsyncSessionLocal
from app.core.security import get_password_hash
from app.models.models import Attendance, OvertimeRequest, Role, Shift, Site, User, WorkSchedule


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _work_minutes(checkin: datetime, checkout: datetime) -> int:
    return max(0, int((checkout - checkin).total_seconds() / 60))


BASE_DATE = date(2026, 5, 15)   # May 15 = Friday
DAYS_TO_SEED = 4                # 15 = Fri, 16 = Sat, 17 = Sun, 18 = Mon


def _is_weekend_db_dow(d: date) -> bool:
    python_dow = d.weekday()
    db_dow = (python_dow + 1) % 7
    return db_dow in {0, 6}


def _seeded(emp_num: int, day_idx: int) -> int:
    """Deterministic pseudo-random for employee on a given day."""
    return (emp_num * 137 + day_idx * 251) % 1000


def _gen_pattern(emp_num: int, day_idx: int, is_sales: bool):
    """
    Generate a unique attendance tuple for employee `emp_num` on `day_idx`.
    Returns: (ci_h, ci_m, co_h, co_m, status, in_radius, overtime_min)
    No two employees share the exact same pattern across all 4 days.
    """
    s = _seeded(emp_num, day_idx)
    att_date = BASE_DATE + timedelta(days=day_idx)
    is_weekend = _is_weekend_db_dow(att_date)

    if is_weekend:
        ci_h = 7 + (s % 4)                    # 7–10
        ci_m = (s * 3) % 60
        co_h = ci_h + 5 + (s % 6)             # work 5–11 h
        co_m = (s * 7) % 60
    else:
        # Weekday: checkin around 06:00–07:59
        ci_h = 6 if s < 400 else 7
        ci_m = s % 60
        co_h = 16 + ((s + emp_num) % 3)       # 16–18
        co_m = (s * 11 + day_idx * 7) % 60

    # Status variation
    stat_roll = (s + day_idx * 17) % 6
    if is_sales:
        status_opts = ["ONTIME"] * 4 + ["LATE"] * 2
    else:
        status_opts = ["ONTIME"] * 2 + ["LATE"] * 2 + ["EARLY"] + ["OUT_OF_RADIUS"]
    status = status_opts[stat_roll % len(status_opts)]
    in_radius = status != "OUT_OF_RADIUS"

    # Overtime: weekend always overtime, weekday only for some
    if is_weekend:
        ot = max(0, (co_h - ci_h) * 60 + co_m - ci_m)
    else:
        ot = max(0, (co_h - 17) * 60 + co_m) if s > 600 and co_h >= 17 else 0

    return (ci_h, ci_m, co_h, co_m, status, in_radius, ot)


# ---------------------------------------------------------------------------
# Main seed
# ---------------------------------------------------------------------------

async def seed():
    async with AsyncSessionLocal() as db:

        # ── 0. Inline timezone migration ──────────────────────────────────────
        print("\n[0] Ensuring sites.timezone column exists...")
        await db.execute(text(
            "ALTER TABLE sites "
            "ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Jakarta'"
        ))
        await db.commit()
        print("    timezone column: OK")

        # ── 1. Roles ──────────────────────────────────────────────────────────
        print("\n[1] Seeding roles...")
        role_names = ["ADMIN", "SUPERVISOR", "EMPLOYEE", "SALES"]
        roles: dict[str, Role] = {}

        for rname in role_names:
            result = await db.execute(select(Role).where(Role.name == rname))
            role = result.scalar_one_or_none()
            if not role:
                role = Role(name=rname)
                db.add(role)
                await db.flush()
                print(f"    [+] Role created: {rname}")
            else:
                print(f"    [=] Role exists: {rname}")
            roles[rname] = role

        await db.commit()

        # Re-fetch after commit
        for rname in role_names:
            result = await db.execute(select(Role).where(Role.name == rname))
            roles[rname] = result.scalar_one()

        # ── 2. Original site (Kantor Pusat) ───────────────────────────────────
        print("\n[2] Seeding original site (Kantor Pusat)...")
        result = await db.execute(select(Site).where(Site.name == "Kantor Pusat"))
        orig_site = result.scalar_one_or_none()
        if not orig_site:
            await db.execute(text(
                "INSERT INTO sites (name, latitude, longitude, radius_meter, timezone) "
                "VALUES (:name, :lat, :lon, :radius, :tz)"
            ), {"name": "Kantor Pusat", "lat": -6.200000, "lon": 106.816666,
                "radius": 100, "tz": "Asia/Jakarta"})
            await db.commit()
            result = await db.execute(select(Site).where(Site.name == "Kantor Pusat"))
            orig_site = result.scalar_one()
            print(f"    [+] Site created: Kantor Pusat (id={orig_site.id})")
        else:
            print(f"    [=] Site exists: Kantor Pusat (id={orig_site.id})")

        # ── 3. Three timezone sites ───────────────────────────────────────────
        print("\n[3] Seeding timezone sites (WIB / WITA / WIT)...")
        tz_sites_data = [
            {
                "name": "Site Jakarta",
                "lat": -6.200000,
                "lon": 106.816666,
                "radius": 100,
                "tz": "Asia/Jakarta",
                "label": "WIB (UTC+7)",
            },
            {
                "name": "Site Makassar",
                "lat": -5.147350,
                "lon": 119.432181,
                "radius": 100,
                "tz": "Asia/Makassar",
                "label": "WITA (UTC+8)",
            },
            {
                "name": "Site Jayapura",
                "lat": -2.533333,
                "lon": 140.717361,
                "radius": 100,
                "tz": "Asia/Jayapura",
                "label": "WIT (UTC+9)",
            },
        ]

        tz_sites: dict[str, Site] = {}
        for sd in tz_sites_data:
            result = await db.execute(select(Site).where(Site.name == sd["name"]))
            site = result.scalar_one_or_none()
            if not site:
                await db.execute(text(
                    "INSERT INTO sites (name, latitude, longitude, radius_meter, timezone) "
                    "VALUES (:name, :lat, :lon, :radius, :tz)"
                ), {"name": sd["name"], "lat": sd["lat"], "lon": sd["lon"],
                    "radius": sd["radius"], "tz": sd["tz"]})
                await db.commit()
                result = await db.execute(select(Site).where(Site.name == sd["name"]))
                site = result.scalar_one()
                print(f"    [+] Site created: {sd['name']} [{sd['label']}] (id={site.id})")
            else:
                print(f"    [=] Site exists:  {sd['name']} [{sd['label']}] (id={site.id})")
            tz_sites[sd["name"]] = site

        # ── 4. Shifts + work schedules ────────────────────────────────────────
        print("\n[4] Seeding shifts and work schedules...")
        shift_defs = [
            ("Site Jakarta",  "Shift Reguler WIB"),
            ("Site Makassar", "Shift Reguler WITA"),
            ("Site Jayapura", "Shift Reguler WIT"),
        ]

        site_shifts: dict[str, Shift] = {}
        for site_name, shift_name in shift_defs:
            site = tz_sites[site_name]
            result = await db.execute(
                select(Shift).where(Shift.site_id == site.id, Shift.name == shift_name)
            )
            shift = result.scalar_one_or_none()
            if not shift:
                shift = Shift(
                    site_id=site.id,
                    name=shift_name,
                    start_time=time(7, 0),
                    end_time=time(17, 0),
                    is_cross_midnight=False,
                    work_hours_standard=8,
                )
                db.add(shift)
                await db.flush()
                # Add all 7 days with 15-min late tolerance
                for dow in range(7):
                    db.add(WorkSchedule(
                        shift_id=shift.id,
                        day_of_week=dow,
                        toleransi_telat_menit=15,
                    ))
                await db.commit()
                result = await db.execute(
                    select(Shift).where(Shift.site_id == site.id, Shift.name == shift_name)
                )
                shift = result.scalar_one()
                print(f"    [+] Shift created: {shift_name} (id={shift.id})")
            else:
                print(f"    [=] Shift exists:  {shift_name} (id={shift.id})")
            site_shifts[site_name] = shift

        # ── 5. Original test users ────────────────────────────────────────────
        print("\n[5] Seeding original test users...")
        original_users = [
            {
                "employee_id": "ADM001",
                "name": "Administrator",
                "email": "admin@presensiv2.local",
                "password": "Admin@123",
                "role": "ADMIN",
                "site_id": None,
            },
            {
                "employee_id": "SPV001",
                "name": "Supervisor Satu",
                "email": "supervisor@presensiv2.local",
                "password": "Supervisor@123",
                "role": "SUPERVISOR",
                "site_id": orig_site.id,
            },
            {
                "employee_id": "EMP001",
                "name": "Karyawan Satu",
                "email": "karyawan@presensiv2.local",
                "password": "Karyawan@123",
                "role": "EMPLOYEE",
                "site_id": orig_site.id,
            },
        ]
        for u in original_users:
            result = await db.execute(select(User).where(User.email == u["email"]))
            if result.scalar_one_or_none():
                print(f"    [=] User exists: {u['email']}")
                continue
            db.add(User(
                employee_id=u["employee_id"],
                name=u["name"],
                email=u["email"],
                password_hash=get_password_hash(u["password"]),
                role_id=roles[u["role"]].id,
                site_id=u["site_id"],
                is_active=True,
            ))
            print(f"    [+] User created: {u['email']} / {u['password']}")
        await db.commit()

        # Assign original supervisor hierarchy
        r = await db.execute(select(User).where(User.employee_id == "SPV001"))
        spv001 = r.scalar_one_or_none()
        r = await db.execute(select(User).where(User.employee_id == "EMP001"))
        emp001 = r.scalar_one_or_none()
        if spv001 and emp001 and emp001.supervisor_id != spv001.id:
            emp001.supervisor_id = spv001.id
            await db.commit()
            print("    [+] EMP001 → SPV001 hierarchy set")

        # ── 6. example.com supervisors ────────────────────────────────────────
        print("\n[6] Seeding @example.com supervisors...")
        jkt  = tz_sites["Site Jakarta"]
        mks  = tz_sites["Site Makassar"]
        jpr  = tz_sites["Site Jayapura"]

        supervisors_data = [
            {"employee_id": "SPV101", "name": "Budi Santoso",   "email": "spv101@example.com", "site_id": jkt.id},
            {"employee_id": "SPV102", "name": "Dewi Rahayu",    "email": "spv102@example.com", "site_id": jkt.id},
            {"employee_id": "SPV103", "name": "Andi Wijaya",    "email": "spv103@example.com", "site_id": mks.id},
            {"employee_id": "SPV104", "name": "Rini Susanti",   "email": "spv104@example.com", "site_id": jpr.id},
            {"employee_id": "SPV105", "name": "Hendra Kusuma",  "email": "spv105@example.com", "site_id": jpr.id},
        ]
        spv_objects: dict[str, User] = {}
        for u in supervisors_data:
            result = await db.execute(select(User).where(User.employee_id == u["employee_id"]))
            spv = result.scalar_one_or_none()
            if not spv:
                spv = User(
                    employee_id=u["employee_id"],
                    name=u["name"],
                    email=u["email"],
                    password_hash=get_password_hash("12345"),
                    role_id=roles["SUPERVISOR"].id,
                    site_id=u["site_id"],
                    is_active=True,
                )
                db.add(spv)
                await db.flush()
                print(f"    [+] Supervisor created: {u['email']}")
            else:
                print(f"    [=] Supervisor exists:  {u['email']}")
            spv_objects[u["employee_id"]] = spv
        await db.commit()

        # Re-fetch supervisors after commit
        for eid in list(spv_objects.keys()):
            r = await db.execute(select(User).where(User.employee_id == eid))
            spv_objects[eid] = r.scalar_one()

        # ── 7. example.com employees ──────────────────────────────────────────
        print("\n[7] Seeding @example.com employees...")
        employees_data = [
            # ── Original 5 (1 per supervisor) ──────────────────────────────
            {"employee_id": "EMP101", "name": "Siti Aminah",          "email": "emp101@example.com", "site_id": jkt.id, "spv": "SPV101"},
            {"employee_id": "EMP102", "name": "Ahmad Fauzi",          "email": "emp102@example.com", "site_id": jkt.id, "spv": "SPV102"},
            {"employee_id": "EMP103", "name": "Lestari Putri",        "email": "emp103@example.com", "site_id": mks.id, "spv": "SPV103"},
            {"employee_id": "EMP104", "name": "Joko Susilo",          "email": "emp104@example.com", "site_id": jpr.id, "spv": "SPV104"},
            {"employee_id": "EMP105", "name": "Maya Indah",           "email": "emp105@example.com", "site_id": jpr.id, "spv": "SPV105"},
            # ── SPV101 additional 7 (Site Jakarta) ──────────────────────────
            {"employee_id": "EMP106", "name": "Rudi Hartono",         "email": "emp106@example.com", "site_id": jkt.id, "spv": "SPV101"},
            {"employee_id": "EMP107", "name": "Fitri Wahyuni",        "email": "emp107@example.com", "site_id": jkt.id, "spv": "SPV101"},
            {"employee_id": "EMP108", "name": "Agus Purnomo",         "email": "emp108@example.com", "site_id": jkt.id, "spv": "SPV101"},
            {"employee_id": "EMP109", "name": "Dini Anggraini",       "email": "emp109@example.com", "site_id": jkt.id, "spv": "SPV101"},
            {"employee_id": "EMP110", "name": "Wahyu Setiawan",       "email": "emp110@example.com", "site_id": jkt.id, "spv": "SPV101"},
            {"employee_id": "EMP111", "name": "Nurul Hidayah",        "email": "emp111@example.com", "site_id": jkt.id, "spv": "SPV101"},
            {"employee_id": "EMP112", "name": "Bagas Prasetyo",       "email": "emp112@example.com", "site_id": jkt.id, "spv": "SPV101"},
            # ── SPV102 additional 7 (Site Jakarta) ──────────────────────────
            {"employee_id": "EMP113", "name": "Ika Ramadhani",        "email": "emp113@example.com", "site_id": jkt.id, "spv": "SPV102"},
            {"employee_id": "EMP114", "name": "Dimas Kurniawan",      "email": "emp114@example.com", "site_id": jkt.id, "spv": "SPV102"},
            {"employee_id": "EMP115", "name": "Sari Novitasari",      "email": "emp115@example.com", "site_id": jkt.id, "spv": "SPV102"},
            {"employee_id": "EMP116", "name": "Farid Maulana",        "email": "emp116@example.com", "site_id": jkt.id, "spv": "SPV102"},
            {"employee_id": "EMP117", "name": "Yuni Astuti",          "email": "emp117@example.com", "site_id": jkt.id, "spv": "SPV102"},
            {"employee_id": "EMP118", "name": "Rizky Firmansyah",     "email": "emp118@example.com", "site_id": jkt.id, "spv": "SPV102"},
            {"employee_id": "EMP119", "name": "Ayu Lestari",          "email": "emp119@example.com", "site_id": jkt.id, "spv": "SPV102"},
            # ── SPV103 additional 7 (Site Makassar) ─────────────────────────
            {"employee_id": "EMP120", "name": "Bambang Suryadi",      "email": "emp120@example.com", "site_id": mks.id, "spv": "SPV103"},
            {"employee_id": "EMP121", "name": "Nisa Rahmawati",       "email": "emp121@example.com", "site_id": mks.id, "spv": "SPV103"},
            {"employee_id": "EMP122", "name": "Dedi Kurniawan",       "email": "emp122@example.com", "site_id": mks.id, "spv": "SPV103"},
            {"employee_id": "EMP123", "name": "Susi Wulandari",       "email": "emp123@example.com", "site_id": mks.id, "spv": "SPV103"},
            {"employee_id": "EMP124", "name": "Heri Prasetyo",        "email": "emp124@example.com", "site_id": mks.id, "spv": "SPV103"},
            {"employee_id": "EMP125", "name": "Mira Oktaviani",       "email": "emp125@example.com", "site_id": mks.id, "spv": "SPV103"},
            {"employee_id": "EMP126", "name": "Toni Wijaya",          "email": "emp126@example.com", "site_id": mks.id, "spv": "SPV103"},
            # ── SPV104 additional 7 (Site Jayapura) ─────────────────────────
            {"employee_id": "EMP127", "name": "Laras Pertiwi",        "email": "emp127@example.com", "site_id": jpr.id, "spv": "SPV104"},
            {"employee_id": "EMP128", "name": "Eko Saputro",          "email": "emp128@example.com", "site_id": jpr.id, "spv": "SPV104"},
            {"employee_id": "EMP129", "name": "Dewi Kurniasih",       "email": "emp129@example.com", "site_id": jpr.id, "spv": "SPV104"},
            {"employee_id": "EMP130", "name": "Surya Dinata",         "email": "emp130@example.com", "site_id": jpr.id, "spv": "SPV104"},
            {"employee_id": "EMP131", "name": "Putri Rahayu",         "email": "emp131@example.com", "site_id": jpr.id, "spv": "SPV104"},
            {"employee_id": "EMP132", "name": "Fandi Ahmad",          "email": "emp132@example.com", "site_id": jpr.id, "spv": "SPV104"},
            {"employee_id": "EMP133", "name": "Rina Susilawati",      "email": "emp133@example.com", "site_id": jpr.id, "spv": "SPV104"},
            # ── SPV105 additional 7 (Site Jayapura) ─────────────────────────
            {"employee_id": "EMP134", "name": "Andika Pratama",       "email": "emp134@example.com", "site_id": jpr.id, "spv": "SPV105"},
            {"employee_id": "EMP135", "name": "Wulan Permatasari",    "email": "emp135@example.com", "site_id": jpr.id, "spv": "SPV105"},
            {"employee_id": "EMP136", "name": "Gilang Saputra",       "email": "emp136@example.com", "site_id": jpr.id, "spv": "SPV105"},
            {"employee_id": "EMP137", "name": "Lidya Kusumaningrum",  "email": "emp137@example.com", "site_id": jpr.id, "spv": "SPV105"},
            {"employee_id": "EMP138", "name": "Imam Santosa",         "email": "emp138@example.com", "site_id": jpr.id, "spv": "SPV105"},
            {"employee_id": "EMP139", "name": "Anggi Pratiwi",        "email": "emp139@example.com", "site_id": jpr.id, "spv": "SPV105"},
            {"employee_id": "EMP140", "name": "Dony Firmansyah",      "email": "emp140@example.com", "site_id": jpr.id, "spv": "SPV105"},
        ]
        emp_objects: dict[str, User] = {}
        for u in employees_data:
            result = await db.execute(select(User).where(User.employee_id == u["employee_id"]))
            emp = result.scalar_one_or_none()
            if not emp:
                emp = User(
                    employee_id=u["employee_id"],
                    name=u["name"],
                    email=u["email"],
                    password_hash=get_password_hash("12345"),
                    role_id=roles["EMPLOYEE"].id,
                    site_id=u["site_id"],
                    is_active=True,
                )
                db.add(emp)
                await db.flush()
                print(f"    [+] Employee created: {u['email']}")
            else:
                print(f"    [=] Employee exists:  {u['email']}")
            emp_objects[u["employee_id"]] = emp
        await db.commit()

        # ── 7b. SALES employees (no supervisor, no location restriction) ────────
        print("\n[7b] Seeding @example.com SALES employees...")
        sales_data = [
            {"employee_id": "SAL001", "name": "Dian Permata",   "email": "sal001@example.com", "site_id": jkt.id},
            {"employee_id": "SAL002", "name": "Rizky Aditya",   "email": "sal002@example.com", "site_id": jkt.id},
            {"employee_id": "SAL003", "name": "Putri Melati",   "email": "sal003@example.com", "site_id": mks.id},
            {"employee_id": "SAL004", "name": "Bayu Anggara",   "email": "sal004@example.com", "site_id": mks.id},
            {"employee_id": "SAL005", "name": "Indah Kusuma",   "email": "sal005@example.com", "site_id": jpr.id},
            {"employee_id": "SAL006", "name": "Adit Pratama",   "email": "sal006@example.com", "site_id": jpr.id},
        ]
        sales_objects: dict[str, User] = {}
        for u in sales_data:
            result = await db.execute(select(User).where(User.employee_id == u["employee_id"]))
            user = result.scalar_one_or_none()
            if not user:
                user = User(
                    employee_id=u["employee_id"],
                    name=u["name"],
                    email=u["email"],
                    password_hash=get_password_hash("12345"),
                    role_id=roles["SALES"].id,
                    site_id=u["site_id"],
                    is_active=True,
                )
                db.add(user)
                await db.flush()
                print(f"    [+] SALES created: {u['email']}")
            else:
                print(f"    [=] SALES exists:  {u['email']}")
            sales_objects[u["employee_id"]] = user
        await db.commit()

        for eid in list(sales_objects.keys()):
            r = await db.execute(select(User).where(User.employee_id == eid))
            sales_objects[eid] = r.scalar_one()

        # Re-fetch employees and assign supervisor_id
        print("\n[8] Assigning supervisor hierarchy...")
        for u in employees_data:
            r = await db.execute(select(User).where(User.employee_id == u["employee_id"]))
            emp = r.scalar_one()
            spv = spv_objects[u["spv"]]
            if emp.supervisor_id != spv.id:
                emp.supervisor_id = spv.id
                print(f"    [+] {u['employee_id']} → {u['spv']}")
            else:
                print(f"    [=] {u['employee_id']} already supervised by {u['spv']}")
        await db.commit()

        # Re-fetch employees and sales for attendance seeding
        for eid in list(emp_objects.keys()):
            r = await db.execute(select(User).where(User.employee_id == eid))
            emp_objects[eid] = r.scalar_one()
        for eid in list(sales_objects.keys()):
            r = await db.execute(select(User).where(User.employee_id == eid))
            sales_objects[eid] = r.scalar_one()

        # Combine all non-ADMIN users for attendance
        all_attendance_users: list[tuple[User, bool]] = []
        for emp in emp_objects.values():
            all_attendance_users.append((emp, False))  # is_sales=False
        for emp in sales_objects.values():
            all_attendance_users.append((emp, True))   # is_sales=True

        # ── 9. Attendance + Overtime records ───────────────────────────────────
        print(f"\n[9] Seeding attendance records ({BASE_DATE} – {BASE_DATE + timedelta(days=DAYS_TO_SEED - 1)})...")

        site_map: dict[int, Site] = {
            jkt.id: jkt, mks.id: mks, jpr.id: jpr,
        }
        shift_map: dict[int, Shift] = {
            jkt.id: site_shifts["Site Jakarta"],
            mks.id: site_shifts["Site Makassar"],
            jpr.id: site_shifts["Site Jayapura"],
        }

        total_inserted = 0
        total_skipped = 0
        total_ot = 0
        # Collect created attendances with user for overtime linking
        created_attendances: list[tuple[Attendance, User, int]] = []  # (att, user, emp_num)

        for user, is_sales in all_attendance_users:
            site = site_map.get(user.site_id)
            shift = shift_map.get(user.site_id)
            if not site or not shift:
                print(f"    [!] Skipping {user.employee_id} — no matching site/shift")
                continue

            emp_num = int(user.employee_id[3:])  # "EMP101"→101, "SAL001"→1
            # Make SALES numbers unique from EMP: SAL001→1001, SAL002→1002, ...
            if user.employee_id.startswith("SAL"):
                emp_num += 1000

            for day_idx in range(DAYS_TO_SEED):
                att_date = BASE_DATE + timedelta(days=day_idx)
                ci_h, ci_m, co_h, co_m, status, in_radius, ot_min = _gen_pattern(
                    emp_num, day_idx, is_sales
                )

                checkin_dt = datetime(att_date.year, att_date.month, att_date.day, ci_h, ci_m)
                checkout_dt = datetime(att_date.year, att_date.month, att_date.day, co_h, co_m)

                # Skip if already exists
                exists_result = await db.execute(
                    select(Attendance).where(
                        Attendance.user_id == user.id,
                        func.date(Attendance.checkin_time) == att_date,
                    )
                )
                if exists_result.scalar_one_or_none():
                    total_skipped += 1
                    continue

                is_wknd = _is_weekend_db_dow(att_date)
                work_min = _work_minutes(checkin_dt, checkout_dt)

                lat = site.latitude
                lon = site.longitude
                if not in_radius:
                    lat += 2.0
                    lon += 2.0

                att = Attendance(
                    user_id=user.id,
                    site_id=site.id,
                    shift_id=shift.id,
                    checkin_time=checkin_dt,
                    checkout_time=checkout_dt,
                    auto_checkout=False,
                    latitude=lat,
                    longitude=lon,
                    work_duration_minutes=work_min,
                    overtime_minutes=ot_min,
                    is_weekend=is_wknd,
                    is_holiday=False,
                    status=status,
                )
                db.add(att)
                await db.flush()
                created_attendances.append((att, user, emp_num))
                total_inserted += 1

        await db.commit()
        print(f"    Attendance inserted: {total_inserted}  |  Skipped: {total_skipped}")

        # ── 10. Overtime requests (varied per user) ─────────────────────────────
        print("\n[10] Seeding overtime requests...")
        ot_statuses = ["PENDING", "APPROVED", "REJECTED"]
        for att, user, emp_num in created_attendances:
            ot_min = att.overtime_minutes
            if ot_min <= 0:
                continue

            # Determine overtime request status based on employee number and day
            ot_roll = (_seeded(emp_num, att.checkin_time.day) + 7) % 7
            ot_status = ot_statuses[ot_roll % 3]

            # Reject only some PENDING, approve others
            if ot_status == "REJECTED" and ot_roll < 5:
                ot_status = "APPROVED" if ot_roll < 3 else "PENDING"

            # Find an approver: use a supervisor from the same site
            spv_for_site = next(
                (s for s in spv_objects.values() if s.site_id == user.site_id), None
            )

            ot_req = OvertimeRequest(
                user_id=user.id,
                attendance_id=att.id,
                requested_start=att.checkout_time - timedelta(minutes=ot_min),
                requested_end=att.checkout_time,
                approved_by=spv_for_site.id if spv_for_site else None,
                status=ot_status,
                notes=f"Lembur {att.checkin_time.strftime('%d/%m')} — {ot_min} menit" if ot_status == "PENDING" else None,
                supervisor_notes="Disetujui" if ot_status == "APPROVED" else ("Ditolak" if ot_status == "REJECTED" else None),
            )
            db.add(ot_req)
            total_ot += 1

        await db.commit()
        print(f"    Overtime requests created: {total_ot}")

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("✅ Seed complete!")
    print("=" * 60)
    print("\nOriginal test credentials:")
    print("  Admin      : admin@presensiv2.local      / Admin@123")
    print("  Supervisor : supervisor@presensiv2.local  / Supervisor@123")
    print("  Employee   : karyawan@presensiv2.local    / Karyawan@123")
    print("\n@example.com credentials (password: 12345):")
    print("  Supervisors: spv101 … spv105 @example.com")
    print("  Employees  : emp101 … emp140 @example.com (8 per supervisor)")
    print("  SALES      : sal001 … sal006 @example.com (2 per site, no GPS restriction)")
    print("\nSites seeded:")
    print("  Kantor Pusat  — WIB (Asia/Jakarta)")
    print("  Site Jakarta   — WIB (Asia/Jakarta)")
    print("  Site Makassar  — WITA (Asia/Makassar)")
    print("  Site Jayapura  — WIT  (Asia/Jayapura)")
    print(f"\nAttendance records: {total_inserted} (May 15–18, 2026)")
    print(f"Overtime records  : {total_ot}")
    print("   Pattern: setiap user UNIK — tidak ada yang sama")


if __name__ == "__main__":
    asyncio.run(seed())
