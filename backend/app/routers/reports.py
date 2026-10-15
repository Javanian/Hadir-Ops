"""
Reports Router
==============
Endpoints:
  GET /reports/recap   — Per-employee attendance recap for a date range
                         (SUPERVISOR: direct reports; ADMIN: everyone)
"""

from datetime import date
from typing import List

from fastapi import APIRouter, Depends, Query
from pymongo.asynchronous.database import AsyncDatabase

from app.core.database import get_db
from app.core.dependencies import require_role
from app.schemas.recap import RecapRow
from app.services.recap_service import RecapService

router = APIRouter(prefix="/reports", tags=["Reports"])


@router.get(
    "/recap",
    response_model=List[RecapRow],
    summary="Attendance recap per employee: present, late, leave, absent without notice",
)
async def attendance_recap(
    from_date: date = Query(...),
    to_date: date = Query(...),
    db: AsyncDatabase = Depends(get_db),
    current_user=Depends(require_role("ADMIN", "SUPERVISOR")),
):
    return await RecapService(db).recap(current_user, from_date, to_date)
