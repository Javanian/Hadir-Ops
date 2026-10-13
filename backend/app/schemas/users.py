from typing import List, Optional

from pydantic import BaseModel, field_validator

_VALID_ROLES = {"ADMIN", "SUPERVISOR", "EMPLOYEE"}


# ── Response ──────────────────────────────────────────────────────────────────

class UserListItem(BaseModel):
    """Returned by list, create, update, and get-by-id endpoints."""
    id: int
    employee_id: str
    name: str
    email: str
    role: str
    site_id: Optional[int] = None
    site_name: Optional[str] = None
    site_timezone: Optional[str] = None
    supervisor_id: Optional[int] = None
    is_active: bool
    has_face: bool
    is_locked: bool

    # Not using from_attributes — built manually in the service layer
    model_config = {"from_attributes": False}


class UserListResponse(BaseModel):
    items: List[UserListItem]
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
    site_id: Optional[int] = None
    supervisor_id: Optional[int] = None

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
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

    @field_validator("role")
    @classmethod
    def valid_role(cls, v: str) -> str:
        if v not in _VALID_ROLES:
            raise ValueError(f"role must be one of: {', '.join(sorted(_VALID_ROLES))}")
        return v


class UserUpdateRequest(BaseModel):
    """All fields optional — only explicitly set fields are applied."""
    name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    site_id: Optional[int] = None
    supervisor_id: Optional[int] = None
    is_active: Optional[bool] = None
    password: Optional[str] = None  # password reset

    @field_validator("role")
    @classmethod
    def valid_role(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v not in _VALID_ROLES:
            raise ValueError(f"role must be one of: {', '.join(sorted(_VALID_ROLES))}")
        return v

    @field_validator("password")
    @classmethod
    def min_password(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v
