from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field, field_validator


class CheckinRequest(BaseModel):
    latitude: float = Field(..., ge=-90, le=90, description="User's GPS latitude")
    longitude: float = Field(..., ge=-180, le=180, description="User's GPS longitude")


class CheckoutRequest(BaseModel):
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
        )


class AutoCheckoutResult(BaseModel):
    processed: int
    message: str
