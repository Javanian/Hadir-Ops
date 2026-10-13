from datetime import datetime
from typing import Optional

from pydantic import BaseModel, computed_field, model_validator


class OvertimeRequestCreate(BaseModel):
    attendance_id: Optional[int] = None   # Optional for standalone (future-date) overtime
    requested_start: datetime
    requested_end: datetime
    notes: Optional[str] = None

    @model_validator(mode="after")
    def validate_times(self):
        if self.requested_end <= self.requested_start:
            raise ValueError("requested_end must be after requested_start")
        return self


class ApproveBody(BaseModel):
    """Optional body for PATCH /overtime/{id}/approve.

    If approved_start / approved_end are supplied they override the original
    requested window before overtime_minutes are calculated and written to
    the attendance record.  Both must be provided together.
    """
    supervisor_notes: Optional[str] = None
    approved_start: Optional[datetime] = None
    approved_end: Optional[datetime] = None

    @model_validator(mode="after")
    def both_or_neither(self):
        has_start = self.approved_start is not None
        has_end = self.approved_end is not None
        if has_start != has_end:
            raise ValueError("approved_start and approved_end must be provided together")
        if has_start and has_end and self.approved_end <= self.approved_start:
            raise ValueError("approved_end must be after approved_start")
        return self


class RejectBody(BaseModel):
    """Optional body for PATCH /overtime/{id}/reject."""
    supervisor_notes: Optional[str] = None


class OvertimeRequestResponse(BaseModel):
    id: int
    user_id: Optional[int]
    attendance_id: Optional[int]
    requested_start: datetime
    requested_end: datetime
    approved_by: Optional[int]
    status: str          # PENDING | APPROVED | REJECTED
    notes: Optional[str]
    supervisor_notes: Optional[str]
    created_at: datetime

    # Denormalised from submitter relationship (always loaded via selectinload)
    employee_id: Optional[str] = None
    employee_name: Optional[str] = None

    @computed_field
    @property
    def requested_minutes(self) -> int:
        return max(0, int((self.requested_end - self.requested_start).total_seconds() / 60))

    model_config = {"from_attributes": True}

    @classmethod
    def model_validate(cls, obj, **kwargs):  # type: ignore[override]
        instance = super().model_validate(obj, **kwargs)
        # Populate denormalised fields from the ORM relationship when available
        submitter = getattr(obj, "submitter", None)
        if submitter is not None:
            instance.employee_id = getattr(submitter, "employee_id", None)
            instance.employee_name = getattr(submitter, "name", None)
        return instance
