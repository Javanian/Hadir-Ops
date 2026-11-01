from datetime import datetime, timedelta, UTC

import bcrypt
import jwt
from jwt.exceptions import InvalidTokenError

from app.core.config import settings

# bcrypt only reads the first 72 bytes. passlib cut longer passwords silently;
# bcrypt 5 refuses them, so new passwords are limited here and checked in the schemas.
PASSWORD_MIN_CHARS = 8
PASSWORD_MAX_BYTES = 72


def validate_new_password(password: str) -> str:
    if len(password) < PASSWORD_MIN_CHARS:
        raise ValueError(f"Password must be at least {PASSWORD_MIN_CHARS} characters")
    if len(password.encode("utf-8")) > PASSWORD_MAX_BYTES:
        raise ValueError(f"Password must be at most {PASSWORD_MAX_BYTES} bytes")
    return password


def verify_password(plain_password: str, hashed_password: str) -> bool:
    # Hashes written by passlib are standard $2b$ bcrypt and verify here unchanged.
    # Truncating to 72 bytes reproduces what passlib hashed for longer passwords.
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8")[:PASSWORD_MAX_BYTES], hashed_password.encode("utf-8"))
    except ValueError:  # malformed hash
        return False


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("ascii")


def create_access_token(data: dict, expires_delta: timedelta | None = None) -> str:
    to_encode = data.copy()
    now = datetime.now(UTC)
    expire = now + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "iat": int(now.timestamp()), "type": "access"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    now = datetime.now(UTC)
    expire = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "iat": int(now.timestamp()), "type": "refresh"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def issued_before_password_change(payload: dict, password_changed_at: datetime | None) -> bool:
    """True if the token predates the user's last password change.

    `iat` has whole-second precision, so the change time is truncated to the
    second; a token issued in the same second as the change is still accepted.
    Tokens without `iat` were issued before this claim existed and are treated
    as older than any password change.
    """
    if password_changed_at is None:
        return False
    issued_at = payload.get("iat")
    if not isinstance(issued_at, (int, float)):
        return True
    token_issued = datetime.fromtimestamp(int(issued_at), tz=UTC)
    return token_issued < password_changed_at.replace(microsecond=0)


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except InvalidTokenError as e:
        raise ValueError(f"Invalid token: {e}") from e


def create_face_token(user_id: int, similarity: float) -> str:
    """Signed proof that `user_id` passed face verification just now.

    The check-in endpoint accepts it when the event time is within
    FACE_TOKEN_WINDOW_MINUTES of `iat`, so expiry is checked there, not here.
    """
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "type": "face",
        "sim": round(float(similarity), 4),
        "iat": int(now.timestamp()),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_face_token(token: str) -> dict:
    try:
        payload = jwt.decode(
            token,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
            options={"require": ["sub", "iat"], "verify_iat": False},
        )
    except InvalidTokenError as e:
        raise ValueError(f"Invalid face token: {e}") from e
    if payload.get("type") != "face":
        raise ValueError("Not a face token")
    return payload
