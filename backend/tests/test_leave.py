"""
Leave requests: submission rules, overlap, cancellation and team decisions.
"""

import asyncio
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

pytestmark = pytest.mark.asyncio(loop_scope="session")


def _today() -> date:
    return datetime.now(ZoneInfo("Asia/Jakarta")).date()


def _body(start_offset=1, days=2, leave_type="ANNUAL", reason="Acara keluarga"):
    start = _today() + timedelta(days=start_offset)
    return {
        "leave_type": leave_type,
        "start_date": start.isoformat(),
        "end_date": (start + timedelta(days=days - 1)).isoformat(),
        "reason": reason,
    }


async def _submit(client, headers, **kw):
    return await client.post("/leave", headers=headers, json=_body(**kw))


async def test_employee_submits_and_lists_own_leave(client, seed):
    r = await _submit(client, seed["emp"], days=3)
    assert r.status_code == 201, r.text
    leave = r.json()
    assert leave["status"] == "PENDING"
    assert leave["days"] == 3
    assert leave["employee_name"] == "Employee One"

    r = await client.get("/leave/me", headers=seed["emp"])
    assert [x["id"] for x in r.json()] == [leave["id"]]

    # Another employee does not see it.
    r = await client.get("/leave/me", headers=seed["emp2"])
    assert r.json() == []


@pytest.mark.parametrize(
    "body, fragment",
    [
        (_body(start_offset=-8), "past"),
        (_body(start_offset=91), "ahead"),
        (_body(days=31), "30 days"),
        ({**_body(), "end_date": (_today() - timedelta(days=1)).isoformat()}, "on or after"),
        (_body(reason="   "), "empty"),
        (_body(leave_type="HOLIDAY"), "leave_type"),
    ],
)
async def test_invalid_requests_are_refused(client, seed, body, fragment):
    r = await client.post("/leave", headers=seed["emp"], json=body)
    assert r.status_code == 422
    assert fragment in r.text


async def test_sick_leave_can_be_backdated_a_week(client, seed):
    r = await _submit(client, seed["emp"], start_offset=-7, days=2, leave_type="SICK")
    assert r.status_code == 201, r.text


async def test_overlap_with_active_request_is_refused(client, seed):
    first = (await _submit(client, seed["emp"], start_offset=2, days=3)).json()

    r = await _submit(client, seed["emp"], start_offset=4, days=2)
    assert r.status_code == 409
    assert r.json()["detail"]["leave_id"] == first["id"]

    # Adjacent dates are fine, and so is the same range for someone else.
    r = await _submit(client, seed["emp"], start_offset=5, days=1)
    assert r.status_code == 201, r.text
    r = await _submit(client, seed["emp2"], start_offset=2, days=3)
    assert r.status_code == 201, r.text


async def test_concurrent_overlapping_submissions_create_one_request(client, seed):
    results = await asyncio.gather(*[_submit(client, seed["emp"], start_offset=10, days=2) for _ in range(5)])
    codes = sorted(r.status_code for r in results)
    assert codes == [201, 409, 409, 409, 409]


async def test_cancel_only_own_pending_request(client, seed):
    leave = (await _submit(client, seed["emp"])).json()

    r = await client.post(f"/leave/{leave['id']}/cancel", headers=seed["emp2"])
    assert r.status_code == 404

    r = await client.post(f"/leave/{leave['id']}/cancel", headers=seed["emp"])
    assert r.status_code == 200
    assert r.json()["status"] == "CANCELLED"

    r = await client.post(f"/leave/{leave['id']}/cancel", headers=seed["emp"])
    assert r.status_code == 409

    # A cancelled request no longer blocks the dates.
    r = await _submit(client, seed["emp"])
    assert r.status_code == 201, r.text


async def test_supervisor_decides_only_for_direct_reports(client, seed):
    leave = (await _submit(client, seed["emp"])).json()

    r = await client.get("/leave", headers=seed["emp"])
    assert r.status_code == 403

    r = await client.get("/leave", headers=seed["sup_b"], params={"status": "PENDING"})
    assert r.json() == []
    r = await client.post(f"/leave/{leave['id']}/decision", headers=seed["sup_b"], json={"decision": "APPROVED"})
    assert r.status_code == 403

    r = await client.get("/leave", headers=seed["sup_a"], params={"status": "PENDING"})
    assert [x["id"] for x in r.json()] == [leave["id"]]

    r = await client.post(f"/leave/{leave['id']}/decision", headers=seed["sup_a"], json={"decision": "REJECTED"})
    assert r.status_code == 422

    r = await client.post(
        f"/leave/{leave['id']}/decision",
        headers=seed["sup_a"],
        json={"decision": "APPROVED", "note": "Selamat berlibur"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "APPROVED"
    assert body["reviewer_name"] == "Supervisor A"
    assert body["review_note"] == "Selamat berlibur"

    # Decided once; a second decision (or a late cancel) is refused.
    r = await client.post(
        f"/leave/{leave['id']}/decision", headers=seed["admin"], json={"decision": "REJECTED", "note": "x"}
    )
    assert r.status_code == 409
    r = await client.post(f"/leave/{leave['id']}/cancel", headers=seed["emp"])
    assert r.status_code == 409


async def test_nobody_decides_on_their_own_request(client, seed):
    leave = (await _submit(client, seed["sup_a"])).json()

    r = await client.post(f"/leave/{leave['id']}/decision", headers=seed["sup_a"], json={"decision": "APPROVED"})
    assert r.status_code == 403

    r = await client.post(f"/leave/{leave['id']}/decision", headers=seed["admin"], json={"decision": "APPROVED"})
    assert r.status_code == 200


async def test_team_list_filters_by_date_window(client, seed):
    today = _today()
    on_leave = (await _submit(client, seed["emp"], start_offset=0, days=2, leave_type="SICK")).json()
    later = (await _submit(client, seed["emp2"], start_offset=20, days=1)).json()
    for leave in (on_leave, later):
        await client.post(f"/leave/{leave['id']}/decision", headers=seed["admin"], json={"decision": "APPROVED"})

    r = await client.get(
        "/leave",
        headers=seed["admin"],
        params={"status": "APPROVED", "from_date": today.isoformat(), "to_date": today.isoformat()},
    )
    assert [x["id"] for x in r.json()] == [on_leave["id"]]
