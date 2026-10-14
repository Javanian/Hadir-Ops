from datetime import datetime
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.models import CheckinAttempt, User


class AttemptRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def insert_many(self, user_id: int, rows: List[dict]) -> int:
        """Insert attempts, ignoring ids already stored. Returns how many were new."""
        if not rows:
            return 0
        stmt = (
            insert(CheckinAttempt)
            .values([{**row, "user_id": user_id} for row in rows])
            .on_conflict_do_nothing(index_elements=["client_event_id"])
            .returning(CheckinAttempt.id)
        )
        result = await self.db.execute(stmt)
        inserted = len(result.fetchall())
        await self.db.commit()
        return inserted

    async def list(
        self,
        user_ids: Optional[List[int]],
        from_utc: Optional[datetime] = None,
        to_utc: Optional[datetime] = None,
        limit: int = 200,
        offset: int = 0,
    ) -> List[CheckinAttempt]:
        stmt = (
            select(CheckinAttempt)
            .options(selectinload(CheckinAttempt.user).selectinload(User.site))
            .order_by(CheckinAttempt.captured_at.desc())
        )
        if user_ids is not None:
            if not user_ids:
                return []
            stmt = stmt.where(CheckinAttempt.user_id.in_(user_ids))
        if from_utc is not None:
            stmt = stmt.where(CheckinAttempt.captured_at >= from_utc)
        if to_utc is not None:
            stmt = stmt.where(CheckinAttempt.captured_at < to_utc)
        result = await self.db.execute(stmt.limit(limit).offset(offset))
        return list(result.scalars().all())
