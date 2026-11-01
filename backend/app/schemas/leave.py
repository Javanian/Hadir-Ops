from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field, computed_field, field_validator, model_validator

LeaveType = Literal["SICK", "PERMIT", "ANNUAL"]
LeaveStatus = Literal["PENDING", "APPROVED", "REJECTED", "CANCELLED"]

MAX_LEAVE_DAYS = 30


class LeaveRequestCreate(BaseModel):
    leave_type: LeaveType
    start_date: date
    end_date: date
    reason: str = Field(..., max_length=500)

    @field_validator("reason")
    @classmethod
    def reason_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Reason cannot be empty")
        return v

    @model_validator(mode="after")
    def validate_range(self):
        if self.end_date < self.start_date:
            raise ValueError("end_date must be on or after start_date")
        if (self.end_date - self.start_date).days + 1 > MAX_LEAVE_DAYS:
            raise ValueError(f"A single request can cover at most {MAX_LEAVE_DAYS} days")
        return self


class LeaveDecision(BaseModel):
    decision: Literal["APPROVED", "REJECTED"]
    note: str | None = Field(None, max_length=500)


class LeaveRequestResponse(BaseModel):
    id: int
    user_id: int
    leave_type: LeaveType
    start_date: date
    end_date: date
    reason: str
    status: LeaveStatus
    reviewed_by: int | None
    reviewed_at: datetime | None
    review_note: str | None
    created_at: datetime

    employee_id: str | None = None
    employee_name: str | None = None
    reviewer_name: str | None = None

    @computed_field
    @property
    def days(self) -> int:
        return (self.end_date - self.start_date).days + 1

    model_config = {"from_attributes": True}

    @classmethod
    def from_orm_obj(cls, obj) -> "LeaveRequestResponse":
        r = cls.model_validate(obj)
        if obj.user is not None:
            r.employee_id = obj.user.employee_id
            r.employee_name = obj.user.name
        if obj.reviewer is not None:
            r.reviewer_name = obj.reviewer.name
        return r
