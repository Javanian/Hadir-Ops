from datetime import date, datetime, time
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator


class UserMinimal(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:          int
    employee_id: str
    full_name:   str = Field(validation_alias="name")


class SiteMinimal(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:       int
    name:     str
    timezone: str


class ShiftMinimal(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:         int
    name:       str
    start_time: time
    end_time:   time


# ── Request ───────────────────────────────────────────────────────────────────

class AssignmentCreate(BaseModel):
    user_id:    int
    site_id:    int
    shift_id:   int
    start_date: date
    end_date:   date
    notes:      Optional[str] = None

    @model_validator(mode="after")
    def validate_dates(self) -> "AssignmentCreate":
        if self.end_date < self.start_date:
            raise ValueError("end_date harus >= start_date")
        return self


# ── Response ──────────────────────────────────────────────────────────────────

class AssignmentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id:         int
    user_id:    int
    site_id:    int
    shift_id:   int
    start_date: date
    end_date:   date
    notes:      Optional[str]
    created_by: Optional[int]
    created_at: datetime

    user:    UserMinimal
    site:    SiteMinimal
    shift:   ShiftMinimal
    creator: Optional[UserMinimal]
