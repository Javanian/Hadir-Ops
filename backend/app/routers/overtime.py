"""
Overtime Router — Phase 5 (v2: standalone overtime + /me endpoint)
===================================================================
Endpoints:
  POST   /overtime                          — Submit request (any auth; IDOR in service)
  GET    /overtime/me                       — Current user's OWN requests (all roles)
  GET    /overtime                          — Role-scoped list (EMPLOYEE: own; SUPERVISOR: team; ADMIN: all)
  GET    /overtime/{id}                     — By ID (IDOR)
  PATCH  /overtime/{id}/approve             — Approve (ADMIN/SUPERVISOR)
  PATCH  /overtime/{id}/reject              — Reject  (ADMIN/SUPERVISOR)
  GET    /overtime/attendance/{att_id}      — All requests for one attendance (IDOR)
"""

from typing import List, Optional

from fastapi import APIRouter, Body, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role
from app.schemas.overtime import ApproveBody, OvertimeRequestCreate, OvertimeRequestResponse, RejectBody
from app.services.overtime_service import OvertimeService

router = APIRouter(prefix="/overtime", tags=["Overtime"])


# ── Specific routes first (avoid collision with /{id}) ────────────────────────

@router.get(
    "/me",
    response_model=List[OvertimeRequestResponse],
    summary="Current user's own overtime requests (all roles)",
)
async def list_my_overtime(
    ot_status: Optional[str] = Query(None, alias="status", description="PENDING | APPROVED | REJECTED"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return await OvertimeService(db).list_my_requests(
        current_user,
        ot_status=ot_status,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/attendance/{attendance_id}",
    response_model=List[OvertimeRequestResponse],
    summary="All overtime requests for a given attendance record (IDOR protected)",
)
async def list_by_attendance(
    attendance_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return await OvertimeService(db).list_by_attendance(attendance_id, current_user)


# ── Generic routes ────────────────────────────────────────────────────────────

@router.post(
    "",
    response_model=OvertimeRequestResponse,
    status_code=201,
    summary="Submit an overtime request (standalone or attendance-linked)",
    responses={
        409: {"description": "Active request already exists for this window"},
        422: {"description": "Invalid time window or ineligible attendance"},
    },
)
async def create_overtime_request(
    data: OvertimeRequestCreate,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return await OvertimeService(db).create_request(current_user, data)


@router.get(
    "",
    response_model=List[OvertimeRequestResponse],
    summary="List overtime requests (role-scoped: EMPLOYEE=own, SUPERVISOR=team, ADMIN=all)",
)
async def list_overtime(
    ot_status: Optional[str] = Query(None, alias="status", description="PENDING | APPROVED | REJECTED"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return await OvertimeService(db).list_requests(
        current_user,
        ot_status=ot_status,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{request_id}",
    response_model=OvertimeRequestResponse,
    summary="Get overtime request by ID (IDOR protected)",
)
async def get_overtime(
    request_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return await OvertimeService(db).get_by_id(request_id, current_user)


@router.patch(
    "/{request_id}/approve",
    response_model=OvertimeRequestResponse,
    summary="Approve overtime request (ADMIN/SUPERVISOR)",
)
async def approve_overtime(
    request_id: int,
    body: ApproveBody = Body(default_factory=ApproveBody),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("ADMIN", "SUPERVISOR")),
):
    return await OvertimeService(db).approve(request_id, current_user, body)


@router.patch(
    "/{request_id}/reject",
    response_model=OvertimeRequestResponse,
    summary="Reject overtime request (ADMIN/SUPERVISOR)",
)
async def reject_overtime(
    request_id: int,
    body: RejectBody = Body(default_factory=RejectBody),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("ADMIN", "SUPERVISOR")),
):
    return await OvertimeService(db).reject(request_id, current_user, body)
