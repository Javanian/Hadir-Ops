from datetime import datetime
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.models import OvertimeRequest


class OvertimeRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    def _base_stmt(self):
        return select(OvertimeRequest).options(
            selectinload(OvertimeRequest.attendance),
            selectinload(OvertimeRequest.submitter),
            selectinload(OvertimeRequest.approver),
        )

    # ── Queries ───────────────────────────────────────────────────────────────

    async def get_by_id(self, request_id: int) -> Optional[OvertimeRequest]:
        result = await self.db.execute(
            self._base_stmt().where(OvertimeRequest.id == request_id)
        )
        return result.scalar_one_or_none()

    async def get_by_attendance(self, attendance_id: int) -> List[OvertimeRequest]:
        result = await self.db.execute(
            self._base_stmt()
            .where(OvertimeRequest.attendance_id == attendance_id)
            .order_by(OvertimeRequest.created_at.desc())
        )
        return list(result.scalars().all())

    async def get_active_for_attendance(self, attendance_id: int) -> Optional[OvertimeRequest]:
        """Return the latest PENDING or APPROVED request for an attendance (prevents duplicates)."""
        result = await self.db.execute(
            self._base_stmt()
            .where(
                OvertimeRequest.attendance_id == attendance_id,
                OvertimeRequest.status.in_(["PENDING", "APPROVED"]),
            )
            .order_by(OvertimeRequest.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_active_for_user_window(
        self, user_id: int, window_start: datetime, window_end: datetime
    ) -> Optional[OvertimeRequest]:
        """Return an active request that overlaps the given window for a user (standalone OT)."""
        result = await self.db.execute(
            self._base_stmt()
            .where(
                OvertimeRequest.user_id == user_id,
                OvertimeRequest.attendance_id.is_(None),
                OvertimeRequest.status.in_(["PENDING", "APPROVED"]),
                OvertimeRequest.requested_start < window_end,
                OvertimeRequest.requested_end > window_start,
            )
            .order_by(OvertimeRequest.created_at.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_approved_standalone_covering(
        self, user_id: int, moment: datetime
    ) -> Optional[OvertimeRequest]:
        """Return the APPROVED standalone OT request (no attendance_id) whose
        window contains *moment* (UTC-aware datetime).  Used by check-in to
        allow employees to clock in during an approved overtime window that has
        no corresponding regular shift."""
        result = await self.db.execute(
            self._base_stmt()
            .where(
                OvertimeRequest.user_id == user_id,
                OvertimeRequest.attendance_id.is_(None),
                OvertimeRequest.status == "APPROVED",
                OvertimeRequest.requested_start <= moment,
                OvertimeRequest.requested_end > moment,
            )
            .order_by(OvertimeRequest.requested_start.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_approved_standalone_for_checkin(
        self, user_id: int, checkin_utc: datetime
    ) -> Optional[OvertimeRequest]:
        """Return the APPROVED standalone OT request whose window contains
        checkin_utc.  Used by auto-checkout to find the OT end time when
        shift_id is NULL on an attendance record."""
        result = await self.db.execute(
            self._base_stmt()
            .where(
                OvertimeRequest.user_id == user_id,
                OvertimeRequest.attendance_id.is_(None),
                OvertimeRequest.status == "APPROVED",
                OvertimeRequest.requested_start <= checkin_utc,
                OvertimeRequest.requested_end > checkin_utc,
            )
            .order_by(OvertimeRequest.requested_start.desc())
            .limit(1)
        )
        return result.scalar_one_or_none()

    async def get_all(
        self,
        user_id: Optional[int] = None,          # filter by owner (works for all roles)
        subordinate_ids: Optional[list] = None,  # SUPERVISOR: direct subordinates only
        ot_status: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> List[OvertimeRequest]:
        stmt = (
            self._base_stmt()
            .order_by(OvertimeRequest.created_at.desc())
        )
        if user_id is not None:
            stmt = stmt.where(OvertimeRequest.user_id == user_id)
        if subordinate_ids is not None:
            stmt = stmt.where(OvertimeRequest.user_id.in_(subordinate_ids))
        if ot_status is not None:
            stmt = stmt.where(OvertimeRequest.status == ot_status)
        stmt = stmt.limit(limit).offset(offset)
        result = await self.db.execute(stmt)
        return list(result.scalars().all())

    # ── Mutations ─────────────────────────────────────────────────────────────

    async def create(
        self,
        user_id: int,
        requested_start: datetime,
        requested_end: datetime,
        attendance_id: Optional[int] = None,
        notes: Optional[str] = None,
    ) -> OvertimeRequest:
        req = OvertimeRequest(
            user_id=user_id,
            attendance_id=attendance_id,
            requested_start=requested_start,
            requested_end=requested_end,
            notes=notes,
            status="PENDING",
        )
        self.db.add(req)
        await self.db.commit()
        await self.db.refresh(req)
        # Re-fetch with relationships loaded
        return await self.get_by_id(req.id)

    async def update_status(
        self,
        req: OvertimeRequest,
        new_status: str,
        approved_by: int,
    ) -> OvertimeRequest:
        req.status = new_status
        req.approved_by = approved_by
        await self.db.commit()
        await self.db.refresh(req)
        return req
