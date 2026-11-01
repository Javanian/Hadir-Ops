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
from typing import Any, Optional

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


def _date(value: Any) -> date | None:
    return date.fromisoformat(value) if isinstance(value, str) else value


def _time(value: Any) -> time | None:
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
    created_at: datetime | None = None

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
    site_id: int | None = None
    face_embedding: list[float] | None = None
    face_model: str | None = None  # the model that made face_embedding
    is_active: bool = True
    failed_login_attempts: int = 0
    locked_until: datetime | None = None
    supervisor_id: int | None = None
    password_changed_at: datetime | None = None
    created_at: datetime | None = None
    site: Site | None = None

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
    name: str | None
    start_time: time
    end_time: time
    is_cross_midnight: bool = False
    work_hours_standard: int = 8
    created_at: datetime | None = None
    work_schedules: list[WorkSchedule] = field(default_factory=list)

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
    description: str | None = None
    is_national: bool = True

    @classmethod
    def from_doc(cls, doc: dict) -> "Holiday":
        return _build(cls, doc, holiday_date=_date(doc["holiday_date"]))


@dataclass
class OvertimeRequest:
    id: int
    user_id: int | None
    requested_start: datetime
    requested_end: datetime
    attendance_id: int | None = None
    approved_by: int | None = None
    status: str = "PENDING"
    notes: str | None = None
    supervisor_notes: str | None = None
    created_at: datetime | None = None
    attendance: Optional["Attendance"] = None
    submitter: User | None = None
    approver: User | None = None

    @classmethod
    def from_doc(cls, doc: dict) -> "OvertimeRequest":
        return _build(cls, doc)


@dataclass
class Attendance:
    id: int
    user_id: int
    checkin_time: datetime
    site_id: int | None = None
    shift_id: int | None = None
    checkout_time: datetime | None = None
    auto_checkout: bool = False
    latitude: float | None = None
    longitude: float | None = None
    work_duration_minutes: int = 0
    overtime_minutes: int = 0
    is_weekend: bool = False
    is_holiday: bool = False
    status: str | None = None
    created_at: datetime | None = None
    work_date: date | None = None
    client_event_id: str | None = None
    checkout_event_id: str | None = None
    captured_at: datetime | None = None
    received_at: datetime | None = None
    gps_accuracy_m: float | None = None
    is_offline: bool = False
    face_similarity: float | None = None
    risk_flags: list[str] = field(default_factory=list)
    needs_review: bool = False
    review_status: str | None = None
    reviewed_by: int | None = None
    reviewed_at: datetime | None = None
    review_note: str | None = None
    user: User | None = None
    site: Site | None = None
    shift: Shift | None = None
    overtime_requests: list[OvertimeRequest] = field(default_factory=list)

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
    reviewed_by: int | None = None
    reviewed_at: datetime | None = None
    review_note: str | None = None
    created_at: datetime | None = None
    user: User | None = None
    reviewer: User | None = None

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
    notes: str | None = None
    created_by: int | None = None
    created_at: datetime | None = None
    user: User | None = None
    site: Site | None = None
    shift: Shift | None = None
    creator: User | None = None

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
    detail: str | None = None
    received_at: datetime | None = None
    latitude: float | None = None
    longitude: float | None = None
    gps_accuracy_m: float | None = None
    app_version: str | None = None
    user: User | None = None

    @classmethod
    def from_doc(cls, doc: dict) -> "CheckinAttempt":
        return _build(cls, doc)
