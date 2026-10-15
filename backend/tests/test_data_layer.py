"""
MongoDB data layer: what the old foreign keys and CHECK constraints did,
and two behaviours that were wrong before the move.
"""

import uuid

import pytest
from pymongo.errors import WriteError

from conftest import SITE_LAT, SITE_LON

pytestmark = pytest.mark.asyncio(loop_scope="session")


async def test_new_site_keeps_its_timezone(client, seed):
    # Previously every new site was saved as Asia/Jakarta.
    r = await client.post(
        "/sites",
        headers=seed["admin"],
        json={"name": "Site Makassar", "latitude": -5.14, "longitude": 119.43, "radius_meter": 120,
              "timezone": "Asia/Makassar"},
    )
    assert r.status_code == 201, r.text
    assert r.json()["timezone"] == "Asia/Makassar"


async def test_admin_can_create_a_sales_user(client, seed):
    # SALES was missing from the accepted roles although the dashboard offers it.
    r = await client.post(
        "/users",
        headers=seed["admin"],
        json={"employee_id": "SAL9", "name": "Sales Sembilan", "email": "sal9@example.test",
              "password": "Password1!", "role": "SALES", "site_id": seed["site_id"]},
    )
    assert r.status_code == 201, r.text
    assert r.json()["role"] == "SALES"


async def test_deleting_a_user_removes_their_records(client, seed, mongo):
    body = {"latitude": SITE_LAT, "longitude": SITE_LON, "accuracy_m": 8, "client_event_id": str(uuid.uuid4())}
    assert (await client.post("/attendance/checkin", headers=seed["emp"], json=body)).status_code == 201
    await mongo.leave_requests.insert_one({
        "_id": 7001, "user_id": seed["emp_id"], "leave_type": "SICK", "start_date": "2026-01-01",
        "end_date": "2026-01-02", "reason": "flu", "status": "PENDING",
    })

    r = await client.delete(f"/users/{seed['emp_id']}", headers=seed["admin"])
    assert r.status_code == 204
    assert await mongo.attendance.count_documents({"user_id": seed["emp_id"]}) == 0
    assert await mongo.leave_requests.count_documents({"user_id": seed["emp_id"]}) == 0
    assert await mongo.users.count_documents({"_id": seed["emp_id"]}) == 0


async def test_deleting_a_supervisor_clears_the_reporting_line(client, seed, mongo):
    sup_a = (await mongo.users.find_one({"employee_id": "SUP1"}))["_id"]
    r = await client.delete(f"/users/{sup_a}", headers=seed["admin"])
    assert r.status_code == 204
    emp = await mongo.users.find_one({"_id": seed["emp_id"]})
    assert emp["supervisor_id"] is None


async def test_site_or_shift_in_use_cannot_be_deleted(client, seed):
    r = await client.delete(f"/sites/{seed['site_id']}", headers=seed["admin"])
    assert r.status_code == 409

    body = {"latitude": SITE_LAT, "longitude": SITE_LON, "accuracy_m": 8, "client_event_id": str(uuid.uuid4())}
    assert (await client.post("/attendance/checkin", headers=seed["emp"], json=body)).status_code == 201
    r = await client.delete(f"/shifts/{seed['shift_id']}", headers=seed["admin"])
    assert r.status_code == 409


async def test_shift_schedules_live_inside_the_shift(client, seed, mongo):
    r = await client.post(
        "/shifts",
        headers=seed["admin"],
        json={"site_id": seed["site_id"], "name": "Malam", "start_time": "22:00", "end_time": "06:00",
              "is_cross_midnight": True,
              "schedules": [{"day_of_week": 1, "toleransi_telat_menit": 10},
                            {"day_of_week": 2, "toleransi_telat_menit": 10}]},
    )
    assert r.status_code == 201, r.text
    shift = r.json()
    assert [s["day_of_week"] for s in shift["schedules"]] == [1, 2]

    doc = await mongo.shifts.find_one({"_id": shift["id"]})
    assert len(doc["work_schedules"]) == 2

    schedule_id = shift["schedules"][0]["id"]
    r = await client.delete(f"/schedules/{schedule_id}", headers=seed["admin"])
    assert r.status_code == 204
    r = await client.get(f"/shifts/{shift['id']}", headers=seed["admin"])
    assert [s["day_of_week"] for s in r.json()["schedules"]] == [2]


async def test_validator_rejects_a_leave_that_ends_before_it_starts(mongo):
    with pytest.raises(WriteError):
        await mongo.leave_requests.insert_one({
            "_id": 7002, "user_id": 1, "leave_type": "SICK", "start_date": "2026-05-10",
            "end_date": "2026-05-01", "reason": "x", "status": "PENDING",
        })
    with pytest.raises(WriteError):
        await mongo.leave_requests.insert_one({
            "_id": 7003, "user_id": 1, "leave_type": "HOLIDAY", "start_date": "2026-05-01",
            "end_date": "2026-05-01", "reason": "x", "status": "PENDING",
        })


async def test_ids_stay_unique_when_handed_out_concurrently(mongo):
    import asyncio

    from app.db.ids import BLOCK_SIZE, next_id

    ids = await asyncio.gather(*[next_id(mongo, "id_test") for _ in range(300)])
    assert len(set(ids)) == 300
    # Blocks are reserved with one $inc each, not one write per id
    counter = await mongo.counters.find_one({"_id": "id_test"})
    assert counter["seq"] == -(-300 // BLOCK_SIZE) * BLOCK_SIZE
