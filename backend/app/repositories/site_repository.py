from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.models import Site


class SiteRepository:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def get_all(self) -> List[Site]:
        result = await self.db.execute(select(Site).order_by(Site.id))
        return list(result.scalars().all())

    async def get_by_id(self, site_id: int) -> Optional[Site]:
        result = await self.db.execute(select(Site).where(Site.id == site_id))
        return result.scalar_one_or_none()

    async def get_by_name(self, name: str) -> Optional[Site]:
        result = await self.db.execute(select(Site).where(Site.name == name))
        return result.scalar_one_or_none()

    async def create(self, name: str, latitude: float, longitude: float, radius_meter: int) -> Site:
        site = Site(
            name=name,
            latitude=latitude,
            longitude=longitude,
            radius_meter=radius_meter,
        )
        self.db.add(site)
        await self.db.commit()
        await self.db.refresh(site)
        return site

    async def update(self, site: Site, **kwargs) -> Site:
        for key, value in kwargs.items():
            if value is not None:
                setattr(site, key, value)
        await self.db.commit()
        await self.db.refresh(site)
        return site

    async def delete(self, site: Site) -> None:
        await self.db.delete(site)
        await self.db.commit()
