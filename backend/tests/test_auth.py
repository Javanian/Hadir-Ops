"""
Login lockout and token invalidation after a password change.
"""

from datetime import datetime, timedelta, timezone

import jwt
import pytest
import pytest_asyncio
from sqlalchemy import text

pytestmark = pytest.mark.asyncio(loop_scope="session")

UTC = timezone.utc
EMP_EMAIL = "emp1@example.test"
PASSWORD = "Password1!"


@pytest_asyncio.fixture(loop_scope="session", autouse=True)
async def _reset_rate_limits():
    from app.routers.auth import limiter

    limiter.reset()
    yield


def _token(user_id: int, kind: str, iat: datetime | None):
    """A token signed like the real ones, with a chosen `iat` (or none)."""
    from app.core.config import settings

    payload = {"sub": str(user_id), "type": kind, "exp": datetime.now(UTC) + timedelta(minutes=15)}
    if iat is not None:
        payload["iat"] = int(iat.timestamp())
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


async def _login(client, password=PASSWORD):
    return await client.post("/auth/login", json={"identifier": EMP_EMAIL, "password": password})


async def test_tokens_carry_issued_at(client, seed):
    from app.core.security import decode_token

    r = await _login(client)
    assert r.status_code == 200, r.text
    for key in ("access_token", "refresh_token"):
        payload = decode_token(r.json()[key])
        assert isinstance(payload["iat"], int)


async def test_lockout_answers_403_on_every_attempt(client, seed):
    for attempt in range(1, 5):
        r = await _login(client, "wrong-password")
        assert r.status_code == 401
        assert r.json()["detail"]["attempts_remaining"] == 5 - attempt

    r = await _login(client, "wrong-password")
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "ACCOUNT_LOCKED"

    # The account is locked now; even the right password is refused, with a
    # 403 and a retry hint (this compared naive and aware datetimes before).
    r = await _login(client)
    assert r.status_code == 403
    detail = r.json()["detail"]
    assert detail["code"] == "ACCOUNT_LOCKED"
    assert 1 <= detail["retry_in_minutes"] <= 31


async def test_expired_lock_is_cleared_on_login(client, seed):
    from app.core.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        await db.execute(
            text("UPDATE users SET failed_login_attempts = 5, locked_until = now() - interval '1 minute' WHERE id = :u"),
            {"u": seed["emp_id"]},
        )
        await db.commit()

    r = await _login(client)
    assert r.status_code == 200, r.text

    async with AsyncSessionLocal() as db:
        row = (await db.execute(
            text("SELECT failed_login_attempts, locked_until FROM users WHERE id = :u"), {"u": seed["emp_id"]}
        )).one()
    assert row == (0, None)


async def test_password_change_invalidates_older_tokens(client, seed):
    an_hour_ago = datetime.now(UTC) - timedelta(hours=1)
    old_access = _token(seed["emp_id"], "access", an_hour_ago)
    old_refresh = _token(seed["emp_id"], "refresh", an_hour_ago)
    legacy_access = _token(seed["emp_id"], "access", None)

    # Before any password change, all of them are accepted.
    for tok in (old_access, legacy_access):
        r = await client.get("/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200, r.text

    r = await client.post(
        "/auth/change-password",
        headers=seed["emp"],
        json={"current_password": PASSWORD, "new_password": "NewPassword2!"},
    )
    assert r.status_code == 204, r.text

    for tok in (old_access, legacy_access):
        r = await client.get("/auth/me", headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 401
        assert r.json()["detail"]["code"] == "TOKEN_INVALIDATED"

    r = await client.post("/auth/refresh", json={"refresh_token": old_refresh})
    assert r.status_code == 401
    assert r.json()["detail"]["code"] == "TOKEN_INVALIDATED"

    # A fresh login with the new password works, including its refresh token.
    r = await _login(client, "NewPassword2!")
    assert r.status_code == 200, r.text
    tokens = r.json()
    r = await client.get("/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"})
    assert r.status_code == 200
    r = await client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 200, r.text
