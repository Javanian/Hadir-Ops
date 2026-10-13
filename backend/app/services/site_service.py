from typing import List

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.repositories.site_repository import SiteRepository
from app.schemas.site import SiteCreate, SiteResponse, SiteUpdate


class SiteService:
    def __init__(self, db: AsyncSession):
        self.repo = SiteRepository(db)

    async def list_sites(self) -> List[SiteResponse]:
        sites = await self.repo.get_all()
        return [SiteResponse.model_validate(s) for s in sites]

    async def get_site(self, site_id: int) -> SiteResponse:
        site = await self.repo.get_by_id(site_id)
        if not site:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
        return SiteResponse.model_validate(site)

    async def create_site(self, data: SiteCreate) -> SiteResponse:
        existing = await self.repo.get_by_name(data.name)
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Site with name '{data.name}' already exists",
            )
        site = await self.repo.create(
            name=data.name,
            latitude=data.latitude,
            longitude=data.longitude,
            radius_meter=data.radius_meter,
        )
        return SiteResponse.model_validate(site)

    async def update_site(self, site_id: int, data: SiteUpdate) -> SiteResponse:
        site = await self.repo.get_by_id(site_id)
        if not site:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")

        updates = data.model_dump(exclude_none=True)
        if not updates:
            return SiteResponse.model_validate(site)

        # Check name uniqueness if being changed
        if "name" in updates and updates["name"] != site.name:
            existing = await self.repo.get_by_name(updates["name"])
            if existing:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Site with name '{updates['name']}' already exists",
                )

        site = await self.repo.update(site, **updates)
        return SiteResponse.model_validate(site)

    async def delete_site(self, site_id: int) -> None:
        site = await self.repo.get_by_id(site_id)
        if not site:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Site not found")
        await self.repo.delete(site)
