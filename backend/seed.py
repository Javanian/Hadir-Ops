"""
seed.py — sample data for local development and demos (MongoDB).

Creates (idempotent: existing records are kept):
  • 4 sites: Kantor Pusat + one per Indonesian time zone (WIB / WITA / WIT)
  • A regular shift per site with all seven days scheduled
  • Test accounts (admin / supervisor / employee) and @example.com users:
    5 supervisors, 40 employees, 6 SALES
  • Attendance for May 15–18, 2026 with overtime requests
  • A few leave requests around today (sick, permit, annual)

Usage:
    python seed.py

Requires MONGODB_URL (and MONGODB_DB) in .env; indexes are created here too.
"""

import asyncio
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from app.core.database import client, get_database
from app.core.security import get_password_hash
from app.db.documents import encode
from app.db.ids import next_id
from app.db.schema import ensure_schema

UTC = timezone.utc


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
# Upserts by natural key
# ---------------------------------------------------------------------------

async def _site(db, name, lat, lon, radius, tz) -> dict:
    doc = await db.sites.find_one({"name": name})
    if doc:
        print(f"    [=] Site exists: {name} (id={doc['_id']})")
        return doc
    doc = {"_id": await next_id(db, "sites"), "name": name, "latitude": lat, "longitude": lon,
           "radius_meter": radius, "timezone": tz, "created_at": datetime.now(UTC)}
    await db.sites.insert_one(doc)
    print(f"    [+] Site created: {name} (id={doc['_id']})")
    return doc


async def _shift(db, site_id, name) -> dict:
    doc = await db.shifts.find_one({"site_id": site_id, "name": name})
    if doc:
        print(f"    [=] Shift exists:  {name} (id={doc['_id']})")
        return doc
    doc = encode({
        "_id": await next_id(db, "shifts"), "site_id": site_id, "name": name,
        "start_time": time(7, 0), "end_time": time(17, 0), "is_cross_midnight": False,
        "work_hours_standard": 8, "created_at": datetime.now(UTC),
        # All 7 days with a 15-minute late tolerance
        "work_schedules": [
            {"id": await next_id(db, "work_schedules"), "day_of_week": dow, "toleransi_telat_menit": 15}
            for dow in range(7)
        ],
    })
    await db.shifts.insert_one(doc)
    print(f"    [+] Shift created: {name} (id={doc['_id']})")
    return doc


async def _user(db, employee_id, name, email, password, role, site_id, supervisor_id=None) -> dict:
    doc = await db.users.find_one({"employee_id": employee_id})
    if doc:
        if supervisor_id is not None and doc.get("supervisor_id") != supervisor_id:
            await db.users.update_one({"_id": doc["_id"]}, {"$set": {"supervisor_id": supervisor_id}})
            doc["supervisor_id"] = supervisor_id
        print(f"    [=] {role} exists: {email}")
        return doc
    doc = {
        "_id": await next_id(db, "users"), "employee_id": employee_id, "name": name, "email": email,
        "password_hash": get_password_hash(password), "role": role, "site_id": site_id,
        "supervisor_id": supervisor_id, "face_embedding": None, "is_active": True,
        "failed_login_attempts": 0, "locked_until": None, "password_changed_at": None,
        "created_at": datetime.now(UTC),
    }
    await db.users.insert_one(doc)
    print(f"    [+] {role} created: {email}")
    return doc


# ---------------------------------------------------------------------------
# Main seed
# ---------------------------------------------------------------------------

async def seed():
    db = get_database()
    print("\n[0] Ensuring indexes and validators...")
    await ensure_schema(db)

    # ── 1. Sites ──────────────────────────────────────────────────────────────
    print("\n[1] Seeding sites...")
    orig_site = await _site(db, "Kantor Pusat", -6.200000, 106.816666, 100, "Asia/Jakarta")
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
    tz_sites = {}
    for sd in tz_sites_data:
        tz_sites[sd["name"]] = await _site(db, sd["name"], sd["lat"], sd["lon"], sd["radius"], sd["tz"])
    jkt, mks, jpr = (tz_sites[n] for n in ("Site Jakarta", "Site Makassar", "Site Jayapura"))

    # ── 2. Shifts ─────────────────────────────────────────────────────────────
    print("\n[2] Seeding shifts and work schedules...")
    site_shifts = {}
    for site_name, shift_name in (
        ("Site Jakarta", "Shift Reguler WIB"),
        ("Site Makassar", "Shift Reguler WITA"),
        ("Site Jayapura", "Shift Reguler WIT"),
    ):
        site_shifts[tz_sites[site_name]["_id"]] = await _shift(db, tz_sites[site_name]["_id"], shift_name)

    # ── 3. Users ──────────────────────────────────────────────────────────────
    print("\n[3] Seeding test users...")
    await _user(db, "ADM001", "Administrator", "admin@hadirops.local", "Admin@123", "ADMIN", None)
    spv001 = await _user(db, "SPV001", "Supervisor Satu", "supervisor@hadirops.local", "Supervisor@123",
                         "SUPERVISOR", orig_site["_id"])
    await _user(db, "EMP001", "Karyawan Satu", "karyawan@hadirops.local", "Karyawan@123",
                "EMPLOYEE", orig_site["_id"], supervisor_id=spv001["_id"])

    print("\n[4] Seeding @example.com supervisors...")
    jkt_id, mks_id, jpr_id = jkt["_id"], mks["_id"], jpr["_id"]
    supervisors_data = [
        {"employee_id": "SPV101", "name": "Budi Santoso",   "email": "spv101@example.com", "site_id": jkt_id},
        {"employee_id": "SPV102", "name": "Dewi Rahayu",    "email": "spv102@example.com", "site_id": jkt_id},
        {"employee_id": "SPV103", "name": "Andi Wijaya",    "email": "spv103@example.com", "site_id": mks_id},
        {"employee_id": "SPV104", "name": "Rini Susanti",   "email": "spv104@example.com", "site_id": jpr_id},
        {"employee_id": "SPV105", "name": "Hendra Kusuma",  "email": "spv105@example.com", "site_id": jpr_id},
    ]
    spv_objects = {}
    for u in supervisors_data:
        spv_objects[u["employee_id"]] = await _user(
            db, u["employee_id"], u["name"], u["email"], "12345", "SUPERVISOR", u["site_id"])

    print("\n[5] Seeding @example.com employees...")
    employees_data = [
        # ── Original 5 (1 per supervisor) ──────────────────────────────
        {"employee_id": "EMP101", "name": "Siti Aminah",          "email": "emp101@example.com", "site_id": jkt_id, "spv": "SPV101"},
        {"employee_id": "EMP102", "name": "Ahmad Fauzi",          "email": "emp102@example.com", "site_id": jkt_id, "spv": "SPV102"},
        {"employee_id": "EMP103", "name": "Lestari Putri",        "email": "emp103@example.com", "site_id": mks_id, "spv": "SPV103"},
        {"employee_id": "EMP104", "name": "Joko Susilo",          "email": "emp104@example.com", "site_id": jpr_id, "spv": "SPV104"},
        {"employee_id": "EMP105", "name": "Maya Indah",           "email": "emp105@example.com", "site_id": jpr_id, "spv": "SPV105"},
        # ── SPV101 additional 7 (Site Jakarta) ──────────────────────────
        {"employee_id": "EMP106", "name": "Rudi Hartono",         "email": "emp106@example.com", "site_id": jkt_id, "spv": "SPV101"},
        {"employee_id": "EMP107", "name": "Fitri Wahyuni",        "email": "emp107@example.com", "site_id": jkt_id, "spv": "SPV101"},
        {"employee_id": "EMP108", "name": "Agus Purnomo",         "email": "emp108@example.com", "site_id": jkt_id, "spv": "SPV101"},
        {"employee_id": "EMP109", "name": "Dini Anggraini",       "email": "emp109@example.com", "site_id": jkt_id, "spv": "SPV101"},
        {"employee_id": "EMP110", "name": "Wahyu Setiawan",       "email": "emp110@example.com", "site_id": jkt_id, "spv": "SPV101"},
        {"employee_id": "EMP111", "name": "Nurul Hidayah",        "email": "emp111@example.com", "site_id": jkt_id, "spv": "SPV101"},
        {"employee_id": "EMP112", "name": "Bagas Prasetyo",       "email": "emp112@example.com", "site_id": jkt_id, "spv": "SPV101"},
        # ── SPV102 additional 7 (Site Jakarta) ──────────────────────────
        {"employee_id": "EMP113", "name": "Ika Ramadhani",        "email": "emp113@example.com", "site_id": jkt_id, "spv": "SPV102"},
        {"employee_id": "EMP114", "name": "Dimas Kurniawan",      "email": "emp114@example.com", "site_id": jkt_id, "spv": "SPV102"},
        {"employee_id": "EMP115", "name": "Sari Novitasari",      "email": "emp115@example.com", "site_id": jkt_id, "spv": "SPV102"},
        {"employee_id": "EMP116", "name": "Farid Maulana",        "email": "emp116@example.com", "site_id": jkt_id, "spv": "SPV102"},
        {"employee_id": "EMP117", "name": "Yuni Astuti",          "email": "emp117@example.com", "site_id": jkt_id, "spv": "SPV102"},
        {"employee_id": "EMP118", "name": "Rizky Firmansyah",     "email": "emp118@example.com", "site_id": jkt_id, "spv": "SPV102"},
        {"employee_id": "EMP119", "name": "Ayu Lestari",          "email": "emp119@example.com", "site_id": jkt_id, "spv": "SPV102"},
        # ── SPV103 additional 7 (Site Makassar) ─────────────────────────
        {"employee_id": "EMP120", "name": "Bambang Suryadi",      "email": "emp120@example.com", "site_id": mks_id, "spv": "SPV103"},
        {"employee_id": "EMP121", "name": "Nisa Rahmawati",       "email": "emp121@example.com", "site_id": mks_id, "spv": "SPV103"},
        {"employee_id": "EMP122", "name": "Dedi Kurniawan",       "email": "emp122@example.com", "site_id": mks_id, "spv": "SPV103"},
        {"employee_id": "EMP123", "name": "Susi Wulandari",       "email": "emp123@example.com", "site_id": mks_id, "spv": "SPV103"},
        {"employee_id": "EMP124", "name": "Heri Prasetyo",        "email": "emp124@example.com", "site_id": mks_id, "spv": "SPV103"},
        {"employee_id": "EMP125", "name": "Mira Oktaviani",       "email": "emp125@example.com", "site_id": mks_id, "spv": "SPV103"},
        {"employee_id": "EMP126", "name": "Toni Wijaya",          "email": "emp126@example.com", "site_id": mks_id, "spv": "SPV103"},
        # ── SPV104 additional 7 (Site Jayapura) ─────────────────────────
        {"employee_id": "EMP127", "name": "Laras Pertiwi",        "email": "emp127@example.com", "site_id": jpr_id, "spv": "SPV104"},
        {"employee_id": "EMP128", "name": "Eko Saputro",          "email": "emp128@example.com", "site_id": jpr_id, "spv": "SPV104"},
        {"employee_id": "EMP129", "name": "Dewi Kurniasih",       "email": "emp129@example.com", "site_id": jpr_id, "spv": "SPV104"},
        {"employee_id": "EMP130", "name": "Surya Dinata",         "email": "emp130@example.com", "site_id": jpr_id, "spv": "SPV104"},
        {"employee_id": "EMP131", "name": "Putri Rahayu",         "email": "emp131@example.com", "site_id": jpr_id, "spv": "SPV104"},
        {"employee_id": "EMP132", "name": "Fandi Ahmad",          "email": "emp132@example.com", "site_id": jpr_id, "spv": "SPV104"},
        {"employee_id": "EMP133", "name": "Rina Susilawati",      "email": "emp133@example.com", "site_id": jpr_id, "spv": "SPV104"},
        # ── SPV105 additional 7 (Site Jayapura) ─────────────────────────
        {"employee_id": "EMP134", "name": "Andika Pratama",       "email": "emp134@example.com", "site_id": jpr_id, "spv": "SPV105"},
        {"employee_id": "EMP135", "name": "Wulan Permatasari",    "email": "emp135@example.com", "site_id": jpr_id, "spv": "SPV105"},
        {"employee_id": "EMP136", "name": "Gilang Saputra",       "email": "emp136@example.com", "site_id": jpr_id, "spv": "SPV105"},
        {"employee_id": "EMP137", "name": "Lidya Kusumaningrum",  "email": "emp137@example.com", "site_id": jpr_id, "spv": "SPV105"},
        {"employee_id": "EMP138", "name": "Imam Santosa",         "email": "emp138@example.com", "site_id": jpr_id, "spv": "SPV105"},
        {"employee_id": "EMP139", "name": "Anggi Pratiwi",        "email": "emp139@example.com", "site_id": jpr_id, "spv": "SPV105"},
        {"employee_id": "EMP140", "name": "Dony Firmansyah",      "email": "emp140@example.com", "site_id": jpr_id, "spv": "SPV105"},
    ]
    people = []  # (user doc, is_sales)
    for u in employees_data:
        emp = await _user(db, u["employee_id"], u["name"], u["email"], "12345", "EMPLOYEE", u["site_id"],
                          supervisor_id=spv_objects[u["spv"]]["_id"])
        people.append((emp, False))

    print("\n[6] Seeding @example.com SALES employees...")
    sales_data = [
        {"employee_id": "SAL001", "name": "Dian Permata",   "email": "sal001@example.com", "site_id": jkt_id},
        {"employee_id": "SAL002", "name": "Rizky Aditya",   "email": "sal002@example.com", "site_id": jkt_id},
        {"employee_id": "SAL003", "name": "Putri Melati",   "email": "sal003@example.com", "site_id": mks_id},
        {"employee_id": "SAL004", "name": "Bayu Anggara",   "email": "sal004@example.com", "site_id": mks_id},
        {"employee_id": "SAL005", "name": "Indah Kusuma",   "email": "sal005@example.com", "site_id": jpr_id},
        {"employee_id": "SAL006", "name": "Adit Pratama",   "email": "sal006@example.com", "site_id": jpr_id},
    ]
    for u in sales_data:
        people.append((await _user(db, u["employee_id"], u["name"], u["email"], "12345", "SALES", u["site_id"]), True))

    # ── 7. Attendance + overtime ──────────────────────────────────────────────
    print(f"\n[7] Seeding attendance ({BASE_DATE} – {BASE_DATE + timedelta(days=DAYS_TO_SEED - 1)})...")
    sites_by_id = {s["_id"]: s for s in tz_sites.values()}
    supervisor_for_site = {}
    for spv in spv_objects.values():
        supervisor_for_site.setdefault(spv["site_id"], spv["_id"])

    total_inserted = total_skipped = total_ot = 0
    ot_statuses = ["PENDING", "APPROVED", "REJECTED"]
    for user, is_sales in people:
        site = sites_by_id.get(user["site_id"])
        shift = site_shifts.get(user["site_id"])
        if not site or not shift:
            print(f"    [!] Skipping {user['employee_id']} — no matching site/shift")
            continue
        tz = ZoneInfo(site["timezone"])

        emp_num = int(user["employee_id"][3:])  # "EMP101"→101, "SAL001"→1
        if user["employee_id"].startswith("SAL"):
            emp_num += 1000  # keep SALES patterns apart from employees

        for day_idx in range(DAYS_TO_SEED):
            att_date = BASE_DATE + timedelta(days=day_idx)
            if await db.attendance.find_one({"user_id": user["_id"], "work_date": att_date.isoformat()}):
                total_skipped += 1
                continue
            ci_h, ci_m, co_h, co_m, status, in_radius, ot_min = _gen_pattern(emp_num, day_idx, is_sales)
            # Clock times are site-local
            checkin = datetime(att_date.year, att_date.month, att_date.day, ci_h, ci_m, tzinfo=tz)
            checkout = datetime(att_date.year, att_date.month, att_date.day, co_h, co_m, tzinfo=tz)
            offset = 0.0 if in_radius else 2.0

            att_id = await next_id(db, "attendance")
            await db.attendance.insert_one({
                "_id": att_id, "user_id": user["_id"], "site_id": site["_id"], "shift_id": shift["_id"],
                "checkin_time": checkin, "checkout_time": checkout, "auto_checkout": False,
                "latitude": site["latitude"] + offset, "longitude": site["longitude"] + offset,
                "work_duration_minutes": _work_minutes(checkin, checkout), "overtime_minutes": ot_min,
                "is_weekend": _is_weekend_db_dow(att_date), "is_holiday": False, "status": status,
                "work_date": att_date.isoformat(), "created_at": datetime.now(UTC),
                "risk_flags": [], "needs_review": False, "is_offline": False, "review_status": None,
            })
            total_inserted += 1

            if ot_min <= 0:
                continue
            ot_roll = (_seeded(emp_num, att_date.day) + 7) % 7
            ot_status = ot_statuses[ot_roll % 3]
            if ot_status == "REJECTED" and ot_roll < 5:
                ot_status = "APPROVED" if ot_roll < 3 else "PENDING"
            await db.overtime_requests.insert_one({
                "_id": await next_id(db, "overtime_requests"),
                "user_id": user["_id"], "attendance_id": att_id,
                "requested_start": checkout - timedelta(minutes=ot_min), "requested_end": checkout,
                "approved_by": supervisor_for_site.get(user["site_id"]) if ot_status != "PENDING" else None,
                "status": ot_status,
                "notes": f"Lembur {checkin.strftime('%d/%m')} — {ot_min} menit" if ot_status == "PENDING" else None,
                "supervisor_notes": {"APPROVED": "Disetujui", "REJECTED": "Ditolak"}.get(ot_status),
                "created_at": datetime.now(UTC),
            })
            total_ot += 1
    print(f"    Attendance inserted: {total_inserted}  |  Skipped: {total_skipped}")
    print(f"    Overtime requests created: {total_ot}")

    # ── 8. Leave requests (relative to today, so the demo always has some) ────
    print("\n[8] Seeding leave requests...")
    if await db.leave_requests.count_documents({}):
        print("    Leave requests already present")
    else:
        today = date.today()
        emps = [u for u, is_sales in people if not is_sales][:8]
        # (offset from today, days, type, status, reason)
        plan = [
            (0, 2, "SICK", "APPROVED", "Demam, ada surat dokter dari klinik"),
            (-3, 1, "PERMIT", "APPROVED", "Mengurus perpanjangan SIM"),
            (2, 1, "PERMIT", "PENDING", "Menghadiri wisuda anak"),
            (7, 4, "ANNUAL", "PENDING", "Pulang kampung untuk acara keluarga"),
            (0, 3, "ANNUAL", "APPROVED", "Liburan keluarga"),
            (5, 2, "ANNUAL", "REJECTED", "Liburan"),
            (1, 1, "SICK", "PENDING", "Kontrol ke dokter gigi"),
            (-6, 1, "PERMIT", "CANCELLED", "Urusan bank"),
        ]
        for emp, (offset, days, kind, status_, reason) in zip(emps, plan):
            start = today + timedelta(days=offset)
            decided = status_ in ("APPROVED", "REJECTED")
            await db.leave_requests.insert_one(encode({
                "_id": await next_id(db, "leave_requests"), "user_id": emp["_id"], "leave_type": kind,
                "start_date": start, "end_date": start + timedelta(days=days - 1), "reason": reason,
                "status": status_, "reviewed_by": emp.get("supervisor_id") if decided else None,
                "reviewed_at": datetime.now(UTC) if decided else None,
                "review_note": "Bentrok dengan jadwal audit, ajukan minggu depan" if status_ == "REJECTED" else None,
                "created_at": datetime.now(UTC),
            }))
        print(f"    Leave requests created: {min(len(emps), len(plan))}")

    # ── Summary ───────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("✅ Seed complete!")
    print("=" * 60)
    print("\nOriginal test credentials:")
    print("  Admin      : admin@hadirops.local      / Admin@123")
    print("  Supervisor : supervisor@hadirops.local  / Supervisor@123")
    print("  Employee   : karyawan@hadirops.local    / Karyawan@123")
    print("\n@example.com credentials (password: 12345):")
    print("  Supervisors: spv101 … spv105 @example.com")
    print("  Employees  : emp101 … emp140 @example.com (8 per supervisor)")
    print("  SALES      : sal001 … sal006 @example.com (2 per site, no GPS restriction)")
    print("\nSites seeded:")
    print("  Kantor Pusat  — WIB (Asia/Jakarta)")
    print("  Site Jakarta   — WIB (Asia/Jakarta)")
    print("  Site Makassar  — WITA (Asia/Makassar)")
    print("  Site Jayapura  — WIT  (Asia/Jayapura)")


async def main():
    try:
        await seed()
    finally:
        await client.close()


if __name__ == "__main__":
    asyncio.run(main())
