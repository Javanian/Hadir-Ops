from datetime import date
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.assignment_repository import AssignmentRepository
from app.repositories.site_repository import SiteRepository
from app.repositories.shift_repository import ShiftRepository
from app.repositories.user_repository import UserRepository
from app.schemas.assignment import AssignmentCreate, AssignmentResponse


class AssignmentService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.repo = AssignmentRepository(db)
        self.site_repo = SiteRepository(db)
        self.shift_repo = ShiftRepository(db)
        self.user_repo = UserRepository(db)

    async def list_assignments(
        self,
        user_id: Optional[int] = None,
        site_id: Optional[int] = None,
        active_only: bool = False,
        skip: int = 0,
        limit: int = 100,
    ) -> List[AssignmentResponse]:
        records = await self.repo.get_all(
            skip=skip, limit=limit,
            user_id=user_id, site_id=site_id,
            active_only=active_only,
        )
        return [AssignmentResponse.model_validate(r) for r in records]

    async def create_assignment(
        self, data: AssignmentCreate, current_user
    ) -> AssignmentResponse:
        # Validate user exists
        user = await self.user_repo.get_by_id(data.user_id)
        if not user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User tidak ditemukan.",
            )

        # Validate site exists
        site = await self.site_repo.get_by_id(data.site_id)
        if not site:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Lokasi tidak ditemukan.",
            )

        # Validate shift belongs to the chosen site
        all_shifts = await self.shift_repo.get_all(site_id=data.site_id)
        shift_ids = {s.id for s in all_shifts}
        if data.shift_id not in shift_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Shift tidak ditemukan pada lokasi yang dipilih.",
            )

        # Check for overlapping assignment for the same user
        overlaps = await self.repo.check_overlap(
            user_id=data.user_id,
            start_date=data.start_date,
            end_date=data.end_date,
        )
        if overlaps:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="User sudah memiliki penugasan pada rentang tanggal tersebut.",
            )

        assignment = await self.repo.create(data=data, created_by=current_user.id)
        await self.db.commit()
        return AssignmentResponse.model_validate(assignment)

    async def delete_assignment(self, assignment_id: int, current_user) -> None:
        assignment = await self.repo.get_by_id(assignment_id)
        if not assignment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Penugasan tidak ditemukan.",
            )
        await self.repo.delete(assignment)

    async def get_active_assignment(
        self, current_user
    ) -> Optional[AssignmentResponse]:
        """Return the active assignment for the current user today (if any)."""
        # Use user's site timezone to determine "today"
        if current_user.site_id:
            site = await self.site_repo.get_by_id(current_user.site_id)
            tz_str = site.timezone if site else "Asia/Jakarta"
        else:
            tz_str = "Asia/Jakarta"

        from datetime import datetime
        today = datetime.now(ZoneInfo(tz_str)).date()
        assignment = await self.repo.get_active_for_user(current_user.id, today)
        if not assignment:
            return None
        return AssignmentResponse.model_validate(assignment)
