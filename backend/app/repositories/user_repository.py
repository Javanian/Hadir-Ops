import re
from datetime import datetime, timezone
from typing import Optional

from pymongo import ReturnDocument
from pymongo.asynchronous.database import AsyncDatabase

from app.db import in_transaction
from app.db.documents import ROLES, Role, User
from app.db.ids import next_id
from app.db.relations import attach_user_sites


class UserRepository:
    def __init__(self, db: AsyncDatabase):
        self.db = db

    async def _one(self, query: dict) -> Optional[User]:
        doc = await self.db.users.find_one(query)
        if doc is None:
            return None
        user = User.from_doc(doc)
        await attach_user_sites(self.db, [user])
        return user

    # ── Lookups ───────────────────────────────────────────────────────────────

    async def get_by_email(self, email: str) -> Optional[User]:
        return await self._one({"email": email})

    async def get_by_employee_id(self, employee_id: str) -> Optional[User]:
        return await self._one({"employee_id": employee_id})

    async def get_by_id(self, user_id: int) -> Optional[User]:
        return await self._one({"_id": user_id})

    async def get_subordinate_ids(self, supervisor_id: int) -> list[int]:
        """Return IDs of all users directly supervised by supervisor_id."""
        return [d["_id"] async for d in self.db.users.find({"supervisor_id": supervisor_id}, {"_id": 1})]

    async def get_role_by_name(self, name: str) -> Optional[Role]:
        return Role(name) if name in ROLES else None

    # ── Login state ───────────────────────────────────────────────────────────

    async def increment_failed_attempts(self, user: User, lock_until: Optional[datetime] = None) -> None:
        update: dict = {"$inc": {"failed_login_attempts": 1}}
        if lock_until is not None:
            update["$set"] = {"locked_until": lock_until}
        doc = await self.db.users.find_one_and_update(
            {"_id": user.id}, update, return_document=ReturnDocument.AFTER
        )
        user.failed_login_attempts = doc.get("failed_login_attempts", 0)
        user.locked_until = doc.get("locked_until")

    async def reset_failed_attempts(self, user: User) -> None:
        await self.db.users.update_one(
            {"_id": user.id}, {"$set": {"failed_login_attempts": 0, "locked_until": None}}
        )
        user.failed_login_attempts = 0
        user.locked_until = None

    async def update_password(self, user: User, new_hash: str, changed_at: datetime) -> None:
        await self.db.users.update_one(
            {"_id": user.id},
            {"$set": {"password_hash": new_hash, "password_changed_at": changed_at}},
        )
        user.password_hash = new_hash
        user.password_changed_at = changed_at

    async def update_face_embedding(self, user_id: int, embedding) -> None:
        """Set or clear the stored face embedding (a plain list of floats)."""
        value = None if embedding is None else [float(x) for x in embedding]
        await self.db.users.update_one({"_id": user_id}, {"$set": {"face_embedding": value}})

    async def log_audit(
        self,
        user_id: Optional[int],
        action: str,
        ip_address: str,
        user_agent: str,
        status: str,
    ) -> None:
        await self.db.audit_logs.insert_one({
            "_id": await next_id(self.db, "audit_logs"),
            "user_id": user_id,
            "action": action,
            "ip_address": ip_address[:50] if ip_address else None,
            "user_agent": user_agent,
            "status": status,
            "created_at": datetime.now(timezone.utc),
        })

    # ── User management ───────────────────────────────────────────────────────

    async def list_with_filters(
        self,
        search: Optional[str],
        role: Optional[str],
        site_id: Optional[int],
        skip: int,
        limit: int,
    ) -> tuple[list[User], int]:
        """Return (page_of_users, total_count) matching the given filters."""
        query: dict = {}
        if search:
            pattern = {"$regex": re.escape(search), "$options": "i"}
            query["$or"] = [{"name": pattern}, {"employee_id": pattern}, {"email": pattern}]
        if role:
            query["role"] = role
        if site_id is not None:
            query["site_id"] = site_id

        total = await self.db.users.count_documents(query)
        cursor = self.db.users.find(query).sort("_id", 1).skip(skip).limit(limit)
        users = [User.from_doc(d) async for d in cursor]
        await attach_user_sites(self.db, users)
        return users, total

    async def create_user(
        self,
        employee_id: str,
        name: str,
        email: str,
        password_hash: str,
        role: str,
        site_id: Optional[int],
        supervisor_id: Optional[int],
    ) -> User:
        user_id = await next_id(self.db, "users")
        await self.db.users.insert_one({
            "_id": user_id,
            "employee_id": employee_id,
            "name": name,
            "email": email,
            "password_hash": password_hash,
            "role": role,
            "site_id": site_id,
            "supervisor_id": supervisor_id,
            "face_embedding": None,
            "is_active": True,
            "failed_login_attempts": 0,
            "locked_until": None,
            "password_changed_at": None,
            "created_at": datetime.now(timezone.utc),
        })
        return await self.get_by_id(user_id)

    async def update(self, user_id: int, fields: dict) -> None:
        if fields:
            await self.db.users.update_one({"_id": user_id}, {"$set": fields})

    async def delete_cascade(self, user_id: int) -> None:
        """Delete a user and what belongs to them, in one transaction.

        Mirrors the old foreign keys: the user's attendance (and its overtime),
        leave, assignments and failed attempts go with them; references from
        other people's records (supervisor, reviewer, approver, creator) are
        cleared instead.
        """
        db = self.db

        async def run(session):
            att_ids = [
                d["_id"] async for d in db.attendance.find({"user_id": user_id}, {"_id": 1}, session=session)
            ]
            await db.overtime_requests.delete_many(
                {"$or": [{"user_id": user_id}, {"attendance_id": {"$in": att_ids}}]}, session=session
            )
            for name in ("attendance", "leave_requests", "temporary_assignments", "checkin_attempts"):
                await db[name].delete_many({"user_id": user_id}, session=session)
            await db.users.update_many(
                {"supervisor_id": user_id}, {"$set": {"supervisor_id": None}}, session=session
            )
            for name, ref in (
                ("audit_logs", "user_id"),
                ("attendance", "reviewed_by"),
                ("leave_requests", "reviewed_by"),
                ("overtime_requests", "approved_by"),
                ("temporary_assignments", "created_by"),
            ):
                await db[name].update_many({ref: user_id}, {"$set": {ref: None}}, session=session)
            await db.users.delete_one({"_id": user_id}, session=session)

        await in_transaction(run)
