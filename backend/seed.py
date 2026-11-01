"""
seed.py — fill an empty database with the sample company (MongoDB).

The same fictional dataset the public demo serves (app/services/demo_data.py):
Acme Field Services with sites in Rotterdam, Jakarta, Houston, Singapore and a
UTC field office, two weeks of attendance up to now, overtime, leave, a review
queue and a temporary assignment.

Usage:
    python seed.py                 # refuses a database that already has users
    python seed.py --reset         # deletes ALL data first

Every account can sign in with the password below. Never run it against a
database with real data; production uses scripts/create_admin.py.
"""

import argparse
import asyncio

from app.core.database import client, get_database
from app.db.ids import forget_blocks
from app.db.schema import ensure_schema
from app.services import demo_data

PASSWORD = "Rollproof-demo1"


async def main(reset: bool) -> None:
    db = get_database()
    try:
        if await db.users.count_documents({}, limit=1):
            if not reset:
                raise SystemExit(f"{db.name} already has users. Run with --reset to replace ALL data.")
            for name in await db.list_collection_names():
                if not name.startswith("system."):
                    await db[name].delete_many({})
            forget_blocks()
        await ensure_schema(db)
        counts = await demo_data.seed_dataset(db, password=PASSWORD)
        print(f"Seeded {db.name}: {counts['sites']} sites, {counts['people']} people, "
              f"{counts['attendance']} attendance records.")
        print(f"\nSign in with password {PASSWORD}:")
        print(f"  Admin      {demo_data.ADMIN_EMAIL}")
        print(f"  Supervisor {demo_data.SUPERVISOR_EMAIL}")
        print(f"  Employee   lars.de.vries@{demo_data.DEMO_DOMAIN}  (or any EMP1xx employee id)")
    finally:
        await client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--reset", action="store_true", help="delete all data before seeding")
    asyncio.run(main(parser.parse_args().reset))
