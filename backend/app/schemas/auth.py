
from pydantic import BaseModel, field_validator

from app.core.security import validate_new_password


class LoginRequest(BaseModel):
    """Accept email OR employee_id in the `identifier` field."""

    identifier: str  # email or employee_id
    password: str

    @field_validator("identifier")
    @classmethod
    def identifier_not_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Identifier cannot be empty")
        return v.strip()

    @field_validator("password")
    @classmethod
    def password_not_empty(cls, v: str) -> str:
        if not v:
            raise ValueError("Password cannot be empty")
        return v


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

    @field_validator("current_password")
    @classmethod
    def current_password_not_empty(cls, v: str) -> str:
        if not v:
            raise ValueError("Current password cannot be empty")
        return v

    @field_validator("new_password")
    @classmethod
    def min_length(cls, v: str) -> str:
        return validate_new_password(v)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class UserInfo(BaseModel):
    id: int
    employee_id: str
    name: str
    email: str
    role: str
    site_id: int | None = None
    site_name: str | None = None
    site_timezone: str | None = None
    is_active: bool

    model_config = {"from_attributes": True}
