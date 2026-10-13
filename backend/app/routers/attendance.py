"""
Attendance Router — Phase 4 + F6
==================================
Endpoints:
  POST  /attendance/checkin             — any authenticated user (employee checks in)
  POST  /attendance/checkout            — any authenticated user (employee checks out)
  GET   /attendance/me                  — any user: own records
  GET   /attendance/team                — SUPERVISOR: subordinates; ADMIN: all (F6)
  GET   /attendance                     — ADMIN / SUPERVISOR: list all with filters
  GET   /attendance/{id}                — any user (EMPLOYEE: own only — IDOR protected)
  POST  /attendance/trigger-auto-checkout — ADMIN only: manually trigger batch auto-checkout
"""

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role
from app.schemas.attendance import (
    AttendanceResponse,
    AutoCheckoutResult,
    CheckinRequest,
    CheckoutRequest,
    TeamAttendanceRecord,
)
from app.services.attendance_service import AttendanceService

router = APIRouter(prefix="/attendance", tags=["Attendance"])


# ── Check-in / Check-out ──────────────────────────────────────────────────────

@router.post(
    "/checkin",
    response_model=AttendanceResponse,
    status_code=201,
    summary="Check-in (any authenticated user)",
    responses={
        409: {"description": "Already checked in today"},
        422: {"description": "No active shift / GPS coordinates out of range"},
    },
)
async def checkin(
    data: CheckinRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return await AttendanceService(db).checkin(current_user, data)


@router.post(
    "/checkout",
    response_model=AttendanceResponse,
    summary="Check-out (any authenticated user)",
    responses={
        404: {"description": "No open check-in found"},
    },
)
async def checkout(
    data: CheckoutRequest,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return await AttendanceService(db).checkout(current_user, data)


# ── Queries ───────────────────────────────────────────────────────────────────

@router.get(
    "/me",
    response_model=List[AttendanceResponse],
    summary="My attendance records",
)
async def my_attendance(
    from_date: Optional[date] = Query(None, description="Start date filter (YYYY-MM-DD)"),
    to_date: Optional[date] = Query(None, description="End date filter (YYYY-MM-DD)"),
    timezone: str = Query("UTC", description="Site timezone for date boundary conversion, e.g. Asia/Jakarta"),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return await AttendanceService(db).list_my_attendance(
        user_id=current_user.id,
        from_date=from_date,
        to_date=to_date,
        site_timezone=timezone,
        limit=limit,
        offset=offset,
    )


@router.get(
    "",
    response_model=List[AttendanceResponse],
    summary="List all attendance records (ADMIN/SUPERVISOR)",
)
async def list_attendance(
    user_id: Optional[int] = Query(None, description="Filter by user ID"),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    att_status: Optional[str] = Query(None, alias="status", description="ONTIME | LATE | OUT_OF_RADIUS"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_role("ADMIN", "SUPERVISOR")),
):
    return await AttendanceService(db).list_attendance(
        user_id=user_id,
        from_date=from_date,
        to_date=to_date,
        att_status=att_status,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/team",
    response_model=List[TeamAttendanceRecord],
    summary="Subordinates' attendance records — SUPERVISOR sees own team; ADMIN sees all (F6)",
)
async def team_attendance(
    from_date: Optional[date] = Query(None, description="Start date filter (YYYY-MM-DD)"),
    to_date: Optional[date] = Query(None, description="End date filter (YYYY-MM-DD)"),
    limit: int = Query(500, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("ADMIN", "SUPERVISOR")),
):
    site_timezone = current_user.site.timezone if current_user.site else "UTC"
    return await AttendanceService(db).list_team_attendance(
        current_user,
        from_date=from_date,
        to_date=to_date,
        site_timezone=site_timezone,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/{attendance_id}",
    response_model=AttendanceResponse,
    summary="Get attendance record by ID (EMPLOYEE: own only)",
)
async def get_attendance(
    attendance_id: int,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    return await AttendanceService(db).get_attendance_by_id(attendance_id, current_user)


# ── Admin utilities ───────────────────────────────────────────────────────────

@router.post(
    "/trigger-auto-checkout",
    response_model=AutoCheckoutResult,
    summary="Manually trigger auto-checkout for all overdue records (ADMIN only)",
)
async def trigger_auto_checkout(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_role("ADMIN")),
):
    count = await AttendanceService(db).run_auto_checkout()
    return AutoCheckoutResult(
        processed=count,
        message=f"Auto-checkout applied to {count} record(s).",
    )
