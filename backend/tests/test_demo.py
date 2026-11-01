"""
Public demo mode: the sample dataset, the daily reset, one-click sign-in and
the guards that keep the shared accounts usable for the next visitor.
"""

import uuid
from datetime import datetime, timedelta, UTC

import pytest

from app.core.config import settings
from app.services import demo_data, demo_service

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest.fixture
async def demo(mongo, monkeypatch):
    """A freshly reset demo database with DEMO_MODE on."""
    from app.core import ratelimit
    from app.db.ids import forget_blocks

    from conftest import COLLECTIONS

    for name in COLLECTIONS:
        await mongo[name].delete_many({})
    forget_blocks()
    await ratelimit.reset()
    monkeypatch.setattr(settings, "DEMO_MODE", True)
    assert await demo_service.reset_if_due(mongo, "test-worker")
    return mongo


async def _sign_in(client, role):
    r = await client.post("/demo/login", json={"role": role})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


async def test_demo_is_off_unless_enabled(client, mongo):
    assert (await client.get("/demo")).json() == {
        "enabled": False, "roles": [], "last_reset_at": None, "next_reset_at": None, "mobile_app_url": None,
    }
    assert (await client.post("/demo/login", json={"role": "ADMIN"})).status_code == 404


async def test_dataset_has_recent_activity_on_every_page(demo):
    assert await demo.sites.count_documents({}) == len(demo_data.SITES)
    assert await demo.attendance.count_documents({}) > 150
    assert await demo.attendance.count_documents({"needs_review": True}) > 0
    assert await demo.overtime_requests.count_documents({"status": "PENDING"}) > 0
    assert await demo.leave_requests.count_documents({"status": "PENDING"}) > 0
    assert await demo.temporary_assignments.count_documents({}) == 1
    two_weeks_ago = (datetime.now(UTC) - timedelta(days=15)).date().isoformat()
    assert await demo.attendance.count_documents({"work_date": {"$lt": two_weeks_ago}}) == 0


async def test_nobody_has_attendance_on_approved_leave(demo):
    async for leave in demo.leave_requests.find({"status": "APPROVED"}):
        clash = await demo.attendance.find_one({
            "user_id": leave["user_id"],
            "work_date": {"$gte": leave["start_date"], "$lte": leave["end_date"]},
        })
        assert clash is None


async def test_reset_runs_once_a_day(demo):
    assert not await demo_service.reset_if_due(demo, "another-worker")
    tomorrow = datetime.now(UTC) + timedelta(days=1)
    assert await demo_service.reset_if_due(demo, "another-worker", now=tomorrow)
    assert abs(await demo_service.last_reset(demo) - tomorrow) < timedelta(seconds=1)


async def test_status_reports_the_next_reset(client, demo):
    body = (await client.get("/demo")).json()
    assert body["enabled"] is True
    assert body["roles"] == ["ADMIN", "SUPERVISOR", "EMPLOYEE"]
    nxt = datetime.fromisoformat(body["next_reset_at"])
    assert (nxt.hour, nxt.minute) == (0, 0) and nxt > datetime.now(UTC)


async def test_shared_accounts_sign_in_without_a_password(client, demo):
    me = (await client.get("/auth/me", headers=await _sign_in(client, "ADMIN"))).json()
    assert (me["email"], me["role"]) == (demo_data.ADMIN_EMAIL, "ADMIN")
    me = (await client.get("/auth/me", headers=await _sign_in(client, "SUPERVISOR"))).json()
    assert me["email"] == demo_data.SUPERVISOR_EMAIL
    # A password login cannot be guessed, so nobody can lock the account
    r = await client.post("/auth/login", json={"identifier": demo_data.ADMIN_EMAIL, "password": "Admin@123"})
    assert r.status_code == 401


async def test_each_visitor_gets_an_employee_account_of_their_own(client, demo):
    first = (await client.get("/auth/me", headers=await _sign_in(client, "EMPLOYEE"))).json()
    second = (await client.get("/auth/me", headers=await _sign_in(client, "EMPLOYEE"))).json()
    assert first["id"] != second["id"]
    assert first["role"] == "EMPLOYEE" and first["site_name"] == demo_data.VISITOR_SITE
    history = await demo.attendance.count_documents({"user_id": first["id"]})
    assert history > 0
    # Nothing in the last two days, so no record falls on "today" in the visitor's time zone
    two_days_ago = (datetime.now(UTC) - timedelta(days=1)).date().isoformat()
    assert await demo.attendance.find_one({"user_id": first["id"], "work_date": {"$gte": two_days_ago}}) is None
    async for record in demo.attendance.find({"user_id": first["id"]}):
        assert record["checkin_time"].date() <= datetime.now(UTC).date() - timedelta(days=2)
    # Visitors report to the demo supervisor, who sees them in the team view
    supervisor = await demo.users.find_one({"email": demo_data.SUPERVISOR_EMAIL})
    assert (await demo.users.find_one({"_id": first["id"]}))["supervisor_id"] == supervisor["_id"]


async def test_visitor_can_check_in_at_any_hour_from_anywhere(client, demo):
    headers = await _sign_in(client, "EMPLOYEE")
    body = {"latitude": -33.86, "longitude": 151.21, "accuracy_m": 10, "client_event_id": str(uuid.uuid4())}
    r = await client.post("/attendance/checkin", headers=headers, json=body)
    assert r.status_code == 201, r.text
    # Far from the field office: recorded and flagged, not refused
    assert r.json()["status"] == "OUT_OF_RADIUS"


async def test_shared_accounts_cannot_be_changed(client, demo, face):
    admin = await _sign_in(client, "ADMIN")
    admin_id = (await client.get("/auth/me", headers=admin)).json()["id"]
    supervisor = await demo.users.find_one({"email": demo_data.SUPERVISOR_EMAIL})

    r = await client.post("/auth/change-password", headers=admin,
                          json={"current_password": "x", "new_password": "Another-pass1"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "DEMO_READ_ONLY"
    assert (await client.delete(f"/users/{supervisor['_id']}", headers=admin)).status_code == 403
    r = await client.put(f"/users/{admin_id}", headers=admin, json={"name": "Someone else"})
    assert r.status_code == 403

    # A face goes only on the visitor's own employee account
    files = {"file": ("face.jpg", b"jpeg", "image/jpeg")}
    assert (await client.post(f"/face/register/{admin_id}", headers=admin, files=files)).status_code == 403
    visitor = await _sign_in(client, "EMPLOYEE")
    visitor_id = (await client.get("/auth/me", headers=visitor)).json()["id"]
    assert (await client.post(f"/face/register/{visitor_id}", headers=admin, files=files)).status_code == 403
    assert (await client.post(f"/face/register/{visitor_id}", headers=visitor, files=files)).status_code == 200


async def test_reset_removes_visitors_and_their_faces(client, demo):
    headers = await _sign_in(client, "EMPLOYEE")
    visitor_id = (await client.get("/auth/me", headers=headers)).json()["id"]
    await demo.users.update_one({"_id": visitor_id}, {"$set": {"face_embedding": [0.1] * 128}})
    await demo_service.reset(demo, datetime.now(UTC) + timedelta(days=1))
    assert await demo.users.find_one({"_id": visitor_id}) is None
    assert await demo.users.count_documents({"face_embedding": {"$ne": None}}) == 0
    assert (await client.get("/auth/me", headers=headers)).status_code == 401
