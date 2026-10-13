from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    get_password_hash,
    verify_password,
)
from app.repositories.user_repository import UserRepository
from app.schemas.auth import ChangePasswordRequest, LoginRequest, TokenResponse


class AuthService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = UserRepository(db)

    def _utcnow(self) -> datetime:
        """Return naive UTC datetime (matches DB TIMESTAMP columns)."""
        return datetime.now(timezone.utc).replace(tzinfo=None)

    async def login(self, request: Request, data: LoginRequest) -> TokenResponse:
        ip = request.client.host if request.client else "unknown"
        ua = request.headers.get("user-agent", "")

        # Lookup by email first, then by employee_id
        user = await self.repo.get_by_email(data.identifier)
        if not user:
            user = await self.repo.get_by_employee_id(data.identifier)

        if not user:
            await self.repo.log_audit(None, "LOGIN_FAILED", ip, ua, "USER_NOT_FOUND")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "USER_NOT_FOUND"},
            )

        # Check account lock
        if user.locked_until:
            now = self._utcnow()
            if user.locked_until > now:
                remaining = int((user.locked_until - now).total_seconds() / 60) + 1
                await self.repo.log_audit(user.id, "LOGIN_BLOCKED", ip, ua, "ACCOUNT_LOCKED")
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={"code": "ACCOUNT_LOCKED", "retry_in_minutes": remaining},
                )
            # Lock expired — reset
            await self.repo.reset_failed_attempts(user)

        if not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"code": "ACCOUNT_INACTIVE"},
            )

        # Verify password
        if not verify_password(data.password, user.password_hash):
            current_attempts = (user.failed_login_attempts or 0) + 1
            lock_until = None

            if current_attempts >= settings.MAX_LOGIN_ATTEMPTS:
                lock_until = self._utcnow() + timedelta(minutes=settings.ACCOUNT_LOCK_MINUTES)

            await self.repo.increment_failed_attempts(user, lock_until=lock_until)
            await self.repo.log_audit(user.id, "LOGIN_FAILED", ip, ua, "WRONG_PASSWORD")

            if lock_until:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "code": "ACCOUNT_LOCKED",
                        "retry_in_minutes": settings.ACCOUNT_LOCK_MINUTES,
                    },
                )

            remaining_attempts = settings.MAX_LOGIN_ATTEMPTS - current_attempts
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail={"code": "WRONG_PASSWORD", "attempts_remaining": remaining_attempts},
            )

        # Success — reset failed attempts
        await self.repo.reset_failed_attempts(user)

        token_data = {"sub": str(user.id), "role": user.role.name}
        access_token = create_access_token(token_data)
        refresh_token = create_refresh_token(token_data)

        await self.repo.log_audit(user.id, "LOGIN_SUCCESS", ip, ua, "OK")

        return TokenResponse(
            access_token=access_token,
            refresh_token=refresh_token,
        )

    async def refresh(self, refresh_token: str) -> TokenResponse:
        try:
            payload = decode_token(refresh_token)
            if payload.get("type") != "refresh":
                raise ValueError("Not a refresh token")
            user_id: str = payload.get("sub")
            if not user_id:
                raise ValueError("Missing subject claim")
        except (ValueError, Exception):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired refresh token",
            )

        user = await self.repo.get_by_id(int(user_id))
        if not user or not user.is_active:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User not found or inactive",
            )

        token_data = {"sub": str(user.id), "role": user.role.name}
        return TokenResponse(
            access_token=create_access_token(token_data),
            refresh_token=create_refresh_token(token_data),
        )

    async def change_password(self, user, data: ChangePasswordRequest) -> None:
        # 1. Same-password check (plaintext comparison before hashing)
        if data.current_password == data.new_password:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "SAME_PASSWORD"},
            )
        # 2. Verify current password
        if not verify_password(data.current_password, user.password_hash):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={"code": "WRONG_CURRENT_PASSWORD"},
            )
        # 3. Hash and persist — service owns the commit
        new_hash = get_password_hash(data.new_password)
        changed_at = datetime.now(timezone.utc)
        await self.repo.update_password(user, new_hash, changed_at)
        await self.db.commit()
