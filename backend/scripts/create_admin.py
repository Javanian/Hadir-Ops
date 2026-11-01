"""Create the first administrator of a fresh production database.

seed.py fills the database with fictional sites, employees and attendance for
demos. A real deployment starts empty and needs one admin to log in to the web
dashboard; everything else is created from there.

    docker compose -f docker-compose.prod.yml exec backend \
        python scripts/create_admin.py --email it@example.com --name "IT Admin"

The password is read from ADMIN_PASSWORD or asked for interactively, never
taken from the command line (it would end up in the shell history).
"""

import argparse
import asyncio
import getpass
import os
import sys
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.database import client, get_database
from app.core.security import get_password_hash, validate_new_password
from app.db.ids import next_id
from app.db.schema import ensure_schema


async def create_admin(email: str, name: str, employee_id: str, password: str) -> int:
    db = get_database()
    await ensure_schema(db)
    email = email.strip().lower()
    existing = await db.users.find_one({"$or": [{"email": email}, {"employee_id": employee_id}]})
    if existing:
        raise SystemExit(f"A user with email {email} or employee id {employee_id} already exists.")
    user_id = await next_id(db, "users")
    await db.users.insert_one({
        "_id": user_id, "employee_id": employee_id, "name": name, "email": email,
        "password_hash": get_password_hash(password), "role": "ADMIN", "site_id": None,
        "supervisor_id": None, "face_embedding": None, "is_active": True,
        "failed_login_attempts": 0, "locked_until": None, "password_changed_at": None,
        "created_at": datetime.now(UTC),
    })
    return user_id


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", default="Administrator")
    parser.add_argument("--employee-id", default="ADM001")
    args = parser.parse_args()

    password = os.environ.get("ADMIN_PASSWORD") or getpass.getpass("Password for the new admin: ")
    try:
        validate_new_password(password)
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc

    async def run() -> int:
        try:
            return await create_admin(args.email, args.name, args.employee_id, password)
        finally:
            await client.close()

    user_id = asyncio.run(run())
    print(f"Admin {args.email} created (id {user_id}). Log in to the web dashboard with it.")


if __name__ == "__main__":
    main()
