"""
Batched loading of related documents.

Each helper takes a list of documents, collects the ids they point to and
fetches every referenced collection once with `$in` (no per-row queries),
then attaches the results as attributes (`att.site`, `req.submitter`, ...).
"""

from typing import Dict, Iterable, List, Optional

from pymongo.asynchronous.database import AsyncDatabase

from app.db.documents import (
    Attendance,
    CheckinAttempt,
    LeaveRequest,
    OvertimeRequest,
    Shift,
    Site,
    TemporaryAssignment,
    User,
)


def _ids(values: Iterable[Optional[int]]) -> List[int]:
    return sorted({v for v in values if v is not None})


async def sites_by_id(db: AsyncDatabase, ids: Iterable[Optional[int]]) -> Dict[int, Site]:
    wanted = _ids(ids)
    if not wanted:
        return {}
    return {d["_id"]: Site.from_doc(d) async for d in db.sites.find({"_id": {"$in": wanted}})}


async def shifts_by_id(db: AsyncDatabase, ids: Iterable[Optional[int]]) -> Dict[int, Shift]:
    wanted = _ids(ids)
    if not wanted:
        return {}
    return {d["_id"]: Shift.from_doc(d) async for d in db.shifts.find({"_id": {"$in": wanted}})}


async def users_by_id(
    db: AsyncDatabase, ids: Iterable[Optional[int]], with_site: bool = False
) -> Dict[int, User]:
    wanted = _ids(ids)
    if not wanted:
        return {}
    users = {d["_id"]: User.from_doc(d) async for d in db.users.find({"_id": {"$in": wanted}})}
    if with_site:
        await attach_user_sites(db, users.values())
    return users


async def attach_user_sites(db: AsyncDatabase, users: Iterable[User]) -> None:
    users = list(users)
    sites = await sites_by_id(db, (u.site_id for u in users))
    for u in users:
        u.site = sites.get(u.site_id)


async def attach_attendance(
    db: AsyncDatabase, records: List[Attendance], with_overtime: bool = True
) -> List[Attendance]:
    if not records:
        return records
    users = await users_by_id(db, (r.user_id for r in records))
    sites = await sites_by_id(db, (r.site_id for r in records))
    shifts = await shifts_by_id(db, (r.shift_id for r in records))
    overtime: Dict[int, List[OvertimeRequest]] = {}
    if with_overtime:
        async for d in db.overtime_requests.find({"attendance_id": {"$in": [r.id for r in records]}}):
            overtime.setdefault(d["attendance_id"], []).append(OvertimeRequest.from_doc(d))
    for r in records:
        r.user = users.get(r.user_id)
        r.site = sites.get(r.site_id)
        r.shift = shifts.get(r.shift_id)
        r.overtime_requests = overtime.get(r.id, [])
    return records


async def attach_overtime(db: AsyncDatabase, requests: List[OvertimeRequest]) -> List[OvertimeRequest]:
    if not requests:
        return requests
    users = await users_by_id(db, [r.user_id for r in requests] + [r.approved_by for r in requests])
    att_ids = _ids(r.attendance_id for r in requests)
    attendance = {}
    if att_ids:
        attendance = {
            d["_id"]: Attendance.from_doc(d)
            async for d in db.attendance.find({"_id": {"$in": att_ids}})
        }
    for r in requests:
        r.submitter = users.get(r.user_id)
        r.approver = users.get(r.approved_by)
        r.attendance = attendance.get(r.attendance_id)
    return requests


async def attach_leave(db: AsyncDatabase, leaves: List[LeaveRequest]) -> List[LeaveRequest]:
    users = await users_by_id(db, [x.user_id for x in leaves] + [x.reviewed_by for x in leaves])
    for x in leaves:
        x.user = users.get(x.user_id)
        x.reviewer = users.get(x.reviewed_by)
    return leaves


async def attach_assignments(
    db: AsyncDatabase, items: List[TemporaryAssignment]
) -> List[TemporaryAssignment]:
    users = await users_by_id(db, [a.user_id for a in items] + [a.created_by for a in items])
    sites = await sites_by_id(db, (a.site_id for a in items))
    shifts = await shifts_by_id(db, (a.shift_id for a in items))
    for a in items:
        a.user = users.get(a.user_id)
        a.creator = users.get(a.created_by)
        a.site = sites.get(a.site_id)
        a.shift = shifts.get(a.shift_id)
    return items


async def attach_attempts(db: AsyncDatabase, items: List[CheckinAttempt]) -> List[CheckinAttempt]:
    users = await users_by_id(db, (a.user_id for a in items), with_site=True)
    for a in items:
        a.user = users.get(a.user_id)
    return items
