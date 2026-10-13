from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role
from app.schemas.shift import (
    HolidayCreate,
    HolidayResponse,
    HolidayUpdate,
    ShiftCreate,
    ShiftResponse,
    ShiftUpdate,
    WorkScheduleCreate,
    WorkScheduleResponse,
)
from app.services.shift_service import ShiftService

router = APIRouter(tags=["Shifts & Schedules"])


# ── Shifts ─────────────────────────────────────────────────────────────────────

@router.get("/shifts", response_model=List[ShiftResponse], summary="List shifts")
async def list_shifts(
    site_id: Optional[int] = Query(None, description="Filter by site"),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    return await ShiftService(db).list_shifts(site_id=site_id)


@router.get("/shifts/{shift_id}", response_model=ShiftResponse, summary="Get shift by ID")
async def get_shift(
    shift_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    return await ShiftService(db).get_shift(shift_id)


@router.post(
    "/shifts",
    response_model=ShiftResponse,
    status_code=201,
    summary="Create shift (ADMIN/SUPERVISOR)",
)
async def create_shift(
    data: ShiftCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_role("ADMIN", "SUPERVISOR")),
):
    return await ShiftService(db).create_shift(data)


@router.patch(
    "/shifts/{shift_id}",
    response_model=ShiftResponse,
    summary="Update shift (ADMIN/SUPERVISOR)",
)
async def update_shift(
    shift_id: int,
    data: ShiftUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_role("ADMIN", "SUPERVISOR")),
):
    return await ShiftService(db).update_shift(shift_id, data)


@router.delete(
    "/shifts/{shift_id}",
    status_code=204,
    summary="Delete shift (ADMIN only)",
)
async def delete_shift(
    shift_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_role("ADMIN")),
):
    await ShiftService(db).delete_shift(shift_id)


# ── Work Schedules ─────────────────────────────────────────────────────────────

@router.post(
    "/shifts/{shift_id}/schedules",
    response_model=WorkScheduleResponse,
    status_code=201,
    summary="Add a day schedule to a shift",
)
async def add_schedule(
    shift_id: int,
    data: WorkScheduleCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_role("ADMIN", "SUPERVISOR")),
):
    return await ShiftService(db).add_schedule(shift_id, data)


@router.delete(
    "/schedules/{schedule_id}",
    status_code=204,
    summary="Remove a day schedule",
)
async def delete_schedule(
    schedule_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_role("ADMIN", "SUPERVISOR")),
):
    await ShiftService(db).delete_schedule(schedule_id)


# ── Holidays ───────────────────────────────────────────────────────────────────

@router.get("/holidays", response_model=List[HolidayResponse], summary="List holidays")
async def list_holidays(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    return await ShiftService(db).list_holidays()


@router.post(
    "/holidays",
    response_model=HolidayResponse,
    status_code=201,
    summary="Add holiday (ADMIN only)",
)
async def create_holiday(
    data: HolidayCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_role("ADMIN")),
):
    return await ShiftService(db).create_holiday(data)


@router.patch(
    "/holidays/{holiday_id}",
    response_model=HolidayResponse,
    summary="Update holiday (ADMIN only)",
)
async def update_holiday(
    holiday_id: int,
    data: HolidayUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_role("ADMIN")),
):
    return await ShiftService(db).update_holiday(holiday_id, data)


@router.delete(
    "/holidays/{holiday_id}",
    status_code=204,
    summary="Delete holiday (ADMIN only)",
)
async def delete_holiday(
    holiday_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_role("ADMIN")),
):
    await ShiftService(db).delete_holiday(holiday_id)
