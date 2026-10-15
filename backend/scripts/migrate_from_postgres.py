"""
One-off copy of an existing PostgreSQL HadirOps database into MongoDB.

    pip install asyncpg   # only needed for this script
    PG_URL=postgresql://hadirops:pass@host:5432/hadirops PG_SCHEMA=hadirops \\
    MONGODB_URL="mongodb://host:27017/?replicaSet=rs0" MONGODB_DB=hadirops \\
        python scripts/migrate_from_postgres.py [--drop]

Every row keeps its id, so links, exports and the mobile apps' cached ids stay
valid. Work schedules are folded into their shift, the role table into each
user's `role` field, and pgvector embeddings become plain arrays. The id
counters are raised above the highest copied id. Run it with the API stopped.

`--drop` empties the target collections first; without it the script refuses
to write into a database that already has users.
"""

import argparse
import asyncio
import os
import sys
from datetime import date, time
from pathlib import Path

import asyncpg

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.core.database import client, get_database  # noqa: E402
from app.db.ids import bump_counter  # noqa: E402
from app.db.schema import ensure_schema  # noqa: E402

# table → collection (same name unless listed)
TABLES = [
    "sites", "users", "shifts", "holidays", "attendance", "checkin_attempts",
    "overtime_requests", "leave_requests", "temporary_assignments", "audit_logs",
]
# Ids are only meaningful if the row exists; unique indexes are partial on strings.
OMIT_WHEN_NULL = {"attendance": ("client_event_id", "checkout_event_id", "work_date")}


def _value(v):
    if isinstance(v, date) and not hasattr(v, "hour"):
        return v.isoformat()
    if isinstance(v, time):
        return v.replace(microsecond=0).isoformat()
    return v


def _embedding(v):
    if v is None:
        return None
    if isinstance(v, str):  # pgvector text form "[0.1,0.2,...]"
        return [float(x) for x in v.strip("[]").split(",") if x]
    return [float(x) for x in v]


async def _rows(conn, table):
    try:
        return await conn.fetch(f"SELECT * FROM {table}")
    except asyncpg.UndefinedTableError:
        return []  # older installs may not have every table


async def migrate(drop: bool) -> None:
    conn = await asyncpg.connect(os.environ["PG_URL"])
    await conn.execute(f"SET search_path TO {os.environ.get('PG_SCHEMA', 'hadirops')}, public")
    db = get_database()

    if drop:
        for name in TABLES + ["counters", "locks"]:
            await db[name].delete_many({})
    elif await db.users.count_documents({}, limit=1):
        raise SystemExit("Target database already has users. Use --drop to replace its contents.")
    await ensure_schema(db)

    roles = {r["id"]: r["name"] for r in await conn.fetch("SELECT id, name FROM roles")}
    schedules: dict[int, list] = {}
    for ws in await _rows(conn, "work_schedules"):
        schedules.setdefault(ws["shift_id"], []).append({
            "id": ws["id"], "day_of_week": ws["day_of_week"],
            "toleransi_telat_menit": ws["toleransi_telat_menit"] or 0,
        })

    for table in TABLES:
        docs = []
        max_id = 0
        for row in await _rows(conn, table):
            doc = {k: _value(v) for k, v in dict(row).items() if k != "id"}
            doc["_id"] = row["id"]
            max_id = max(max_id, row["id"])
            if table == "users":
                doc["role"] = roles.get(doc.pop("role_id", None), "EMPLOYEE")
                doc["face_embedding"] = _embedding(row["face_embedding"])
            elif table == "shifts":
                doc["work_schedules"] = sorted(schedules.get(row["id"], []), key=lambda s: s["day_of_week"])
            elif table == "attendance":
                doc["risk_flags"] = list(doc.get("risk_flags") or [])
            for key in OMIT_WHEN_NULL.get(table, ()):
                if doc.get(key) is None:
                    doc.pop(key, None)
            docs.append(doc)
        if docs:
            await db[table].insert_many(docs, ordered=False)
        await bump_counter(db, table, max_id)
        print(f"{table:24} {len(docs):7} documents")

    max_schedule = max((s["id"] for items in schedules.values() for s in items), default=0)
    await bump_counter(db, "work_schedules", max_schedule)
    await conn.close()
    print("done; counters raised above the highest copied ids")


async def main(drop: bool) -> None:
    try:
        await migrate(drop)
    finally:
        await client.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--drop", action="store_true", help="empty the target collections first")
    asyncio.run(main(ap.parse_args().drop))
