"""
Overtime Service — Phase 5 (v2: standalone overtime support)
=============================================================
Rules implemented:
  1. Standard work hours = shift.work_hours_standard (default 8 h)
  2. Weekend  → overtime_minutes = work_duration_minutes  (auto at checkout, no request needed)
  3. Holiday  → overtime_minutes = work_duration_minutes  (auto at checkout, no request needed)
  4. Regular weekday overtime → EMPLOYEE submits OvertimeRequest → ADMIN/SUPERVISOR approves
  5. Standalone overtime (no attendance_id): employee requests for today/future dates
     before working — supervisor approves, employee works the overtime window
  6. Only one PENDING or APPROVED request allowed per attendance record or per
     overlapping time window (for standalone requests)

IDOR:
  - EMPLOYEE: can only access/submit for their own user_id
  - SUPERVISOR: can access/approve their direct subordinates only
  - ADMIN: unrestricted
"""

from typing import List, Optional

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.attendance_repository import AttendanceRepository
from app.repositories.overtime_repository import OvertimeRepository
from app.schemas.overtime import ApproveBody, OvertimeRequestCreate, OvertimeRequestResponse, RejectBody


class OvertimeService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = OvertimeRepository(db)
        self.att_repo = AttendanceRepository(db)

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _to_response(self, req) -> OvertimeRequestResponse:
        return OvertimeRequestResponse.model_validate(req)

    def _req_user_id(self, req) -> Optional[int]:
        """Resolve the owning user_id from a request (direct or via attendance)."""
        if req.user_id is not None:
            return req.user_id
        if req.attendance is not None:
            return req.attendance.user_id
        return None

    async def _get_subordinate_ids(self, supervisor_id: int) -> list:
        from app.repositories.user_repository import UserRepository
        return await UserRepository(self.db).get_subordinate_ids(supervisor_id)

    async def _assert_can_access(self, req, current_user) -> None:
        """Raise 403 if the current user cannot access this OT request."""
        owner_id = self._req_user_id(req)
        role = current_user.role.name
        if role == "EMPLOYEE":
            if owner_id != current_user.id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")
        elif role == "SUPERVISOR":
            sub_ids = await self._get_subordinate_ids(current_user.id)
            if owner_id not in sub_ids:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied: employee is not your direct subordinate.",
                )

    # ── Submit overtime request ────────────────────────────────────────────────

    async def create_request(
        self, current_user, data: OvertimeRequestCreate
    ) -> OvertimeRequestResponse:
        if data.attendance_id is not None:
            # ── Attendance-linked overtime (legacy flow) ──────────────────────
            att = await self.att_repo.get_by_id(data.attendance_id)
            if not att:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Attendance record not found.",
                )
            if current_user.role.name == "EMPLOYEE" and att.user_id != current_user.id:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")
            if att.checkout_time is None:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Cannot submit overtime request before check-out.",
                )
            if att.auto_checkout and not (att.is_weekend or att.is_holiday):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="Auto-checked-out records on regular days are not eligible for overtime.",
                )
            if att.is_weekend or att.is_holiday:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail=(
                        "Overtime for weekends and holidays is calculated automatically. "
                        "No manual request is required."
                    ),
                )
            existing = await self.repo.get_active_for_attendance(data.attendance_id)
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"An overtime request already exists for this attendance (status={existing.status}).",
                )
            if data.requested_start < att.checkin_time:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="requested_start cannot be before check-in time.",
                )
            if data.requested_end > att.checkout_time:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail="requested_end cannot be after check-out time.",
                )
            owner_user_id = att.user_id
        else:
            # ── Standalone overtime (new flow: no attendance record yet) ──────
            owner_user_id = current_user.id
            # Overlap check: prevent duplicate active standalone requests for same window
            existing = await self.repo.get_active_for_user_window(
                owner_user_id, data.requested_start, data.requested_end
            )
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"An active overtime request already exists for this time window (status={existing.status}).",
                )

        req = await self.repo.create(
            user_id=owner_user_id,
            attendance_id=data.attendance_id,
            requested_start=data.requested_start,
            requested_end=data.requested_end,
            notes=data.notes,
        )
        return self._to_response(req)

    # ── Approve ───────────────────────────────────────────────────────────────

    async def approve(
        self, request_id: int, approver, body: ApproveBody = None
    ) -> OvertimeRequestResponse:
        if body is None:
            body = ApproveBody()
        req = await self.repo.get_by_id(request_id)
        if not req:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Overtime request not found.",
            )
        if req.status != "PENDING":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot approve a request with status '{req.status}'.",
            )
        await self._assert_can_access(req, approver)

        # Optional time-window override
        eff_start = body.approved_start or req.requested_start
        eff_end = body.approved_end or req.requested_end

        # Validate override window against attendance (only when attendance exists)
        att = req.attendance
        if body.approved_start is not None:
            if att is not None:
                if eff_start < att.checkin_time:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail="approved_start cannot be before check-in time.",
                    )
                if att.checkout_time and eff_end > att.checkout_time:
                    raise HTTPException(
                        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                        detail="approved_end cannot be after check-out time.",
                    )
            req.requested_start = eff_start
            req.requested_end = eff_end

        if body.supervisor_notes is not None:
            req.supervisor_notes = body.supervisor_notes

        # Write overtime_minutes to the attendance record if linked
        if att is not None:
            ot_minutes = max(0, int((eff_end - eff_start).total_seconds() / 60))
            await self.att_repo.set_overtime_minutes(req.attendance_id, ot_minutes)

        req = await self.repo.update_status(req, "APPROVED", approver.id)
        return self._to_response(req)

    # ── Reject ────────────────────────────────────────────────────────────────

    async def reject(
        self, request_id: int, approver, body: RejectBody = None
    ) -> OvertimeRequestResponse:
        if body is None:
            body = RejectBody()
        req = await self.repo.get_by_id(request_id)
        if not req:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Overtime request not found.",
            )
        if req.status != "PENDING":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Cannot reject a request with status '{req.status}'.",
            )
        await self._assert_can_access(req, approver)

        if body.supervisor_notes is not None:
            req.supervisor_notes = body.supervisor_notes

        req = await self.repo.update_status(req, "REJECTED", approver.id)
        return self._to_response(req)

    # ── Queries ───────────────────────────────────────────────────────────────

    async def list_my_requests(
        self,
        current_user,
        ot_status: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[OvertimeRequestResponse]:
        """Returns only the current user's own overtime requests (all roles)."""
        records = await self.repo.get_all(
            user_id=current_user.id,
            ot_status=ot_status,
            limit=limit,
            offset=offset,
        )
        return [self._to_response(r) for r in records]

    async def list_requests(
        self,
        current_user,
        ot_status: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[OvertimeRequestResponse]:
        """Role-scoped list: EMPLOYEE=own, SUPERVISOR=team, ADMIN=all."""
        role = current_user.role.name
        if role == "EMPLOYEE":
            records = await self.repo.get_all(
                user_id=current_user.id,
                ot_status=ot_status,
                limit=limit,
                offset=offset,
            )
        elif role == "SUPERVISOR":
            sub_ids = await self._get_subordinate_ids(current_user.id)
            records = await self.repo.get_all(
                subordinate_ids=sub_ids,
                ot_status=ot_status,
                limit=limit,
                offset=offset,
            )
        else:  # ADMIN
            records = await self.repo.get_all(
                ot_status=ot_status,
                limit=limit,
                offset=offset,
            )
        return [self._to_response(r) for r in records]

    async def get_by_id(
        self, request_id: int, current_user
    ) -> OvertimeRequestResponse:
        req = await self.repo.get_by_id(request_id)
        if not req:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Overtime request not found.",
            )
        await self._assert_can_access(req, current_user)
        return self._to_response(req)

    async def list_by_attendance(
        self, attendance_id: int, current_user
    ) -> List[OvertimeRequestResponse]:
        att = await self.att_repo.get_by_id(attendance_id)
        if not att:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Attendance record not found.",
            )
        if current_user.role.name == "EMPLOYEE" and att.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied.")
        elif current_user.role.name == "SUPERVISOR":
            sub_ids = await self._get_subordinate_ids(current_user.id)
            if att.user_id not in sub_ids:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied: employee is not your direct subordinate.",
                )
        records = await self.repo.get_by_attendance(attendance_id)
        return [self._to_response(r) for r in records]
