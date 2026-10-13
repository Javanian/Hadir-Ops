from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role
from app.schemas.assignment import AssignmentCreate, AssignmentResponse
from app.services.assignment_service import AssignmentService

router = APIRouter(prefix="/assignments", tags=["Assignments"])


@router.get("", response_model=List[AssignmentResponse], summary="List assignments (ADMIN only)")
async def list_assignments(
    user_id:     Optional[int]  = Query(None, description="Filter by user ID"),
    site_id:     Optional[int]  = Query(None, description="Filter by site ID"),
    active_only: bool           = Query(False, description="Return only currently active assignments"),
    skip:        int            = Query(0,   ge=0),
    limit:       int            = Query(100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_role("ADMIN")),
) -> List[AssignmentResponse]:
    return await AssignmentService(db).list_assignments(
        user_id=user_id, site_id=site_id,
        active_only=active_only, skip=skip, limit=limit,
    )


@router.post("", response_model=AssignmentResponse, status_code=201, summary="Create assignment (ADMIN only)")
async def create_assignment(
    data: AssignmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("ADMIN")),
) -> AssignmentResponse:
    return await AssignmentService(db).create_assignment(data, current_user)


@router.delete("/{assignment_id}", status_code=204, summary="Delete assignment (ADMIN only)")
async def delete_assignment(
    assignment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("ADMIN")),
) -> None:
    await AssignmentService(db).delete_assignment(assignment_id, current_user)


@router.get("/active", response_model=Optional[AssignmentResponse], summary="Get active assignment for current user today")
async def get_active_assignment(
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
) -> Optional[AssignmentResponse]:
    return await AssignmentService(db).get_active_assignment(current_user)
