from datetime import datetime, time
from typing import List, Optional

from pydantic import BaseModel, field_validator, model_validator


class WorkScheduleCreate(BaseModel):
    day_of_week: int  # 0=Sunday … 6=Saturday
    toleransi_telat_menit: int = 0

    @field_validator("day_of_week")
    @classmethod
    def valid_day(cls, v: int) -> int:
        if not (0 <= v <= 6):
            raise ValueError("day_of_week must be 0 (Sun) – 6 (Sat)")
        return v

    @field_validator("toleransi_telat_menit")
    @classmethod
    def non_negative(cls, v: int) -> int:
        if v < 0:
            raise ValueError("toleransi_telat_menit cannot be negative")
        return v


class WorkScheduleResponse(BaseModel):
    id: int
    day_of_week: int
    toleransi_telat_menit: int

    model_config = {"from_attributes": True}


class ShiftCreate(BaseModel):
    site_id: int
    name: str
    start_time: time
    end_time: time
    is_cross_midnight: bool = False
    work_hours_standard: int = 8
    schedules: Optional[List[WorkScheduleCreate]] = None

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Shift name cannot be empty")
        return v

    @field_validator("work_hours_standard")
    @classmethod
    def valid_hours(cls, v: int) -> int:
        if not (1 <= v <= 24):
            raise ValueError("work_hours_standard must be between 1 and 24")
        return v

    @model_validator(mode="after")
    def validate_cross_midnight(self) -> "ShiftCreate":
        """Auto-detect cross midnight if end_time < start_time."""
        if self.start_time and self.end_time:
            if self.end_time < self.start_time and not self.is_cross_midnight:
                # Auto-set to cross midnight
                self.is_cross_midnight = True
        return self


class ShiftUpdate(BaseModel):
    name: Optional[str] = None
    start_time: Optional[time] = None
    end_time: Optional[time] = None
    is_cross_midnight: Optional[bool] = None
    work_hours_standard: Optional[int] = None


class ShiftResponse(BaseModel):
    id: int
    site_id: int
    name: Optional[str]
    start_time: time
    end_time: time
    is_cross_midnight: bool
    work_hours_standard: int
    created_at: Optional[datetime] = None
    schedules: List[WorkScheduleResponse] = []

    model_config = {"from_attributes": True}


class HolidayCreate(BaseModel):
    holiday_date: str  # "YYYY-MM-DD"
    description: Optional[str] = None
    is_national: bool = True

    @field_validator("holiday_date")
    @classmethod
    def valid_date_format(cls, v: str) -> str:
        from datetime import date
        try:
            date.fromisoformat(v)
        except ValueError:
            raise ValueError("holiday_date must be in YYYY-MM-DD format")
        return v


class HolidayUpdate(BaseModel):
    description: Optional[str] = None
    is_national: Optional[bool] = None


class HolidayResponse(BaseModel):
    id: int
    holiday_date: str
    description: Optional[str] = None
    is_national: bool

    model_config = {"from_attributes": True}
