"""
Morning-rush load test: every employee checks in within the same minute,
and part of them resend the same request as a flaky network would.

Seeds N employees into the database the API is using, mints their access
tokens with the API's SECRET_KEY, fires the check-ins, and then counts
documents to confirm there is exactly one record per employee.

    MONGODB_URL=... MONGODB_DB=... SECRET_KEY=... python scripts/load_checkin.py \
        --base-url http://127.0.0.1:8000 --users 1000 --concurrency 100 --resend 0.2

Use a test database: the script deletes and recreates its own LOAD* users.
"""

import argparse
import asyncio
import os
import random
import statistics
import sys
import time
import uuid
from pathlib import Path

import httpx
from pymongo import MongoClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.security import create_access_token  # noqa: E402

LAT, LON = -6.2, 106.816666


def _db():
    return MongoClient(os.environ["MONGODB_URL"])[os.environ.get("MONGODB_DB", "hadirops")]


def _next_ids(db, sequence: str, count: int) -> list[int]:
    """Reserve `count` consecutive ids from the app's counters collection."""
    doc = db.counters.find_one_and_update(
        {"_id": sequence}, {"$inc": {"seq": count}}, upsert=True, return_document=True
    )
    return list(range(doc["seq"] - count + 1, doc["seq"] + 1))


def seed(n: int) -> list[int]:
    db = _db()
    old = [u["_id"] for u in db.users.find({"employee_id": {"$regex": "^LOAD"}}, {"_id": 1})]
    db.attendance.delete_many({"user_id": {"$in": old}})
    db.users.delete_many({"_id": {"$in": old}})
    old_sites = [s["_id"] for s in db.sites.find({"name": "Load test site"}, {"_id": 1})]
    db.shifts.delete_many({"site_id": {"$in": old_sites}})
    db.sites.delete_many({"_id": {"$in": old_sites}})

    site_id = _next_ids(db, "sites", 1)[0]
    db.sites.insert_one({"_id": site_id, "name": "Load test site", "latitude": LAT, "longitude": LON,
                         "radius_meter": 150, "timezone": "Asia/Jakarta"})
    db.shifts.insert_one({
        "_id": _next_ids(db, "shifts", 1)[0], "site_id": site_id, "name": "Load all day",
        "start_time": "00:00:00", "end_time": "23:59:59", "is_cross_midnight": False,
        "work_hours_standard": 8,
        "work_schedules": [
            {"id": i, "day_of_week": d, "toleransi_telat_menit": 15}
            for i, d in zip(_next_ids(db, "work_schedules", 7), range(7))
        ],
    })
    ids = _next_ids(db, "users", n)
    db.users.insert_many([
        {"_id": uid, "employee_id": f"LOAD{g}", "name": f"Load {g}", "email": f"load{g}@example.test",
         "password_hash": "x", "role": "EMPLOYEE", "site_id": site_id, "supervisor_id": None,
         "face_embedding": None, "is_active": True, "failed_login_attempts": 0}
        for g, uid in enumerate(ids, start=1)
    ])
    return ids


def count_rows(user_ids: list[int]) -> tuple[int, int]:
    db = _db()
    total = db.attendance.count_documents({"user_id": {"$in": user_ids}})
    users = len(db.attendance.distinct("user_id", {"user_id": {"$in": user_ids}}))
    return total, users


async def main(args) -> int:
    user_ids = seed(args.users)

    jobs = []
    for uid in user_ids:
        token = create_access_token({"sub": str(uid)})
        body = {
            "latitude": LAT + random.uniform(-0.0004, 0.0004),
            "longitude": LON + random.uniform(-0.0004, 0.0004),
            "accuracy_m": random.choice([5, 10, 20, 45]),
            "client_event_id": str(uuid.uuid4()),
        }
        jobs.append((token, body))
        if random.random() < args.resend:
            jobs.append((token, body))  # same event resent
    random.shuffle(jobs)

    latencies: list[float] = []
    codes: dict[int, int] = {}
    sem = asyncio.Semaphore(args.concurrency)
    limits = httpx.Limits(max_connections=args.concurrency, max_keepalive_connections=args.concurrency)

    async with httpx.AsyncClient(base_url=args.base_url, timeout=30, limits=limits) as client:
        async def one(token, body):
            async with sem:
                t0 = time.perf_counter()
                try:
                    r = await client.post(
                        "/attendance/checkin", json=body, headers={"Authorization": f"Bearer {token}"}
                    )
                    code = r.status_code
                except httpx.HTTPError:
                    code = -1
                latencies.append((time.perf_counter() - t0) * 1000)
                codes[code] = codes.get(code, 0) + 1

        started = time.perf_counter()
        await asyncio.gather(*(one(t, b) for t, b in jobs))
        wall = time.perf_counter() - started

    total, distinct = count_rows(user_ids)
    latencies.sort()
    p = lambda q: latencies[min(len(latencies) - 1, int(q * len(latencies)))]  # noqa: E731
    ok = sum(v for k, v in codes.items() if k in (200, 201))

    print(f"employees            {args.users}")
    print(f"requests             {len(jobs)} ({len(jobs) - args.users} resends)")
    print(f"concurrency          {args.concurrency}")
    print(f"wall time            {wall:.1f} s  ({len(jobs) / wall:.0f} req/s)")
    print(f"status codes         {dict(sorted(codes.items()))}")
    print(f"success rate         {ok / len(jobs) * 100:.2f}%")
    print(f"latency ms           p50 {p(0.50):.0f}  p95 {p(0.95):.0f}  p99 {p(0.99):.0f}  max {latencies[-1]:.0f}"
          f"  mean {statistics.mean(latencies):.0f}")
    print(f"attendance rows      {total} for {distinct} employees (expected {args.users})")
    return 0 if total == args.users and distinct == args.users and ok == len(jobs) else 1


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url", default="http://127.0.0.1:8000")
    ap.add_argument("--users", type=int, default=500)
    ap.add_argument("--concurrency", type=int, default=50)
    ap.add_argument("--resend", type=float, default=0.2, help="share of requests sent twice")
    sys.exit(asyncio.run(main(ap.parse_args())))
