"""
Leave Router
============
Endpoints:
  POST   /leave                 — Submit own leave request (any role)
  GET    /leave/me              — Own requests (any role)
  POST   /leave/{id}/cancel     — Cancel own PENDING request
  GET    /leave                 — Team requests (SUPERVISOR: direct reports; ADMIN: all)
  POST   /leave/{id}/decision   — Approve or reject (SUPERVISOR / ADMIN)
"""

from datetime import date
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query
from pymongo.asynchronous.database import AsyncDatabase

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role
from app.schemas.leave import LeaveDecision, LeaveRequestCreate, LeaveRequestResponse
from app.services.leave_service import LeaveService

router = APIRouter(prefix="/leave", tags=["Leave"])

StatusFilter = Optional[Literal["PENDING", "APPROVED", "REJECTED", "CANCELLED"]]


@router.post(
    "",
    response_model=LeaveRequestResponse,
    status_code=201,
    summary="Submit a leave request for yourself",
    responses={409: {"description": "Overlaps another pending or approved request"}},
)
async def create_leave(
    data: LeaveRequestCreate,
    db: AsyncDatabase = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return await LeaveService(db).create(current_user, data)


@router.get("/me", response_model=List[LeaveRequestResponse], summary="Your own leave requests")
async def list_my_leave(
    leave_status: StatusFilter = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncDatabase = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return await LeaveService(db).list_mine(current_user, leave_status, limit, offset)


@router.post(
    "/{leave_id}/cancel",
    response_model=LeaveRequestResponse,
    summary="Cancel your own pending leave request",
)
async def cancel_leave(
    leave_id: int,
    db: AsyncDatabase = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return await LeaveService(db).cancel(leave_id, current_user)


@router.get(
    "",
    response_model=List[LeaveRequestResponse],
    summary="Team leave requests — SUPERVISOR sees direct reports; ADMIN sees all",
)
async def list_team_leave(
    leave_status: StatusFilter = Query(None, alias="status"),
    from_date: Optional[date] = Query(None, description="Requests that end on or after this date"),
    to_date: Optional[date] = Query(None, description="Requests that start on or before this date"),
    limit: int = Query(200, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncDatabase = Depends(get_db),
    current_user=Depends(require_role("ADMIN", "SUPERVISOR")),
):
    return await LeaveService(db).list_team(current_user, leave_status, from_date, to_date, limit, offset)


@router.post(
    "/{leave_id}/decision",
    response_model=LeaveRequestResponse,
    summary="Approve or reject a pending leave request (rejection needs a note)",
)
async def decide_leave(
    leave_id: int,
    data: LeaveDecision,
    db: AsyncDatabase = Depends(get_db),
    current_user=Depends(require_role("ADMIN", "SUPERVISOR")),
):
    return await LeaveService(db).decide(leave_id, current_user, data)
