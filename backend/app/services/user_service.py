from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import get_password_hash
from app.models.models import User
from app.repositories.user_repository import UserRepository
from app.schemas.users import (
    UserCreateRequest,
    UserListItem,
    UserListResponse,
    UserUpdateRequest,
)


def _to_item(user: User) -> UserListItem:
    """Convert a User ORM object (with eagerly loaded role + site) to UserListItem."""
    now = datetime.now(timezone.utc)
    return UserListItem(
        id=user.id,
        employee_id=user.employee_id,
        name=user.name,
        email=user.email,
        role=user.role.name,
        site_id=user.site_id,
        site_name=user.site.name if user.site else None,
        site_timezone=user.site.timezone if user.site else None,
        supervisor_id=user.supervisor_id,
        is_active=bool(user.is_active),
        has_face=user.face_embedding is not None,
        is_locked=bool(
            user.locked_until and user.locked_until > now
        ),
    )


class UserService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = UserRepository(db)

    async def list_users(
        self,
        search: Optional[str],
        role: Optional[str],
        site_id: Optional[int],
        page: int,
        page_size: int,
    ) -> UserListResponse:
        users, total = await self.repo.list_with_filters(
            search=search or None,
            role=role or None,
            site_id=site_id,
            skip=(page - 1) * page_size,
            limit=page_size,
        )
        return UserListResponse(
            items=[_to_item(u) for u in users],
            total=total,
            page=page,
            page_size=page_size,
        )

    async def get_user(self, user_id: int) -> UserListItem:
        user = await self.repo.get_by_id(user_id)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )
        return _to_item(user)

    async def create_user(self, data: UserCreateRequest) -> UserListItem:
        # Uniqueness checks
        if await self.repo.get_by_employee_id(data.employee_id):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Employee ID already exists",
            )
        if await self.repo.get_by_email(data.email):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Email already in use",
            )

        role = await self.repo.get_role_by_name(data.role)
        if role is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Role '{data.role}' not found in database",
            )

        user = await self.repo.create_user(
            employee_id=data.employee_id,
            name=data.name,
            email=data.email,  # already lowercased by validator
            password_hash=get_password_hash(data.password),
            role_id=role.id,
            site_id=data.site_id,
            supervisor_id=data.supervisor_id,
        )
        return _to_item(user)

    async def update_user(self, user_id: int, data: UserUpdateRequest) -> UserListItem:
        user = await self.repo.get_by_id(user_id)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )

        changed = data.model_fields_set  # set of field names explicitly provided

        if "email" in changed and data.email is not None:
            new_email = data.email.strip().lower()
            if new_email != user.email:
                existing = await self.repo.get_by_email(new_email)
                if existing and existing.id != user_id:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail="Email already in use by another user",
                    )
            user.email = new_email

        if "name" in changed and data.name is not None:
            user.name = data.name.strip()

        if "role" in changed and data.role is not None:
            role = await self.repo.get_role_by_name(data.role)
            if role is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=f"Role '{data.role}' not found",
                )
            user.role_id = role.id

        if "site_id" in changed:
            user.site_id = data.site_id  # may be None (remove from site)

        if "supervisor_id" in changed:
            user.supervisor_id = data.supervisor_id  # may be None

        if "is_active" in changed and data.is_active is not None:
            user.is_active = data.is_active

        if "password" in changed and data.password is not None:
            user.password_hash = get_password_hash(data.password)

        await self.db.commit()

        # Re-fetch with relationships to build the response
        refreshed = await self.repo.get_by_id(user_id)
        assert refreshed is not None
        return _to_item(refreshed)

    async def delete_user(self, user_id: int) -> None:
        user = await self.repo.get_by_id(user_id)
        if user is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )

        # Clear FK references that would block deletion
        await self.repo.nullify_subordinates(user_id)
        await self.repo.nullify_audit_logs(user_id)

        await self.db.delete(user)
        await self.db.commit()
