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
  POST  /attendance/attempts            — any user: report check-ins the app could not complete
  GET   /attendance/attempts            — SUPERVISOR: own team; ADMIN: all
  GET   /attendance/review              — SUPERVISOR / ADMIN: records flagged for review
  POST  /attendance/{id}/review         — SUPERVISOR / ADMIN: approve or reject a flagged record
  POST  /attendance/{id}/face           — owner: attach a face photo to a record made offline

Check-in and check-out return 201 when a record is written and 200 when the
same client_event_id was already processed (safe retry).
"""

from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Query, Request, Response, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.uploads import read_image_upload
from app.core.dependencies import get_current_user, require_role
from app.schemas.attendance import (
    AttemptBatch,
    AttemptBatchResult,
    AttemptOut,
    AttendanceResponse,
    AutoCheckoutResult,
    ReviewDecision,
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
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    record, created = await AttendanceService(db).checkin(current_user, data)
    if not created:
        response.status_code = 200
    return record


@router.post(
    "/checkout",
    response_model=AttendanceResponse,
    status_code=201,
    summary="Check-out (any authenticated user)",
    responses={
        404: {"description": "No open check-in found"},
    },
)
async def checkout(
    data: CheckoutRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    record, created = await AttendanceService(db).checkout(current_user, data)
    if not created:
        response.status_code = 200
    return record


# ── Failed attempts ───────────────────────────────────────────────────────────

@router.post(
    "/attempts",
    response_model=AttemptBatchResult,
    summary="Report check-ins or check-outs the app could not complete",
)
async def report_attempts(
    data: AttemptBatch,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    accepted, duplicates = await AttendanceService(db).record_attempts(current_user, data.attempts)
    return AttemptBatchResult(accepted=accepted, duplicates=duplicates)


@router.get(
    "/attempts",
    response_model=List[AttemptOut],
    summary="Failed attempts — SUPERVISOR sees own team; ADMIN sees all",
)
async def list_attempts(
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("ADMIN", "SUPERVISOR")),
):
    return await AttendanceService(db).list_attempts(
        current_user, from_date=from_date, to_date=to_date, limit=limit, offset=offset
    )


# ── Review queue ──────────────────────────────────────────────────────────────

@router.get(
    "/review",
    response_model=List[TeamAttendanceRecord],
    summary="Records flagged for review — SUPERVISOR sees own team; ADMIN sees all",
)
async def review_queue(
    state: str = Query("pending", pattern="^(pending|all)$"),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("ADMIN", "SUPERVISOR")),
):
    return await AttendanceService(db).list_review_queue(
        current_user, pending_only=(state == "pending"), limit=limit, offset=offset
    )


@router.post(
    "/{attendance_id}/review",
    response_model=AttendanceResponse,
    summary="Approve or reject a flagged record (a note is required to reject)",
)
async def review_record(
    attendance_id: int,
    data: ReviewDecision,
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("ADMIN", "SUPERVISOR")),
):
    return await AttendanceService(db).review(attendance_id, current_user, data.decision, data.note)


@router.post(
    "/{attendance_id}/face",
    response_model=AttendanceResponse,
    summary="Attach the face photo taken with an offline check-in",
)
async def attach_face(
    attendance_id: int,
    request: Request,
    file: UploadFile = File(..., description="JPEG or PNG — must contain exactly one face"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    from app.routers.face import _get_face_service

    face_service = _get_face_service(request)
    image_bytes = await read_image_upload(file)
    return await AttendanceService(db).attach_face_evidence(
        attendance_id, current_user, face_service, image_bytes
    )


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
    summary="List attendance records — SUPERVISOR sees own team; ADMIN sees all",
)
async def list_attendance(
    user_id: Optional[int] = Query(None, description="Filter by user ID"),
    from_date: Optional[date] = Query(None),
    to_date: Optional[date] = Query(None),
    att_status: Optional[str] = Query(None, alias="status", description="ONTIME | LATE | OUT_OF_RADIUS"),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(require_role("ADMIN", "SUPERVISOR")),
):
    return await AttendanceService(db).list_attendance(
        current_user,
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
