"""
Morning-rush load test: every employee checks in within the same minute,
and part of them resend the same request as a flaky network would.

Seeds N employees into the database the API is using, mints their access
tokens with the API's SECRET_KEY, fires the check-ins, and then counts rows to
confirm there is exactly one record per employee.

    DATABASE_URL=... SECRET_KEY=... python scripts/load_checkin.py \
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

import asyncpg
import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.security import create_access_token  # noqa: E402

LAT, LON = -6.2, 106.816666


async def seed(db_url: str, schema: str, n: int) -> list[int]:
    conn = await asyncpg.connect(db_url.replace("postgresql+asyncpg://", "postgresql://"))
    try:
        await conn.execute(f"SET search_path TO {schema}, public")
        await conn.execute("DELETE FROM users WHERE employee_id LIKE 'LOAD%'")
        await conn.execute("DELETE FROM sites WHERE name = 'Load test site'")
        site_id = await conn.fetchval(
            "INSERT INTO sites (name, latitude, longitude, radius_meter, timezone) "
            "VALUES ('Load test site', $1, $2, 150, 'Asia/Jakarta') RETURNING id", LAT, LON
        )
        shift_id = await conn.fetchval(
            "INSERT INTO shifts (site_id, name, start_time, end_time) "
            "VALUES ($1, 'Load all day', '00:00', '23:59:59') RETURNING id", site_id
        )
        await conn.executemany(
            "INSERT INTO work_schedules (shift_id, day_of_week, toleransi_telat_menit) VALUES ($1, $2, 15)",
            [(shift_id, d) for d in range(7)],
        )
        role_id = await conn.fetchval("SELECT id FROM roles WHERE name = 'EMPLOYEE'")
        rows = await conn.fetch(
            "INSERT INTO users (employee_id, name, email, password_hash, role_id, site_id) "
            "SELECT 'LOAD' || g, 'Load ' || g, 'load' || g || '@example.test', 'x', $1, $2 "
            "FROM generate_series(1, $3) g RETURNING id",
            role_id, site_id, n,
        )
        return [r["id"] for r in rows]
    finally:
        await conn.close()


async def count_rows(db_url: str, schema: str, user_ids: list[int]) -> tuple[int, int]:
    conn = await asyncpg.connect(db_url.replace("postgresql+asyncpg://", "postgresql://"))
    try:
        await conn.execute(f"SET search_path TO {schema}, public")
        total = await conn.fetchval("SELECT count(*) FROM attendance WHERE user_id = ANY($1)", user_ids)
        users = await conn.fetchval(
            "SELECT count(DISTINCT user_id) FROM attendance WHERE user_id = ANY($1)", user_ids
        )
        return total, users
    finally:
        await conn.close()


async def main(args) -> int:
    db_url = os.environ["DATABASE_URL"]
    schema = os.environ.get("DB_SCHEMA", "hadirops")
    user_ids = await seed(db_url, schema, args.users)

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

    total, distinct = await count_rows(db_url, schema, user_ids)
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
