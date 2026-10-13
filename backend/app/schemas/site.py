from datetime import datetime
from typing import Optional

from pydantic import BaseModel, field_validator


_VALID_TIMEZONES = {"Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"}


class SiteCreate(BaseModel):
    name: str
    latitude: float
    longitude: float
    radius_meter: int
    timezone: str = "Asia/Jakarta"

    @field_validator("name")
    @classmethod
    def name_not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Name cannot be empty")
        return v

    @field_validator("latitude")
    @classmethod
    def valid_lat(cls, v: float) -> float:
        if not (-90 <= v <= 90):
            raise ValueError("Latitude must be between -90 and 90")
        return v

    @field_validator("longitude")
    @classmethod
    def valid_lon(cls, v: float) -> float:
        if not (-180 <= v <= 180):
            raise ValueError("Longitude must be between -180 and 180")
        return v

    @field_validator("radius_meter")
    @classmethod
    def valid_radius(cls, v: int) -> int:
        if v <= 0:
            raise ValueError("Radius must be greater than 0")
        return v

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, v: str) -> str:
        if v not in _VALID_TIMEZONES:
            raise ValueError(f"timezone must be one of: {', '.join(sorted(_VALID_TIMEZONES))}")
        return v


class SiteUpdate(BaseModel):
    name: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    radius_meter: Optional[int] = None
    timezone: Optional[str] = None

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_TIMEZONES:
            raise ValueError(f"timezone must be one of: {', '.join(sorted(_VALID_TIMEZONES))}")
        return v


class SiteResponse(BaseModel):
    id: int
    name: str
    latitude: float
    longitude: float
    radius_meter: int
    timezone: str = "Asia/Jakarta"
    created_at: Optional[datetime] = None

    model_config = {"from_attributes": True}
