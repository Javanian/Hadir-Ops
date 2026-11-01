"""
Login lockout and token invalidation after a password change.
"""

from datetime import datetime, timedelta, UTC

import jwt
import pytest
import pytest_asyncio

pytestmark = pytest.mark.asyncio(loop_scope="session")

UTC = UTC
EMP_EMAIL = "emp1@example.test"
PASSWORD = "Password1!"


@pytest_asyncio.fixture(loop_scope="session", autouse=True)
async def _reset_rate_limits():
    from app.core import ratelimit

    await ratelimit.reset()
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


async def test_expired_lock_is_cleared_on_login(client, seed, mongo):
    await mongo.users.update_one(
        {"_id": seed["emp_id"]},
        {"$set": {"failed_login_attempts": 5, "locked_until": datetime.now(UTC) - timedelta(minutes=1)}},
    )

    r = await _login(client)
    assert r.status_code == 200, r.text

    doc = await mongo.users.find_one({"_id": seed["emp_id"]})
    assert (doc["failed_login_attempts"], doc["locked_until"]) == (0, None)


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


async def test_login_is_rate_limited_per_client(client, seed):
    from app.core.config import settings

    allowed = int(settings.RATE_LIMIT_LOGIN.split("/")[0])
    body = {"identifier": "nobody@example.test", "password": "wrong-password"}
    for _ in range(allowed):
        assert (await client.post("/auth/login", json=body)).status_code == 401
    r = await client.post("/auth/login", json=body)
    assert r.status_code == 429 and int(r.headers["Retry-After"]) >= 1


async def test_passwords_written_by_passlib_still_verify():
    """Hashes created before the switch from passlib to bcrypt keep working."""
    from app.core.security import get_password_hash, validate_new_password, verify_password

    passlib_hash = "$2b$12$I/oKsIM4XZ/gXCQNNEbHqeFkriEbMNktRSLB9D5iqUf3NXzaaHdNO"  # passlib, "Admin@123"
    assert verify_password("Admin@123", passlib_hash)
    assert not verify_password("admin@123", passlib_hash)
    assert verify_password("x" * 80, get_password_hash("x" * 72))  # passlib cut at 72 bytes
    assert not verify_password("anything", "not-a-hash")
    with pytest.raises(ValueError):
        validate_new_password("é" * 40)  # 80 bytes


async def test_create_admin_script_makes_one_admin(client, seed):
    import pytest as _pytest
    from scripts.create_admin import create_admin

    user_id = await create_admin("IT@Company.example", "IT Admin", "ADM9", "Str0ng-pass")
    r = await client.post("/auth/login", json={"identifier": "it@company.example", "password": "Str0ng-pass"})
    assert r.status_code == 200
    me = await client.get("/auth/me", headers={"Authorization": f"Bearer {r.json()['access_token']}"})
    assert me.json()["role"] == "ADMIN" and me.json()["id"] == user_id
    with _pytest.raises(SystemExit):
        await create_admin("it@company.example", "Again", "ADM10", "Str0ng-pass")


async def test_production_hides_the_api_docs():
    from app.core.config import Settings

    prod = Settings(ENVIRONMENT="production", SECRET_KEY="x" * 40)
    assert prod.is_production
    prod.check_production_safety()  # a real secret passes
    with pytest.raises(RuntimeError):
        Settings(ENVIRONMENT="production", SECRET_KEY="change-this-secret-key-in-production").check_production_safety()
