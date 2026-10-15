"""
Document shapes for every MongoDB collection.

Each class mirrors one collection. `from_doc` turns a stored document into an
object with plain attributes, so services and Pydantic schemas
(`from_attributes=True`) read it the same way they read the old ORM rows.
Related objects (`att.site`, `att.shift`, `req.submitter` ...) are filled in by
`app.db.relations`, never by lazy loading.

Storage conventions:
  - `_id` is an integer from the `counters` collection; the API keeps numeric ids.
  - Calendar dates (work_date, holiday_date, start_date, end_date) are stored as
    "YYYY-MM-DD" strings: they sort and compare correctly as text and carry no
    timezone to misread.
  - Shift times are stored as "HH:MM:SS" strings.
  - Instants are BSON dates in UTC; the client returns them timezone-aware.
"""

from dataclasses import dataclass, field, fields
from datetime import date, datetime, time
from typing import Any, List, Optional

ROLES = ("ADMIN", "SUPERVISOR", "EMPLOYEE", "SALES")


# ── Encoding helpers ───────────────────────────────────────────────────────────

def encode(value: Any) -> Any:
    """Python value → what MongoDB stores (dates and times become ISO strings)."""
    if isinstance(value, datetime):
        return value
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, time):
        return value.replace(microsecond=0).isoformat()
    if isinstance(value, dict):
        return {k: encode(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [encode(v) for v in value]
    return value


def _date(value: Any) -> Optional[date]:
    return date.fromisoformat(value) if isinstance(value, str) else value


def _time(value: Any) -> Optional[time]:
    return time.fromisoformat(value) if isinstance(value, str) else value


def _build(cls, doc: dict, **extra):
    names = {f.name for f in fields(cls)}
    values = {k: v for k, v in doc.items() if k in names}
    if "_id" in doc:
        values["id"] = doc["_id"]
    values.update(extra)
    return cls(**values)


# ── Documents ──────────────────────────────────────────────────────────────────

@dataclass
class Role:
    name: str


@dataclass
class Site:
    id: int
    name: str
    latitude: float
    longitude: float
    radius_meter: int
    timezone: str = "Asia/Jakarta"
    created_at: Optional[datetime] = None

    @classmethod
    def from_doc(cls, doc: dict) -> "Site":
        return _build(cls, doc)


@dataclass
class User:
    id: int
    employee_id: str
    name: str
    email: str
    password_hash: str
    role: Role
    site_id: Optional[int] = None
    face_embedding: Optional[List[float]] = None
    is_active: bool = True
    failed_login_attempts: int = 0
    locked_until: Optional[datetime] = None
    supervisor_id: Optional[int] = None
    password_changed_at: Optional[datetime] = None
    created_at: Optional[datetime] = None
    site: Optional[Site] = None

    @classmethod
    def from_doc(cls, doc: dict) -> "User":
        return _build(cls, doc, role=Role(doc.get("role", "EMPLOYEE")))


@dataclass
class WorkSchedule:
    id: int
    shift_id: int
    day_of_week: int  # 0=Sunday … 6=Saturday
    toleransi_telat_menit: int = 0


@dataclass
class Shift:
    id: int
    site_id: int
    name: Optional[str]
    start_time: time
    end_time: time
    is_cross_midnight: bool = False
    work_hours_standard: int = 8
    created_at: Optional[datetime] = None
    work_schedules: List[WorkSchedule] = field(default_factory=list)

    @classmethod
    def from_doc(cls, doc: dict) -> "Shift":
        schedules = [
            WorkSchedule(
                id=ws["id"],
                shift_id=doc["_id"],
                day_of_week=ws["day_of_week"],
                toleransi_telat_menit=ws.get("toleransi_telat_menit", 0),
            )
            for ws in doc.get("work_schedules", [])
        ]
        return _build(
            cls, doc,
            start_time=_time(doc["start_time"]),
            end_time=_time(doc["end_time"]),
            work_schedules=schedules,
        )


@dataclass
class Holiday:
    id: int
    holiday_date: date
    description: Optional[str] = None
    is_national: bool = True

    @classmethod
    def from_doc(cls, doc: dict) -> "Holiday":
        return _build(cls, doc, holiday_date=_date(doc["holiday_date"]))


@dataclass
class OvertimeRequest:
    id: int
    user_id: Optional[int]
    requested_start: datetime
    requested_end: datetime
    attendance_id: Optional[int] = None
    approved_by: Optional[int] = None
    status: str = "PENDING"
    notes: Optional[str] = None
    supervisor_notes: Optional[str] = None
    created_at: Optional[datetime] = None
    attendance: Optional["Attendance"] = None
    submitter: Optional[User] = None
    approver: Optional[User] = None

    @classmethod
    def from_doc(cls, doc: dict) -> "OvertimeRequest":
        return _build(cls, doc)


@dataclass
class Attendance:
    id: int
    user_id: int
    checkin_time: datetime
    site_id: Optional[int] = None
    shift_id: Optional[int] = None
    checkout_time: Optional[datetime] = None
    auto_checkout: bool = False
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    work_duration_minutes: int = 0
    overtime_minutes: int = 0
    is_weekend: bool = False
    is_holiday: bool = False
    status: Optional[str] = None
    created_at: Optional[datetime] = None
    work_date: Optional[date] = None
    client_event_id: Optional[str] = None
    checkout_event_id: Optional[str] = None
    captured_at: Optional[datetime] = None
    received_at: Optional[datetime] = None
    gps_accuracy_m: Optional[float] = None
    is_offline: bool = False
    face_similarity: Optional[float] = None
    risk_flags: List[str] = field(default_factory=list)
    needs_review: bool = False
    review_status: Optional[str] = None
    reviewed_by: Optional[int] = None
    reviewed_at: Optional[datetime] = None
    review_note: Optional[str] = None
    user: Optional[User] = None
    site: Optional[Site] = None
    shift: Optional[Shift] = None
    overtime_requests: List[OvertimeRequest] = field(default_factory=list)

    @classmethod
    def from_doc(cls, doc: dict) -> "Attendance":
        return _build(cls, doc, work_date=_date(doc.get("work_date")))


@dataclass
class LeaveRequest:
    id: int
    user_id: int
    leave_type: str
    start_date: date
    end_date: date
    reason: str
    status: str = "PENDING"
    reviewed_by: Optional[int] = None
    reviewed_at: Optional[datetime] = None
    review_note: Optional[str] = None
    created_at: Optional[datetime] = None
    user: Optional[User] = None
    reviewer: Optional[User] = None

    @classmethod
    def from_doc(cls, doc: dict) -> "LeaveRequest":
        return _build(cls, doc, start_date=_date(doc["start_date"]), end_date=_date(doc["end_date"]))


@dataclass
class TemporaryAssignment:
    id: int
    user_id: int
    site_id: int
    shift_id: int
    start_date: date
    end_date: date
    notes: Optional[str] = None
    created_by: Optional[int] = None
    created_at: Optional[datetime] = None
    user: Optional[User] = None
    site: Optional[Site] = None
    shift: Optional[Shift] = None
    creator: Optional[User] = None

    @classmethod
    def from_doc(cls, doc: dict) -> "TemporaryAssignment":
        return _build(cls, doc, start_date=_date(doc["start_date"]), end_date=_date(doc["end_date"]))


@dataclass
class CheckinAttempt:
    id: int
    user_id: int
    client_event_id: str
    kind: str
    reason: str
    captured_at: datetime
    detail: Optional[str] = None
    received_at: Optional[datetime] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    gps_accuracy_m: Optional[float] = None
    app_version: Optional[str] = None
    user: Optional[User] = None

    @classmethod
    def from_doc(cls, doc: dict) -> "CheckinAttempt":
        return _build(cls, doc)
