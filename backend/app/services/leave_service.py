"""
Leave Service — sick days, permits and annual leave
====================================================
Rules:
  1. Anyone with an account submits leave for themselves; a request covers at
     most 30 calendar days.
  2. The start date may be up to 7 days in the past (a sick note handed in
     after recovery) and up to 90 days ahead, counted in the site-local date.
  3. A request may not overlap another PENDING or APPROVED request of the same
     person. Submissions are serialised per user with a row lock.
  4. The owner can cancel while the request is PENDING.
  5. SUPERVISOR decides for direct subordinates, ADMIN for everyone; nobody
     decides on their own request. Rejection needs a note. A decision only
     applies to a PENDING request, so two reviewers cannot both decide.
"""

from datetime import date, datetime, timedelta, timezone
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.models import LeaveRequest
from app.repositories.leave_repository import LeaveRepository
from app.schemas.leave import LeaveDecision, LeaveRequestCreate, LeaveRequestResponse

MAX_BACKDATE_DAYS = 7
MAX_ADVANCE_DAYS = 90


def _site_today(user) -> date:
    tz = user.site.timezone if getattr(user, "site", None) else "Asia/Jakarta"
    return datetime.now(ZoneInfo(tz)).date()


class LeaveService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = LeaveRepository(db)

    async def _scope_user_ids(self, current_user) -> Optional[List[int]]:
        """None = everyone (ADMIN); otherwise the supervisor's direct reports."""
        if current_user.role.name == "ADMIN":
            return None
        from app.repositories.user_repository import UserRepository

        return await UserRepository(self.db).get_subordinate_ids(current_user.id)

    async def _response(self, leave_id: int) -> LeaveRequestResponse:
        leave = await self.repo.get_by_id(leave_id)
        return LeaveRequestResponse.from_orm_obj(leave)

    # ── Employee side ─────────────────────────────────────────────────────────

    async def create(self, current_user, data: LeaveRequestCreate) -> LeaveRequestResponse:
        today = _site_today(current_user)
        if data.start_date < today - timedelta(days=MAX_BACKDATE_DAYS):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Leave can start at most {MAX_BACKDATE_DAYS} days in the past.",
            )
        if data.start_date > today + timedelta(days=MAX_ADVANCE_DAYS):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Leave can be requested at most {MAX_ADVANCE_DAYS} days ahead.",
            )

        await self.repo.lock_user(current_user.id)
        clash = await self.repo.find_overlapping_active(current_user.id, data.start_date, data.end_date)
        if clash:
            detail = {
                "code": "LEAVE_OVERLAP",
                "message": (
                    f"Overlaps request #{clash.id} ({clash.start_date} to {clash.end_date}, "
                    f"status={clash.status})."
                ),
                "leave_id": clash.id,
            }
            await self.db.rollback()  # releases the row lock
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)

        leave = LeaveRequest(
            user_id=current_user.id,
            leave_type=data.leave_type,
            start_date=data.start_date,
            end_date=data.end_date,
            reason=data.reason,
            status="PENDING",
        )
        self.repo.add(leave)
        await self.db.commit()
        return await self._response(leave.id)

    async def list_mine(
        self, current_user, leave_status: Optional[str], limit: int, offset: int
    ) -> List[LeaveRequestResponse]:
        rows = await self.repo.list(
            user_ids=[current_user.id], status=leave_status, limit=limit, offset=offset
        )
        return [LeaveRequestResponse.from_orm_obj(r) for r in rows]

    async def cancel(self, leave_id: int, current_user) -> LeaveRequestResponse:
        leave = await self.repo.get_by_id(leave_id)
        if not leave or leave.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave request not found.")
        if not await self.repo.transition_from_pending(leave_id, "CANCELLED"):
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Only a pending request can be cancelled.",
            )
        await self.db.commit()
        return await self._response(leave_id)

    # ── Supervisor / admin side ───────────────────────────────────────────────

    async def list_team(
        self,
        current_user,
        leave_status: Optional[str],
        from_date: Optional[date],
        to_date: Optional[date],
        limit: int,
        offset: int,
    ) -> List[LeaveRequestResponse]:
        user_ids = await self._scope_user_ids(current_user)
        rows = await self.repo.list(
            user_ids=user_ids,
            status=leave_status,
            from_date=from_date,
            to_date=to_date,
            limit=limit,
            offset=offset,
        )
        return [LeaveRequestResponse.from_orm_obj(r) for r in rows]

    async def decide(self, leave_id: int, current_user, data: LeaveDecision) -> LeaveRequestResponse:
        leave = await self.repo.get_by_id(leave_id)
        if not leave:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Leave request not found.")
        if leave.user_id == current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You cannot decide on your own leave request.",
            )
        user_ids = await self._scope_user_ids(current_user)
        if user_ids is not None and leave.user_id not in user_ids:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your team member.")

        note = (data.note or "").strip() or None
        if data.decision == "REJECTED" and not note:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="A note is required when rejecting, so the employee knows why.",
            )

        decided = await self.repo.transition_from_pending(
            leave_id,
            data.decision,
            reviewed_by=current_user.id,
            reviewed_at=datetime.now(timezone.utc),
            review_note=note,
        )
        if not decided:
            await self.db.rollback()
            current = await self.repo.get_by_id(leave_id)
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"This request is already {current.status if current else 'gone'}.",
            )
        await self.db.commit()
        return await self._response(leave_id)
