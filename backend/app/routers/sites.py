from typing import List

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role
from app.schemas.site import SiteCreate, SiteResponse, SiteUpdate
from app.services.site_service import SiteService

router = APIRouter(prefix="/sites", tags=["Sites"])


@router.get("", response_model=List[SiteResponse], summary="List all sites")
async def list_sites(
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),  # any authenticated user can list
):
    return await SiteService(db).list_sites()


@router.get("/{site_id}", response_model=SiteResponse, summary="Get site by ID")
async def get_site(
    site_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    return await SiteService(db).get_site(site_id)


@router.post("", response_model=SiteResponse, status_code=201, summary="Create site (ADMIN only)")
async def create_site(
    data: SiteCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_role("ADMIN")),
):
    return await SiteService(db).create_site(data)


@router.patch("/{site_id}", response_model=SiteResponse, summary="Update site (ADMIN only)")
async def update_site(
    site_id: int,
    data: SiteUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_role("ADMIN")),
):
    return await SiteService(db).update_site(site_id, data)


@router.delete("/{site_id}", status_code=204, summary="Delete site (ADMIN only)")
async def delete_site(
    site_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_role("ADMIN")),
):
    await SiteService(db).delete_site(site_id)
