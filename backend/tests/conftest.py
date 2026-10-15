"""
Test setup: a real MongoDB replica set, the real indexes and validators
(app.db.schema) and the FastAPI app in-process.

    TEST_MONGODB_URL="mongodb://localhost:27017/?replicaSet=rs0" pytest

Transactions need a replica set; a single-node set is enough. The test
database is dropped at the start of the run and emptied before each test.
"""

import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
TEST_URL = os.environ.get("TEST_MONGODB_URL", "mongodb://localhost:27017/?replicaSet=rs0")
TEST_DB = os.environ.get("TEST_MONGODB_DB", "hadirops_test")

os.environ["MONGODB_URL"] = TEST_URL
os.environ["MONGODB_DB"] = TEST_DB
os.environ["FACE_ENABLED"] = "true"
os.environ["AUTO_CHECKOUT_ENABLED"] = "false"
os.environ["SECRET_KEY"] = "test-secret-key-for-the-test-suite-only-0123456789"

sys.path.insert(0, str(ROOT / "backend"))

# Start from an empty database (a synchronous client, before any event loop).
from pymongo import MongoClient  # noqa: E402

MongoClient(TEST_URL, serverSelectionTimeoutMS=10000).drop_database(TEST_DB)


# ── Fixtures ───────────────────────────────────────────────────────────────────

import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

SITE_LAT, SITE_LON, SITE_RADIUS = -6.200000, 106.816666, 100
COLLECTIONS = (
    "users", "sites", "shifts", "holidays", "attendance", "checkin_attempts",
    "overtime_requests", "leave_requests", "temporary_assignments", "audit_logs",
    "counters", "locks",
)


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


@pytest_asyncio.fixture(loop_scope="session", scope="session")
async def mongo(app):
    """The application database, with indexes and validators in place."""
    from app.core.database import client, get_database
    from app.db.schema import ensure_schema

    db = get_database()
    await ensure_schema(db)
    yield db
    await client.close()


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
async def seed(mongo):
    """Fresh data for each test: one site, an all-day shift, an admin,
    two supervisors and two employees (both reporting to supervisor A)."""
    from app.core.security import create_access_token, get_password_hash
    from app.db.ids import forget_blocks, next_id

    for name in COLLECTIONS:
        await mongo[name].delete_many({})
    forget_blocks()  # counters were wiped with the rest

    now = datetime.now(timezone.utc)
    site_id = await next_id(mongo, "sites")
    await mongo.sites.insert_one({
        "_id": site_id, "name": "Plant A", "latitude": SITE_LAT, "longitude": SITE_LON,
        "radius_meter": SITE_RADIUS, "timezone": "Asia/Jakarta", "created_at": now,
    })
    shift_id = await next_id(mongo, "shifts")
    await mongo.shifts.insert_one({
        "_id": shift_id, "site_id": site_id, "name": "All day",
        "start_time": "00:00:00", "end_time": "23:59:59",
        "is_cross_midnight": False, "work_hours_standard": 8, "created_at": now,
        "work_schedules": [
            {"id": await next_id(mongo, "work_schedules"), "day_of_week": dow, "toleransi_telat_menit": 1440}
            for dow in range(7)
        ],
    })

    pw = get_password_hash("Password1!")

    async def add_user(code, name, role, supervisor=None):
        user_id = await next_id(mongo, "users")
        await mongo.users.insert_one({
            "_id": user_id, "employee_id": code, "name": name, "email": f"{code.lower()}@example.test",
            "password_hash": pw, "role": role, "site_id": site_id, "supervisor_id": supervisor,
            "face_embedding": None, "is_active": True, "failed_login_attempts": 0,
            "locked_until": None, "password_changed_at": None, "created_at": now,
        })
        return user_id

    admin = await add_user("ADM1", "Admin", "ADMIN")
    sup_a = await add_user("SUP1", "Supervisor A", "SUPERVISOR")
    sup_b = await add_user("SUP2", "Supervisor B", "SUPERVISOR")
    emp = await add_user("EMP1", "Employee One", "EMPLOYEE", sup_a)
    emp2 = await add_user("EMP2", "Employee Two", "EMPLOYEE", sup_a)

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
