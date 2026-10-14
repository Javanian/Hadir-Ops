from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from jwt.exceptions import InvalidTokenError
from passlib.context import CryptContext

from app.core.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta or timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire, "iat": int(now.timestamp()), "type": "access"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(data: dict) -> str:
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    expire = now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    to_encode.update({"exp": expire, "iat": int(now.timestamp()), "type": "refresh"})
    return jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def issued_before_password_change(payload: dict, password_changed_at: Optional[datetime]) -> bool:
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
    token_issued = datetime.fromtimestamp(int(issued_at), tz=timezone.utc)
    return token_issued < password_changed_at.replace(microsecond=0)


def decode_token(token: str) -> dict:
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        return payload
    except InvalidTokenError as e:
        raise ValueError(f"Invalid token: {str(e)}")


def create_face_token(user_id: int, similarity: float) -> str:
    """Signed proof that `user_id` passed face verification just now.

    The check-in endpoint accepts it when the event time is within
    FACE_TOKEN_WINDOW_MINUTES of `iat`, so expiry is checked there, not here.
    """
    now = datetime.now(timezone.utc)
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
        raise ValueError(f"Invalid face token: {e}")
    if payload.get("type") != "face":
        raise ValueError("Not a face token")
    return payload
