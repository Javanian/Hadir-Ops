from datetime import datetime, timezone
from typing import List, Optional

from pymongo.asynchronous.database import AsyncDatabase

from app.db import in_transaction
from app.db.documents import Site
from app.db.ids import next_id


class SiteRepository:
    def __init__(self, db: AsyncDatabase):
        self.db = db

    async def get_all(self) -> List[Site]:
        return [Site.from_doc(d) async for d in self.db.sites.find().sort("_id", 1)]

    async def get_by_id(self, site_id: int) -> Optional[Site]:
        doc = await self.db.sites.find_one({"_id": site_id})
        return Site.from_doc(doc) if doc else None

    async def get_by_name(self, name: str) -> Optional[Site]:
        doc = await self.db.sites.find_one({"name": name})
        return Site.from_doc(doc) if doc else None

    async def create(
        self,
        name: str,
        latitude: float,
        longitude: float,
        radius_meter: int,
        timezone_name: str = "Asia/Jakarta",
    ) -> Site:
        doc = {
            "_id": await next_id(self.db, "sites"),
            "name": name,
            "latitude": latitude,
            "longitude": longitude,
            "radius_meter": radius_meter,
            "timezone": timezone_name,
            "created_at": datetime.now(timezone.utc),
        }
        await self.db.sites.insert_one(doc)
        return Site.from_doc(doc)

    async def update(self, site: Site, **kwargs) -> Site:
        fields = {k: v for k, v in kwargs.items() if v is not None}
        if fields:
            await self.db.sites.update_one({"_id": site.id}, {"$set": fields})
        return await self.get_by_id(site.id)

    async def users_assigned(self, site_id: int) -> int:
        return await self.db.users.count_documents({"site_id": site_id})

    async def delete(self, site: Site) -> None:
        """Delete a site with its shifts and assignments (the old ON DELETE CASCADE)."""
        db = self.db

        async def run(session):
            await db.shifts.delete_many({"site_id": site.id}, session=session)
            await db.temporary_assignments.delete_many({"site_id": site.id}, session=session)
            await db.sites.delete_one({"_id": site.id}, session=session)

        await in_transaction(run)
