from datetime import date
from typing import List, Optional

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.models import TemporaryAssignment


def _with_relations(query):
    return query.options(
        selectinload(TemporaryAssignment.user),
        selectinload(TemporaryAssignment.site),
        selectinload(TemporaryAssignment.shift),
        selectinload(TemporaryAssignment.creator),
    )


class AssignmentRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_all(
        self,
        skip: int = 0,
        limit: int = 100,
        user_id: Optional[int] = None,
        site_id: Optional[int] = None,
        active_only: bool = False,
    ) -> List[TemporaryAssignment]:
        q = _with_relations(
            select(TemporaryAssignment).order_by(TemporaryAssignment.start_date.desc())
        )
        if user_id is not None:
            q = q.where(TemporaryAssignment.user_id == user_id)
        if site_id is not None:
            q = q.where(TemporaryAssignment.site_id == site_id)
        if active_only:
            today = date.today()
            q = q.where(
                TemporaryAssignment.start_date <= today,
                TemporaryAssignment.end_date >= today,
            )
        result = await self.db.execute(q.offset(skip).limit(limit))
        return list(result.scalars().all())

    async def get_by_id(self, assignment_id: int) -> Optional[TemporaryAssignment]:
        q = _with_relations(
            select(TemporaryAssignment).where(TemporaryAssignment.id == assignment_id)
        )
        result = await self.db.execute(q)
        return result.scalar_one_or_none()

    async def get_active_for_user(
        self, user_id: int, target_date: date
    ) -> Optional[TemporaryAssignment]:
        """Return the first active assignment for a user on the given date."""
        q = _with_relations(
            select(TemporaryAssignment).where(
                and_(
                    TemporaryAssignment.user_id == user_id,
                    TemporaryAssignment.start_date <= target_date,
                    TemporaryAssignment.end_date >= target_date,
                )
            )
        )
        result = await self.db.execute(q)
        return result.scalars().first()

    async def check_overlap(
        self,
        user_id: int,
        start_date: date,
        end_date: date,
        exclude_id: Optional[int] = None,
    ) -> bool:
        """Return True if an overlapping assignment exists for the user."""
        q = select(TemporaryAssignment).where(
            and_(
                TemporaryAssignment.user_id == user_id,
                TemporaryAssignment.start_date <= end_date,
                TemporaryAssignment.end_date >= start_date,
            )
        )
        if exclude_id is not None:
            q = q.where(TemporaryAssignment.id != exclude_id)
        result = await self.db.execute(q)
        return result.scalar_one_or_none() is not None

    async def create(
        self,
        data,  # AssignmentCreate
        created_by: Optional[int],
    ) -> TemporaryAssignment:
        assignment = TemporaryAssignment(
            user_id=data.user_id,
            site_id=data.site_id,
            shift_id=data.shift_id,
            start_date=data.start_date,
            end_date=data.end_date,
            notes=data.notes,
            created_by=created_by,
        )
        self.db.add(assignment)
        await self.db.flush()
        await self.db.refresh(assignment)
        # Reload with relationships
        return await self.get_by_id(assignment.id)  # type: ignore[return-value]

    async def delete(self, assignment: TemporaryAssignment) -> None:
        await self.db.delete(assignment)
        await self.db.commit()
