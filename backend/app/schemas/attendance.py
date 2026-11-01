from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class _DeviceEvent(BaseModel):
    """Fields shared by check-in and check-out sent from the mobile app.

    All are optional so older clients keep working; without them the event is
    treated as happening when the server receives it.
    """

    client_event_id: UUID | None = Field(
        None, description="Device-generated UUID. Resending the same id returns the same record."
    )
    captured_at: datetime | None = Field(
        None, description="Device wall-clock time when the user pressed the button (ISO 8601, with offset)"
    )
    capture_age_ms: int | None = Field(
        None, ge=0, le=7 * 24 * 3600 * 1000,
        description="Milliseconds since capture, from the device's monotonic clock at send time",
    )
    accuracy_m: float | None = Field(None, ge=0, le=100_000, description="GPS accuracy radius in metres")
    is_mocked: bool | None = Field(None, description="OS reported a mock location provider")
    face_token: str | None = Field(None, max_length=2000, description="Token from POST /face/verify")

    @field_validator("captured_at")
    @classmethod
    def _require_offset(cls, v: datetime | None) -> datetime | None:
        if v is not None and v.tzinfo is None:
            raise ValueError("captured_at must include a UTC offset")
        return v


class CheckinRequest(_DeviceEvent):
    latitude: float = Field(..., ge=-90, le=90, description="User's GPS latitude")
    longitude: float = Field(..., ge=-180, le=180, description="User's GPS longitude")


class CheckoutRequest(_DeviceEvent):
    # Location at checkout is optional (device may not resend GPS)
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)


class AttendanceResponse(BaseModel):
    id: int
    user_id: int
    site_id: int | None
    shift_id: int | None
    checkin_time: datetime
    checkout_time: datetime | None
    auto_checkout: bool
    latitude: float | None
    longitude: float | None
    work_duration_minutes: int
    overtime_minutes: int
    is_weekend: bool
    is_holiday: bool
    status: str | None
    created_at: datetime
    site_timezone: str = "Asia/Jakarta"
    # Populated from linked overtime_requests (latest non-REJECTED, or latest overall)
    overtime_request_id: int | None = None
    overtime_request_status: str | None = None
    # Durable check-in
    client_event_id: str | None = None
    captured_at: datetime | None = None
    received_at: datetime | None = None
    gps_accuracy_m: float | None = None
    is_offline: bool = False
    face_similarity: float | None = None
    risk_flags: list[str] = []
    needs_review: bool = False
    review_status: str | None = None
    review_note: str | None = None

    model_config = {"from_attributes": True}


class TeamAttendanceRecord(BaseModel):
    id: int
    user_id: int
    employee_id: str
    employee_name: str
    site_name: str | None
    checkin_time: datetime
    checkout_time: datetime | None
    work_duration_minutes: int
    overtime_minutes: int
    is_weekend: bool
    is_holiday: bool
    status: str | None
    created_at: datetime
    site_timezone: str = "Asia/Jakarta"
    is_offline: bool = False
    risk_flags: list[str] = []
    needs_review: bool = False
    review_status: str | None = None
    gps_accuracy_m: float | None = None
    latitude: float | None = None
    longitude: float | None = None
    received_at: datetime | None = None

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
    detail: str | None = Field(None, max_length=500)
    captured_at: datetime
    latitude: float | None = Field(None, ge=-90, le=90)
    longitude: float | None = Field(None, ge=-180, le=180)
    accuracy_m: float | None = Field(None, ge=0, le=100_000)
    app_version: str | None = Field(None, max_length=30)

    @field_validator("captured_at")
    @classmethod
    def _require_offset(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("captured_at must include a UTC offset")
        return v


class AttemptBatch(BaseModel):
    attempts: list[AttemptIn] = Field(..., min_length=1, max_length=100)


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
    detail: str | None
    captured_at: datetime
    received_at: datetime | None
    latitude: float | None
    longitude: float | None
    gps_accuracy_m: float | None
    app_version: str | None
    site_timezone: str = "Asia/Jakarta"


# ── Review queue ───────────────────────────────────────────────────────────────

class ReviewDecision(BaseModel):
    decision: Literal["APPROVED", "REJECTED"]
    note: str | None = Field(None, max_length=500)

    @field_validator("note")
    @classmethod
    def _strip(cls, v: str | None) -> str | None:
        return v.strip() or None if v is not None else None
