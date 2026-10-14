from datetime import date, datetime
from typing import List, Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.models import LeaveRequest, User

ACTIVE_STATUSES = ("PENDING", "APPROVED")


class LeaveRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _base_stmt(self):
        return select(LeaveRequest).options(
            selectinload(LeaveRequest.user),
            selectinload(LeaveRequest.reviewer),
        )

    async def get_by_id(self, leave_id: int) -> Optional[LeaveRequest]:
        # populate_existing: status changes go through UPDATE statements, so a
        # copy already in the session must be refreshed, relationships included.
        result = await self.db.execute(
            self._base_stmt()
            .where(LeaveRequest.id == leave_id)
            .execution_options(populate_existing=True)
        )
        return result.scalar_one_or_none()

    async def lock_user(self, user_id: int) -> None:
        """Serialise leave submissions per user so two concurrent requests
        cannot both pass the overlap check."""
        await self.db.execute(select(User.id).where(User.id == user_id).with_for_update())

    async def find_overlapping_active(
        self, user_id: int, start: date, end: date
    ) -> Optional[LeaveRequest]:
        result = await self.db.execute(
            select(LeaveRequest)
            .where(
                LeaveRequest.user_id == user_id,
                LeaveRequest.status.in_(ACTIVE_STATUSES),
                LeaveRequest.start_date <= end,
                LeaveRequest.end_date >= start,
            )
            .order_by(LeaveRequest.start_date)
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def list(
        self,
        user_ids: Optional[List[int]] = None,
        status: Optional[str] = None,
        from_date: Optional[date] = None,
        to_date: Optional[date] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> List[LeaveRequest]:
        """`user_ids=None` means no restriction; an empty list matches nothing."""
        stmt = self._base_stmt()
        if user_ids is not None:
            stmt = stmt.where(LeaveRequest.user_id.in_(user_ids or [-1]))
        if status:
            stmt = stmt.where(LeaveRequest.status == status)
        if from_date:
            stmt = stmt.where(LeaveRequest.end_date >= from_date)
        if to_date:
            stmt = stmt.where(LeaveRequest.start_date <= to_date)
        stmt = stmt.order_by(LeaveRequest.start_date.desc(), LeaveRequest.id.desc())
        result = await self.db.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().all())

    def add(self, leave: LeaveRequest) -> None:
        self.db.add(leave)

    async def transition_from_pending(
        self,
        leave_id: int,
        new_status: str,
        reviewed_by: Optional[int] = None,
        reviewed_at: Optional[datetime] = None,
        review_note: Optional[str] = None,
    ) -> bool:
        """Move a PENDING request to `new_status`. Returns False if it was no
        longer PENDING (someone else decided first)."""
        values = {"status": new_status}
        if reviewed_by is not None:
            values.update(reviewed_by=reviewed_by, reviewed_at=reviewed_at, review_note=review_note)
        result = await self.db.execute(
            update(LeaveRequest)
            .where(LeaveRequest.id == leave_id, LeaveRequest.status == "PENDING")
            .values(**values)
        )
        return result.rowcount == 1
