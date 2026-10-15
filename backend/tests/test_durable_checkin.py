"""
End-to-end tests of the check-in contract against MongoDB.

They cover the failure modes found in low-star reviews of other attendance
apps: retries that double-record, offline check-ins that never arrive or get
the wrong time, GPS drift that rejects honest people, and failures that leave
no trace for the supervisor.
"""

import asyncio
import math
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from conftest import SITE_LAT, SITE_LON

pytestmark = pytest.mark.asyncio(loop_scope="session")

UTC = timezone.utc


def _offset_point(metres_north: float):
    """A point `metres_north` metres north of the site."""
    return SITE_LAT + metres_north / 111_320.0, SITE_LON


def _body(lat=SITE_LAT, lon=SITE_LON, **extra):
    body = {"latitude": lat, "longitude": lon, "accuracy_m": 8, "client_event_id": str(uuid.uuid4())}
    body.update(extra)
    return body


async def _face_token(client, seed, face):
    face.verified = True
    r = await client.post(
        f"/face/verify/{seed['emp_id']}",
        headers=seed["emp"],
        files={"file": ("f.jpg", b"jpeg-bytes", "image/jpeg")},
    )
    assert r.status_code == 200, r.text
    return r.json()["face_token"]


async def _rows(user_id=None):
    from app.core.database import get_database

    return await get_database().attendance.count_documents({"user_id": user_id} if user_id else {})


async def _set_face(user_id):
    from app.core.database import get_database

    await get_database().users.update_one({"_id": user_id}, {"$set": {"face_embedding": [0.1] * 512}})


# ── Online check-in ────────────────────────────────────────────────────────────

async def test_online_checkin_with_face_token_is_clean(client, seed, face):
    await _set_face(seed["emp_id"])
    token = await _face_token(client, seed, face)
    r = await client.post("/attendance/checkin", headers=seed["emp"], json=_body(face_token=token))
    assert r.status_code == 201, r.text
    rec = r.json()
    assert rec["status"] == "ONTIME"
    assert rec["risk_flags"] == []
    assert rec["needs_review"] is False
    assert rec["face_similarity"] == pytest.approx(0.82)


async def test_face_token_of_another_user_is_not_accepted(client, seed, face):
    await _set_face(seed["emp_id"])
    token = await _face_token(client, seed, face)
    r = await client.post("/attendance/checkin", headers=seed["emp2"], json=_body(face_token=token))
    assert r.status_code == 201
    assert "FACE_NOT_VERIFIED" in r.json()["risk_flags"]
    assert r.json()["needs_review"] is True


# ── Idempotency and races ──────────────────────────────────────────────────────

async def test_retry_with_same_event_id_returns_same_record(client, seed):
    body = _body()
    first = await client.post("/attendance/checkin", headers=seed["emp"], json=body)
    second = await client.post("/attendance/checkin", headers=seed["emp"], json=body)
    assert first.status_code == 201
    assert second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert await _rows(seed["emp_id"]) == 1


async def test_concurrent_retries_create_one_record(client, seed):
    body = _body()
    results = await asyncio.gather(
        *[client.post("/attendance/checkin", headers=seed["emp"], json=body) for _ in range(8)]
    )
    assert {r.status_code for r in results} <= {200, 201}
    assert len({r.json()["id"] for r in results}) == 1
    assert await _rows(seed["emp_id"]) == 1


async def test_concurrent_double_tap_with_new_ids_records_once(client, seed):
    results = await asyncio.gather(
        *[client.post("/attendance/checkin", headers=seed["emp"], json=_body()) for _ in range(6)]
    )
    codes = sorted(r.status_code for r in results)
    assert codes.count(201) == 1
    assert set(codes) <= {201, 409}
    assert await _rows(seed["emp_id"]) == 1


async def test_event_id_of_another_user_is_refused(client, seed):
    body = _body()
    assert (await client.post("/attendance/checkin", headers=seed["emp"], json=body)).status_code == 201
    r = await client.post("/attendance/checkin", headers=seed["emp2"], json=body)
    assert r.status_code == 409


# ── Offline ────────────────────────────────────────────────────────────────────

async def test_offline_checkin_keeps_the_real_time(client, seed):
    age_ms = 2 * 3600 * 1000
    captured = datetime.now(UTC) - timedelta(milliseconds=age_ms)
    r = await client.post(
        "/attendance/checkin",
        headers=seed["emp"],
        json=_body(captured_at=captured.isoformat(), capture_age_ms=age_ms),
    )
    assert r.status_code == 201, r.text
    rec = r.json()
    checkin = datetime.fromisoformat(rec["checkin_time"])
    assert abs((checkin - captured).total_seconds()) < 5
    assert rec["is_offline"] is True
    assert "OFFLINE_SYNC" in rec["risk_flags"]
    # No face proof could be fetched offline, so it waits for review
    assert "FACE_NOT_VERIFIED" in rec["risk_flags"]
    assert rec["needs_review"] is True


async def test_offline_checkin_too_old_is_refused(client, seed):
    r = await client.post(
        "/attendance/checkin", headers=seed["emp"], json=_body(capture_age_ms=80 * 3600 * 1000)
    )
    assert r.status_code == 422
    assert await _rows(seed["emp_id"]) == 0


async def test_moved_phone_clock_goes_to_review(client, seed):
    claimed = datetime.now(UTC) - timedelta(hours=1)
    r = await client.post(
        "/attendance/checkin",
        headers=seed["emp"],
        json=_body(captured_at=claimed.isoformat(), capture_age_ms=1000),
    )
    assert r.status_code == 201
    rec = r.json()
    assert "CLOCK_MISMATCH" in rec["risk_flags"]
    assert rec["needs_review"] is True
    # The claimed time is kept for the supervisor to judge
    assert abs((datetime.fromisoformat(rec["checkin_time"]) - claimed).total_seconds()) < 2


async def test_face_photo_added_later_clears_the_flag(client, seed, face):
    await _set_face(seed["emp_id"])
    r = await client.post(
        "/attendance/checkin", headers=seed["emp"],
        json=_body(captured_at=(datetime.now(UTC) - timedelta(minutes=10)).isoformat(),
                   capture_age_ms=600_000),
    )
    rec = r.json()
    assert "FACE_NOT_VERIFIED" in rec["risk_flags"]

    face.verified = True
    r = await client.post(
        f"/attendance/{rec['id']}/face", headers=seed["emp"],
        files={"file": ("f.jpg", b"jpeg-bytes", "image/jpeg")},
    )
    assert r.status_code == 200, r.text
    rec = r.json()
    assert "FACE_NOT_VERIFIED" not in rec["risk_flags"]
    assert rec["needs_review"] is False
    assert rec["face_similarity"] == pytest.approx(0.82)


async def test_face_photo_mismatch_stays_in_review(client, seed, face):
    await _set_face(seed["emp_id"])
    r = await client.post("/attendance/checkin", headers=seed["emp"], json=_body())
    face.verified = False
    r = await client.post(
        f"/attendance/{r.json()['id']}/face", headers=seed["emp"],
        files={"file": ("f.jpg", b"jpeg-bytes", "image/jpeg")},
    )
    assert "FACE_MISMATCH" in r.json()["risk_flags"]
    assert r.json()["needs_review"] is True


# ── GPS ────────────────────────────────────────────────────────────────────────

async def test_gps_drift_inside_accuracy_is_accepted_with_flag(client, seed):
    lat, lon = _offset_point(140)  # radius is 100 m
    r = await client.post(
        "/attendance/checkin", headers=seed["emp"], json=_body(lat=lat, lon=lon, accuracy_m=60)
    )
    rec = r.json()
    assert rec["status"] == "ONTIME"
    assert "LOW_GPS_ACCURACY" in rec["risk_flags"]
    assert rec["needs_review"] is True


async def test_precise_reading_outside_is_out_of_radius(client, seed):
    lat, lon = _offset_point(140)
    r = await client.post(
        "/attendance/checkin", headers=seed["emp"], json=_body(lat=lat, lon=lon, accuracy_m=10)
    )
    assert r.json()["status"] == "OUT_OF_RADIUS"
    assert r.json()["needs_review"] is True


async def test_mock_location_is_recorded_not_blocked(client, seed):
    r = await client.post("/attendance/checkin", headers=seed["emp"], json=_body(is_mocked=True))
    assert r.status_code == 201
    assert "MOCK_LOCATION" in r.json()["risk_flags"]
    assert r.json()["needs_review"] is True


async def test_old_client_without_new_fields_still_works(client, seed):
    r = await client.post(
        "/attendance/checkin", headers=seed["emp"], json={"latitude": SITE_LAT, "longitude": SITE_LON}
    )
    assert r.status_code == 201
    assert r.json()["status"] == "ONTIME"


# ── Check-out ──────────────────────────────────────────────────────────────────

async def test_checkout_retry_is_idempotent(client, seed):
    await client.post("/attendance/checkin", headers=seed["emp"], json=_body())
    body = {"client_event_id": str(uuid.uuid4())}
    first = await client.post("/attendance/checkout", headers=seed["emp"], json=body)
    second = await client.post("/attendance/checkout", headers=seed["emp"], json=body)
    assert first.status_code == 201, first.text
    assert second.status_code == 200
    assert first.json()["checkout_time"] == second.json()["checkout_time"]


async def test_offline_checkout_replaces_auto_checkout(client, seed, mongo):

    # Checked in 5 h ago (queued offline), then the worker closed the record
    age = 5 * 3600 * 1000
    r = await client.post("/attendance/checkin", headers=seed["emp"], json=_body(capture_age_ms=age))
    att_id = r.json()["id"]
    auto_end = datetime.now(UTC) - timedelta(hours=3)
    await mongo.attendance.update_one(
        {"_id": att_id}, {"$set": {"checkout_time": auto_end, "auto_checkout": True}}
    )

    # The real check-out happened 1 h ago and arrives now
    r = await client.post(
        "/attendance/checkout", headers=seed["emp"],
        json={"client_event_id": str(uuid.uuid4()), "capture_age_ms": 3600 * 1000},
    )
    assert r.status_code == 201, r.text
    rec = r.json()
    assert rec["id"] == att_id
    assert rec["auto_checkout"] is False
    real_end = datetime.now(UTC) - timedelta(hours=1)
    assert abs((datetime.fromisoformat(rec["checkout_time"]) - real_end).total_seconds()) < 10
    assert 235 <= rec["work_duration_minutes"] <= 241


async def test_checkout_without_open_record_is_404(client, seed):
    r = await client.post("/attendance/checkout", headers=seed["emp"], json={})
    assert r.status_code == 404


# ── Failed attempts ────────────────────────────────────────────────────────────

async def test_attempts_are_stored_once_and_visible_to_own_supervisor(client, seed):
    now = datetime.now(UTC)
    attempts = [
        {"client_event_id": str(uuid.uuid4()), "kind": "CHECKIN", "reason": reason,
         "captured_at": (now - timedelta(minutes=i)).isoformat(), "latitude": SITE_LAT,
         "longitude": SITE_LON, "accuracy_m": 30, "app_version": "1.1.0"}
        for i, reason in enumerate(["NO_GPS", "NETWORK", "FACE_MISMATCH"])
    ]
    r = await client.post("/attendance/attempts", headers=seed["emp"], json={"attempts": attempts})
    assert r.json() == {"accepted": 3, "duplicates": 0}
    r = await client.post("/attendance/attempts", headers=seed["emp"], json={"attempts": attempts})
    assert r.json() == {"accepted": 0, "duplicates": 3}

    mine = await client.get("/attendance/attempts", headers=seed["sup_a"])
    assert mine.status_code == 200
    assert [a["reason"] for a in mine.json()] == ["NO_GPS", "NETWORK", "FACE_MISMATCH"]
    assert mine.json()[0]["employee_id"] == "EMP1"

    other = await client.get("/attendance/attempts", headers=seed["sup_b"])
    assert other.json() == []

    forbidden = await client.get("/attendance/attempts", headers=seed["emp"])
    assert forbidden.status_code == 403


# ── Review queue ───────────────────────────────────────────────────────────────

async def test_review_queue_flow(client, seed):
    r = await client.post("/attendance/checkin", headers=seed["emp"], json=_body(is_mocked=True))
    att_id = r.json()["id"]

    queue = await client.get("/attendance/review", headers=seed["sup_a"])
    assert [q["id"] for q in queue.json()] == [att_id]
    assert (await client.get("/attendance/review", headers=seed["sup_b"])).json() == []

    no_note = await client.post(f"/attendance/{att_id}/review", headers=seed["sup_a"],
                                json={"decision": "REJECTED"})
    assert no_note.status_code == 422

    other_team = await client.post(f"/attendance/{att_id}/review", headers=seed["sup_b"],
                                   json={"decision": "APPROVED"})
    assert other_team.status_code == 403

    employee = await client.post(f"/attendance/{att_id}/review", headers=seed["emp"],
                                 json={"decision": "APPROVED"})
    assert employee.status_code == 403

    ok = await client.post(f"/attendance/{att_id}/review", headers=seed["sup_a"],
                           json={"decision": "APPROVED", "note": "Phone of a colleague, checked on site"})
    assert ok.status_code == 200
    assert ok.json()["review_status"] == "APPROVED"
    assert ok.json()["needs_review"] is False

    assert (await client.get("/attendance/review", headers=seed["sup_a"])).json() == []
    history = await client.get("/attendance/review?state=all", headers=seed["admin"])
    assert [h["review_status"] for h in history.json()] == ["APPROVED"]


# ── Operations ─────────────────────────────────────────────────────────────────

async def test_health_reports_database(client, app):
    app.state.face_app = object()
    r = await client.get("/health/ready")
    assert r.status_code == 200
    assert r.json()["checks"]["database"]["ok"] is True
    app.state.face_app = None
    r = await client.get("/health/ready")
    assert r.status_code == 503
    assert (await client.get("/health/live")).status_code == 200


async def test_auto_checkout_runs_in_one_process_at_a_time(seed, mongo):
    from app.db import locks
    from app.main import AUTO_CHECKOUT_LOCK, run_auto_checkout_once

    assert await locks.acquire(mongo, AUTO_CHECKOUT_LOCK, "other-worker", ttl_seconds=60)
    assert await run_auto_checkout_once() is None
    await locks.release(mongo, AUTO_CHECKOUT_LOCK, "other-worker")
    assert await run_auto_checkout_once() == (0, 0)


async def test_an_expired_lease_does_not_block_the_worker(seed, mongo):
    from app.main import AUTO_CHECKOUT_LOCK, run_auto_checkout_once

    # A worker that died mid-pass left its lease behind; it has expired.
    await mongo.locks.insert_one({
        "_id": AUTO_CHECKOUT_LOCK, "owner": "crashed-worker",
        "expires_at": datetime.now(UTC) - timedelta(seconds=1),
    })
    assert await run_auto_checkout_once() == (0, 0)
