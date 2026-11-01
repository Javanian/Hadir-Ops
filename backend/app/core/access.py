"""
Object-level access rules shared by every router and service.

  ADMIN       — everyone
  SUPERVISOR  — themselves and their direct reports
  any other   — themselves only (EMPLOYEE, SALES, and any role added later)

Checks are written as "who is allowed" rather than "who is denied", so a new
or unexpected role gets the narrowest access by default.
"""


from fastapi import HTTPException, status
from pymongo.asynchronous.database import AsyncDatabase


async def visible_user_ids(db: AsyncDatabase, current_user) -> list[int] | None:
    """User ids whose records `current_user` may see; None means no restriction."""
    role = current_user.role.name
    if role == "ADMIN":
        return None
    if role == "SUPERVISOR":
        from app.repositories.user_repository import UserRepository

        return [current_user.id, *await UserRepository(db).get_subordinate_ids(current_user.id)]
    return [current_user.id]


async def can_access_user(db: AsyncDatabase, current_user, owner_id: int | None) -> bool:
    if owner_id is None:
        return current_user.role.name == "ADMIN"
    allowed = await visible_user_ids(db, current_user)
    return allowed is None or owner_id in allowed


async def require_user_access(db: AsyncDatabase, current_user, owner_id: int | None) -> None:
    if not await can_access_user(db, current_user, owner_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")
