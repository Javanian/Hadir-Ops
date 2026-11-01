
from pydantic import BaseModel, field_validator

from app.core.security import validate_new_password

_VALID_ROLES = {"ADMIN", "SUPERVISOR", "EMPLOYEE", "SALES"}


# ── Response ──────────────────────────────────────────────────────────────────

class UserListItem(BaseModel):
    """Returned by list, create, update, and get-by-id endpoints."""
    id: int
    employee_id: str
    name: str
    email: str
    role: str
    site_id: int | None = None
    site_name: str | None = None
    site_timezone: str | None = None
    supervisor_id: int | None = None
    is_active: bool
    has_face: bool
    is_locked: bool

    # Not using from_attributes — built manually in the service layer
    model_config = {"from_attributes": False}


class UserListResponse(BaseModel):
    items: list[UserListItem]
    total: int
    page: int
    page_size: int


# ── Requests ──────────────────────────────────────────────────────────────────

class UserCreateRequest(BaseModel):
    employee_id: str
    name: str
    email: str
    password: str
    role: str
    site_id: int | None = None
    supervisor_id: int | None = None

    @field_validator("employee_id", "name")
    @classmethod
    def not_empty(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("Field cannot be empty")
        return v

    @field_validator("email")
    @classmethod
    def valid_email(cls, v: str) -> str:
        v = v.strip().lower()
        if "@" not in v or "." not in v.split("@")[-1]:
            raise ValueError("Invalid email format")
        return v

    @field_validator("password")
    @classmethod
    def min_password(cls, v: str) -> str:
        return validate_new_password(v)

    @field_validator("role")
    @classmethod
    def valid_role(cls, v: str) -> str:
        if v not in _VALID_ROLES:
            raise ValueError(f"role must be one of: {', '.join(sorted(_VALID_ROLES))}")
        return v


class UserUpdateRequest(BaseModel):
    """All fields optional — only explicitly set fields are applied."""
    name: str | None = None
    email: str | None = None
    role: str | None = None
    site_id: int | None = None
    supervisor_id: int | None = None
    is_active: bool | None = None
    password: str | None = None  # password reset

    @field_validator("role")
    @classmethod
    def valid_role(cls, v: str | None) -> str | None:
        if v is not None and v not in _VALID_ROLES:
            raise ValueError(f"role must be one of: {', '.join(sorted(_VALID_ROLES))}")
        return v

    @field_validator("password")
    @classmethod
    def min_password(cls, v: str | None) -> str | None:
        return validate_new_password(v) if v is not None else v
