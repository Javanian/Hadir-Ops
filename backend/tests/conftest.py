"""
Test setup: a real PostgreSQL database, the real schema (database.sql) and the
FastAPI app in-process.

    TEST_DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/hadirops_test pytest

The database is dropped and recreated from database.sql at the start of the
run. If the pgvector extension is not installed on that server, face
embeddings are stored as TEXT instead; nothing else changes.
"""

import asyncio
import os
import re
import sys
from pathlib import Path

import asyncpg
import pytest

ROOT = Path(__file__).resolve().parents[2]
TEST_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+asyncpg://hadirops:hadiropspass@localhost:5432/hadirops_test"
)
_PLAIN_URL = TEST_URL.replace("postgresql+asyncpg://", "postgresql://")


async def _prepare_database() -> bool:
    """Recreate the test database. Returns True if pgvector is available."""
    admin_url = re.sub(r"/[^/]+$", "/postgres", _PLAIN_URL)
    db_name = _PLAIN_URL.rsplit("/", 1)[1].split("?")[0]
    conn = await asyncpg.connect(admin_url)
    try:
        await conn.execute(f'DROP DATABASE IF EXISTS "{db_name}" WITH (FORCE)')
        await conn.execute(f'CREATE DATABASE "{db_name}"')
    finally:
        await conn.close()

    schema = (ROOT / "database.sql").read_text(encoding="utf-8")
    conn = await asyncpg.connect(_PLAIN_URL)
    try:
        try:
            await conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
            has_vector = True
        except asyncpg.PostgresError:
            has_vector = False
            schema = schema.replace("CREATE EXTENSION IF NOT EXISTS vector;", "")
            schema = schema.replace("VECTOR(512)", "TEXT")
            schema = re.sub(
                r"CREATE INDEX idx_users_face_embedding.*?;", "", schema, flags=re.S
            )
        await conn.execute(schema)
    finally:
        await conn.close()
    return has_vector


HAS_VECTOR = asyncio.run(_prepare_database())
if not HAS_VECTOR:
    # Make app.models fall back to a TEXT column for face_embedding.
    sys.modules["pgvector.sqlalchemy"] = None

os.environ["DATABASE_URL"] = TEST_URL
os.environ["DB_SCHEMA"] = "hadirops"
os.environ["FACE_ENABLED"] = "true"
os.environ["AUTO_CHECKOUT_ENABLED"] = "false"
os.environ["SECRET_KEY"] = "test-secret-key-for-the-test-suite-only-0123456789"

sys.path.insert(0, str(ROOT / "backend"))


# ── Fixtures ───────────────────────────────────────────────────────────────────

import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

SITE_LAT, SITE_LON, SITE_RADIUS = -6.200000, 106.816666, 100


class StubFace:
    """Stands in for the InsightFace model: `verified` decides the outcome."""

    def __init__(self):
        self.verified = True
        self.similarity = 0.82

    def verify(self, image_bytes, stored):
        sim = self.similarity if self.verified else 0.05
        return {"verified": self.verified, "similarity": sim, "threshold": 0.3}


@pytest.fixture(scope="session")
def app():
    from app.main import app as fastapi_app

    return fastapi_app


@pytest.fixture
def face(app, monkeypatch):
    stub = StubFace()
    import app.routers.face as face_router

    monkeypatch.setattr(face_router, "_get_face_service", lambda request: stub)
    return stub


@pytest_asyncio.fixture(loop_scope="session")
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture(loop_scope="session")
async def seed():
    """Fresh data for each test: one site, an all-day shift, an admin,
    two supervisors and two employees (both reporting to supervisor A)."""
    from app.core.database import AsyncSessionLocal
    from app.core.security import create_access_token, get_password_hash

    async with AsyncSessionLocal() as db:
        await db.execute(text(
            "TRUNCATE leave_requests, checkin_attempts, overtime_requests, attendance, temporary_assignments, "
            "work_schedules, shifts, holidays, audit_logs, users, sites RESTART IDENTITY CASCADE"
        ))
        site_id = (await db.execute(text(
            "INSERT INTO sites (name, latitude, longitude, radius_meter, timezone) "
            "VALUES ('Plant A', :lat, :lon, :r, 'Asia/Jakarta') RETURNING id"
        ), {"lat": SITE_LAT, "lon": SITE_LON, "r": SITE_RADIUS})).scalar_one()
        shift_id = (await db.execute(text(
            "INSERT INTO shifts (site_id, name, start_time, end_time) "
            "VALUES (:s, 'All day', '00:00', '23:59:59') RETURNING id"
        ), {"s": site_id})).scalar_one()
        for dow in range(7):
            await db.execute(text(
                "INSERT INTO work_schedules (shift_id, day_of_week, toleransi_telat_menit) "
                "VALUES (:sh, :d, 1440)"
            ), {"sh": shift_id, "d": dow})

        pw = get_password_hash("Password1!")
        roles = dict((await db.execute(text("SELECT name, id FROM roles"))).all())

        async def add_user(code, name, role, supervisor=None):
            return (await db.execute(text(
                "INSERT INTO users (employee_id, name, email, password_hash, role_id, site_id, supervisor_id) "
                "VALUES (:c, :n, :e, :p, :r, :s, :sup) RETURNING id"
            ), {"c": code, "n": name, "e": f"{code.lower()}@example.test", "p": pw,
                "r": roles[role], "s": site_id, "sup": supervisor})).scalar_one()

        admin = await add_user("ADM1", "Admin", "ADMIN")
        sup_a = await add_user("SUP1", "Supervisor A", "SUPERVISOR")
        sup_b = await add_user("SUP2", "Supervisor B", "SUPERVISOR")
        emp = await add_user("EMP1", "Employee One", "EMPLOYEE", sup_a)
        emp2 = await add_user("EMP2", "Employee Two", "EMPLOYEE", sup_a)
        await db.commit()

    def auth(user_id):
        return {"Authorization": f"Bearer {create_access_token({'sub': str(user_id)})}"}

    return {
        "site_id": site_id,
        "shift_id": shift_id,
        "admin": auth(admin),
        "sup_a": auth(sup_a),
        "sup_b": auth(sup_b),
        "emp": auth(emp),
        "emp2": auth(emp2),
        "emp_id": emp,
        "emp2_id": emp2,
    }
