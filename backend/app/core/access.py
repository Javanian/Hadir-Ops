"""
Object-level access rules shared by every router and service.

  ADMIN       — everyone
  SUPERVISOR  — themselves and their direct reports
  any other   — themselves only (EMPLOYEE, SALES, and any role added later)

Checks are written as "who is allowed" rather than "who is denied", so a new
or unexpected role gets the narrowest access by default.
"""

from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession


async def visible_user_ids(db: AsyncSession, current_user) -> Optional[List[int]]:
    """User ids whose records `current_user` may see; None means no restriction."""
    role = current_user.role.name
    if role == "ADMIN":
        return None
    if role == "SUPERVISOR":
        from app.repositories.user_repository import UserRepository

        return [current_user.id, *await UserRepository(db).get_subordinate_ids(current_user.id)]
    return [current_user.id]


async def can_access_user(db: AsyncSession, current_user, owner_id: Optional[int]) -> bool:
    if owner_id is None:
        return current_user.role.name == "ADMIN"
    allowed = await visible_user_ids(db, current_user)
    return allowed is None or owner_id in allowed


async def require_user_access(db: AsyncSession, current_user, owner_id: Optional[int]) -> None:
    if not await can_access_user(db, current_user, owner_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")
