from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import require_role
from app.schemas.users import UserCreateRequest, UserListItem, UserListResponse, UserUpdateRequest
from app.services.user_service import UserService

router = APIRouter(prefix="/users", tags=["Users"])

# All user-management endpoints require ADMIN role.


@router.get("", response_model=UserListResponse, summary="List all users (ADMIN only)")
async def list_users(
    search: Optional[str] = Query(None, description="Search by name, employee_id, or email"),
    role: Optional[str] = Query(None, description="Filter by role: ADMIN | SUPERVISOR | EMPLOYEE"),
    site_id: Optional[int] = Query(None, description="Filter by site ID"),
    page: int = Query(1, ge=1, description="Page number (1-based)"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_role("ADMIN")),
) -> UserListResponse:
    return await UserService(db).list_users(
        search=search,
        role=role,
        site_id=site_id,
        page=page,
        page_size=page_size,
    )


@router.get("/{user_id}", response_model=UserListItem, summary="Get user by ID (ADMIN only)")
async def get_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_role("ADMIN")),
) -> UserListItem:
    return await UserService(db).get_user(user_id)


@router.post("", response_model=UserListItem, status_code=201, summary="Create user (ADMIN only)")
async def create_user(
    data: UserCreateRequest,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_role("ADMIN")),
) -> UserListItem:
    return await UserService(db).create_user(data)


@router.put("/{user_id}", response_model=UserListItem, summary="Update user (ADMIN only)")
async def update_user(
    user_id: int,
    data: UserUpdateRequest,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_role("ADMIN")),
) -> UserListItem:
    return await UserService(db).update_user(user_id, data)


@router.delete("/{user_id}", status_code=204, summary="Delete user (ADMIN only)")
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_role("ADMIN")),
) -> None:
    await UserService(db).delete_user(user_id)
