from datetime import datetime
from typing import Optional

from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.models import AuditLog, Role, User


class UserRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Existing (auth / face) ────────────────────────────────────────────────

    async def get_by_email(self, email: str) -> Optional[User]:
        result = await self.db.execute(
            select(User)
            .options(selectinload(User.role))
            .where(User.email == email)
        )
        return result.scalar_one_or_none()

    async def get_by_employee_id(self, employee_id: str) -> Optional[User]:
        result = await self.db.execute(
            select(User)
            .options(selectinload(User.role))
            .where(User.employee_id == employee_id)
        )
        return result.scalar_one_or_none()

    async def get_by_id(self, user_id: int) -> Optional[User]:
        result = await self.db.execute(
            select(User)
            .options(selectinload(User.role), selectinload(User.site))
            .where(User.id == user_id)
        )
        return result.scalar_one_or_none()

    async def increment_failed_attempts(
        self, user: User, lock_until: Optional[datetime] = None
    ) -> None:
        user.failed_login_attempts = (user.failed_login_attempts or 0) + 1
        if lock_until is not None:
            user.locked_until = lock_until
        await self.db.commit()
        await self.db.refresh(user)

    async def reset_failed_attempts(self, user: User) -> None:
        user.failed_login_attempts = 0
        user.locked_until = None
        await self.db.commit()

    async def get_subordinate_ids(self, supervisor_id: int) -> list[int]:
        """Return IDs of all users directly supervised by supervisor_id."""
        result = await self.db.execute(
            select(User.id).where(User.supervisor_id == supervisor_id)
        )
        return list(result.scalars().all())

    async def update_password(self, user: User, new_hash: str, changed_at: datetime) -> None:
        """Update password hash and record the change timestamp. Service owns commit."""
        user.password_hash = new_hash
        user.password_changed_at = changed_at

    async def update_face_embedding(self, user_id: int, embedding) -> None:
        """Set or clear the face_embedding for a user (Phase 3)."""
        result = await self.db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()
        if user is not None:
            user.face_embedding = embedding
            await self.db.commit()

    async def log_audit(
        self,
        user_id: Optional[int],
        action: str,
        ip_address: str,
        user_agent: str,
        status: str,
    ) -> None:
        log = AuditLog(
            user_id=user_id,
            action=action,
            ip_address=ip_address[:50] if ip_address else None,
            user_agent=user_agent,
            status=status,
        )
        self.db.add(log)
        await self.db.commit()

    # ── User management (W2 backend) ─────────────────────────────────────────

    async def get_role_by_name(self, name: str) -> Optional[Role]:
        result = await self.db.execute(select(Role).where(Role.name == name))
        return result.scalar_one_or_none()

    async def list_with_filters(
        self,
        search: Optional[str],
        role: Optional[str],
        site_id: Optional[int],
        skip: int,
        limit: int,
    ) -> tuple[list[User], int]:
        """Return (page_of_users, total_count) matching the given filters."""
        base = (
            select(User)
            .join(User.role)
            .options(selectinload(User.role), selectinload(User.site))
        )

        if search:
            pat = f"%{search}%"
            base = base.where(
                or_(
                    User.name.ilike(pat),
                    User.employee_id.ilike(pat),
                    User.email.ilike(pat),
                )
            )
        if role:
            base = base.where(Role.name == role)
        if site_id is not None:
            base = base.where(User.site_id == site_id)

        # Total count via subquery
        count_q = select(func.count()).select_from(base.subquery())
        total: int = (await self.db.execute(count_q)).scalar_one()

        # Paginated rows
        rows = await self.db.execute(
            base.order_by(User.id).offset(skip).limit(limit)
        )
        return list(rows.scalars().all()), total

    async def create_user(
        self,
        employee_id: str,
        name: str,
        email: str,
        password_hash: str,
        role_id: int,
        site_id: Optional[int],
        supervisor_id: Optional[int],
    ) -> User:
        user = User(
            employee_id=employee_id,
            name=name,
            email=email,
            password_hash=password_hash,
            role_id=role_id,
            site_id=site_id,
            supervisor_id=supervisor_id,
        )
        self.db.add(user)
        await self.db.commit()
        # Reload with eager relationships for the response
        loaded = await self.get_by_id(user.id)
        assert loaded is not None
        return loaded

    async def nullify_subordinates(self, supervisor_id: int) -> None:
        """Clear supervisor_id for all direct subordinates before deleting the supervisor."""
        await self.db.execute(
            update(User)
            .where(User.supervisor_id == supervisor_id)
            .values(supervisor_id=None)
        )

    async def nullify_audit_logs(self, user_id: int) -> None:
        """Set audit_logs.user_id = NULL so FK constraint doesn't block deletion."""
        await self.db.execute(
            update(AuditLog)
            .where(AuditLog.user_id == user_id)
            .values(user_id=None)
        )
