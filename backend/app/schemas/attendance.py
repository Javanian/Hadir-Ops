from datetime import datetime
from typing import List, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class _DeviceEvent(BaseModel):
    """Fields shared by check-in and check-out sent from the mobile app.

    All are optional so older clients keep working; without them the event is
    treated as happening when the server receives it.
    """

    client_event_id: Optional[UUID] = Field(
        None, description="Device-generated UUID. Resending the same id returns the same record."
    )
    captured_at: Optional[datetime] = Field(
        None, description="Device wall-clock time when the user pressed the button (ISO 8601, with offset)"
    )
    capture_age_ms: Optional[int] = Field(
        None, ge=0, le=7 * 24 * 3600 * 1000,
        description="Milliseconds since capture, from the device's monotonic clock at send time",
    )
    accuracy_m: Optional[float] = Field(None, ge=0, le=100_000, description="GPS accuracy radius in metres")
    is_mocked: Optional[bool] = Field(None, description="OS reported a mock location provider")
    face_token: Optional[str] = Field(None, max_length=2000, description="Token from POST /face/verify")

    @field_validator("captured_at")
    @classmethod
    def _require_offset(cls, v: Optional[datetime]) -> Optional[datetime]:
        if v is not None and v.tzinfo is None:
            raise ValueError("captured_at must include a UTC offset")
        return v


class CheckinRequest(_DeviceEvent):
    latitude: float = Field(..., ge=-90, le=90, description="User's GPS latitude")
    longitude: float = Field(..., ge=-180, le=180, description="User's GPS longitude")


class CheckoutRequest(_DeviceEvent):
    # Location at checkout is optional (device may not resend GPS)
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)


class AttendanceResponse(BaseModel):
    id: int
    user_id: int
    site_id: Optional[int]
    shift_id: Optional[int]
    checkin_time: datetime
    checkout_time: Optional[datetime]
    auto_checkout: bool
    latitude: Optional[float]
    longitude: Optional[float]
    work_duration_minutes: int
    overtime_minutes: int
    is_weekend: bool
    is_holiday: bool
    status: Optional[str]
    created_at: datetime
    site_timezone: str = "Asia/Jakarta"
    # Populated from linked overtime_requests (latest non-REJECTED, or latest overall)
    overtime_request_id: Optional[int] = None
    overtime_request_status: Optional[str] = None
    # Durable check-in
    client_event_id: Optional[str] = None
    captured_at: Optional[datetime] = None
    received_at: Optional[datetime] = None
    gps_accuracy_m: Optional[float] = None
    is_offline: bool = False
    face_similarity: Optional[float] = None
    risk_flags: List[str] = []
    needs_review: bool = False
    review_status: Optional[str] = None
    review_note: Optional[str] = None

    model_config = {"from_attributes": True}


class TeamAttendanceRecord(BaseModel):
    id: int
    user_id: int
    employee_id: str
    employee_name: str
    site_name: Optional[str]
    checkin_time: datetime
    checkout_time: Optional[datetime]
    work_duration_minutes: int
    overtime_minutes: int
    is_weekend: bool
    is_holiday: bool
    status: Optional[str]
    created_at: datetime
    site_timezone: str = "Asia/Jakarta"
    is_offline: bool = False
    risk_flags: List[str] = []
    needs_review: bool = False
    review_status: Optional[str] = None
    gps_accuracy_m: Optional[float] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    received_at: Optional[datetime] = None

    model_config = {"from_attributes": True}

    @classmethod
    def from_attendance(cls, att: object) -> "TeamAttendanceRecord":
        return cls(
            id=att.id,
            user_id=att.user_id,
            employee_id=att.user.employee_id,
            employee_name=att.user.name,
            site_name=att.site.name if att.site else None,
            checkin_time=att.checkin_time,
            checkout_time=att.checkout_time,
            work_duration_minutes=att.work_duration_minutes,
            overtime_minutes=att.overtime_minutes,
            is_weekend=att.is_weekend,
            is_holiday=att.is_holiday,
            status=att.status,
            created_at=att.created_at,
            site_timezone=att.site.timezone if att.site else "Asia/Jakarta",
            is_offline=bool(att.is_offline),
            risk_flags=list(att.risk_flags or []),
            needs_review=bool(att.needs_review),
            review_status=att.review_status,
            gps_accuracy_m=att.gps_accuracy_m,
            latitude=att.latitude,
            longitude=att.longitude,
            received_at=att.received_at,
        )


class AutoCheckoutResult(BaseModel):
    processed: int
    message: str


# ── Failed attempts ────────────────────────────────────────────────────────────

AttemptReason = Literal[
    "NO_GPS",            # location permission denied or no fix
    "FACE_MISMATCH",     # face not recognised
    "FACE_ERROR",        # camera or face service failed
    "NETWORK",           # could not reach the server
    "SERVER_ERROR",      # server answered 5xx
    "REJECTED",          # server refused (no shift, already checked in, too old ...)
    "OTHER",
]


class AttemptIn(BaseModel):
    client_event_id: UUID
    kind: Literal["CHECKIN", "CHECKOUT"]
    reason: AttemptReason
    detail: Optional[str] = Field(None, max_length=500)
    captured_at: datetime
    latitude: Optional[float] = Field(None, ge=-90, le=90)
    longitude: Optional[float] = Field(None, ge=-180, le=180)
    accuracy_m: Optional[float] = Field(None, ge=0, le=100_000)
    app_version: Optional[str] = Field(None, max_length=30)

    @field_validator("captured_at")
    @classmethod
    def _require_offset(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("captured_at must include a UTC offset")
        return v


class AttemptBatch(BaseModel):
    attempts: List[AttemptIn] = Field(..., min_length=1, max_length=100)


class AttemptBatchResult(BaseModel):
    accepted: int
    duplicates: int


class AttemptOut(BaseModel):
    id: int
    user_id: int
    employee_id: str
    employee_name: str
    kind: str
    reason: str
    detail: Optional[str]
    captured_at: datetime
    received_at: Optional[datetime]
    latitude: Optional[float]
    longitude: Optional[float]
    gps_accuracy_m: Optional[float]
    app_version: Optional[str]
    site_timezone: str = "Asia/Jakarta"


# ── Review queue ───────────────────────────────────────────────────────────────

class ReviewDecision(BaseModel):
    decision: Literal["APPROVED", "REJECTED"]
    note: Optional[str] = Field(None, max_length=500)

    @field_validator("note")
    @classmethod
    def _strip(cls, v: Optional[str]) -> Optional[str]:
        return v.strip() or None if v is not None else None
