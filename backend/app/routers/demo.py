"""
Public demo endpoints
---------------------
  GET   /demo        — whether this server is a demo and when its data resets
  POST  /demo/login  — one-click sign-in as ADMIN, SUPERVISOR or EMPLOYEE

Both answer for any server; /demo/login is 404 unless DEMO_MODE is on.
"""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from pymongo.asynchronous.database import AsyncDatabase

from app.core.config import settings
from app.core.database import get_db
from app.core.ratelimit import rate_limit
from app.schemas.auth import TokenResponse
from app.services import demo_service

router = APIRouter(prefix="/demo", tags=["Demo"])

DemoRole = Literal["ADMIN", "SUPERVISOR", "EMPLOYEE"]


class DemoInfo(BaseModel):
    enabled: bool
    roles: list[DemoRole] = []
    last_reset_at: str | None = None
    next_reset_at: str | None = None


class DemoLoginRequest(BaseModel):
    role: DemoRole


@router.get("", response_model=DemoInfo, summary="Demo mode status")
async def demo_info(db: AsyncDatabase = Depends(get_db)) -> DemoInfo:
    if not settings.DEMO_MODE:
        return DemoInfo(enabled=False)
    last = await demo_service.last_reset(db)
    return DemoInfo(
        enabled=True,
        roles=["ADMIN", "SUPERVISOR", "EMPLOYEE"],
        last_reset_at=last.isoformat() if last else None,
        next_reset_at=demo_service.next_reset_after(last).isoformat() if last else None,
    )


@router.post(
    "/login",
    response_model=TokenResponse,
    summary="Sign in to the demo as a role (each EMPLOYEE sign-in gets a new account)",
    dependencies=[rate_limit(settings.RATE_LIMIT_DEMO_LOGIN, "demo-login")],
)
async def demo_login(data: DemoLoginRequest, db: AsyncDatabase = Depends(get_db)) -> TokenResponse:
    if not settings.DEMO_MODE:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")
    return await demo_service.login(db, data.role)
