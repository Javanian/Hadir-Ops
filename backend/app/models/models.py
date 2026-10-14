"""
SQLAlchemy models — strictly follow database.sql schema.
All tables, relationships, and constraints match database.sql exactly.
"""

from sqlalchemy import (
    Boolean,
    Column,
    Date,
    DateTime,
    Double,
    ForeignKey,
    Integer,
    String,
    Text,
    Time,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import relationship

try:
    from pgvector.sqlalchemy import Vector
    _HAS_PGVECTOR = True
except ImportError:
    _HAS_PGVECTOR = False

from app.core.database import Base


class Role(Base):
    __tablename__ = "roles"

    id = Column(Integer, primary_key=True)
    name = Column(String(50), unique=True, nullable=False)

    users = relationship("User", back_populates="role")


class Site(Base):
    __tablename__ = "sites"

    id = Column(Integer, primary_key=True)
    name = Column(String(100), nullable=False)
    latitude = Column(Double, nullable=False)
    longitude = Column(Double, nullable=False)
    radius_meter = Column(Integer, nullable=False)
    timezone = Column(String(50), nullable=False, default="Asia/Jakarta")
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    users = relationship("User", back_populates="site")
    shifts = relationship("Shift", back_populates="site", cascade="all, delete-orphan")


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True)
    employee_id = Column(String(50), unique=True, nullable=False)
    name = Column(String(100), nullable=False)
    email = Column(String(150), unique=True, nullable=False)
    password_hash = Column(Text, nullable=False)
    role_id = Column(Integer, ForeignKey("roles.id"))
    site_id = Column(Integer, ForeignKey("sites.id"), nullable=True)
    # face_embedding added only if pgvector is available
    face_embedding = Column(Vector(512), nullable=True) if _HAS_PGVECTOR else Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    failed_login_attempts = Column(Integer, default=0)
    locked_until = Column(DateTime(timezone=True), nullable=True)
    supervisor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    password_changed_at = Column(DateTime(timezone=True), nullable=True, default=None)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    role = relationship("Role", back_populates="users")
    site = relationship("Site", back_populates="users")
    attendance = relationship(
        "Attendance",
        back_populates="user",
        cascade="all, delete-orphan",
        foreign_keys="Attendance.user_id",
    )
    audit_logs = relationship(
        "AuditLog",
        back_populates="user",
        foreign_keys="AuditLog.user_id",
    )
    # Self-referential supervisor–subordinate hierarchy
    supervisor = relationship(
        "User",
        remote_side="User.id",
        back_populates="subordinates",
        foreign_keys="[User.supervisor_id]",
    )
    subordinates = relationship(
        "User",
        back_populates="supervisor",
        foreign_keys="[User.supervisor_id]",
    )


class Shift(Base):
    __tablename__ = "shifts"

    id = Column(Integer, primary_key=True)
    site_id = Column(Integer, ForeignKey("sites.id", ondelete="CASCADE"))
    name = Column(String(100))
    start_time = Column(Time, nullable=False)
    end_time = Column(Time, nullable=False)
    is_cross_midnight = Column(Boolean, default=False)
    work_hours_standard = Column(Integer, default=8)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    site = relationship("Site", back_populates="shifts")
    work_schedules = relationship(
        "WorkSchedule", back_populates="shift", cascade="all, delete-orphan"
    )
    attendance = relationship("Attendance", back_populates="shift")


class WorkSchedule(Base):
    __tablename__ = "work_schedules"

    id = Column(Integer, primary_key=True)
    shift_id = Column(Integer, ForeignKey("shifts.id", ondelete="CASCADE"))
    day_of_week = Column(Integer, nullable=False)  # 0=Sunday, 6=Saturday
    toleransi_telat_menit = Column(Integer, default=0)

    shift = relationship("Shift", back_populates="work_schedules")


class Holiday(Base):
    __tablename__ = "holidays"

    id = Column(Integer, primary_key=True)
    holiday_date = Column(Date, unique=True, nullable=False)
    description = Column(String(200))
    is_national = Column(Boolean, default=True)


class Attendance(Base):
    __tablename__ = "attendance"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"))
    site_id = Column(Integer, ForeignKey("sites.id"))
    shift_id = Column(Integer, ForeignKey("shifts.id"))
    checkin_time = Column(DateTime(timezone=True), nullable=False)
    checkout_time = Column(DateTime(timezone=True), nullable=True)
    auto_checkout = Column(Boolean, default=False)
    latitude = Column(Double, nullable=True)
    longitude = Column(Double, nullable=True)
    work_duration_minutes = Column(Integer, default=0)
    overtime_minutes = Column(Integer, default=0)
    is_weekend = Column(Boolean, default=False)
    is_holiday = Column(Boolean, default=False)
    status = Column(String(50), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Durable check-in (see migration_durable_checkin.sql)
    work_date = Column(Date, nullable=True)                 # site-local date, one check-in per day
    client_event_id = Column(String(64), nullable=True)     # device-generated idempotency key
    checkout_event_id = Column(String(64), nullable=True)
    captured_at = Column(DateTime(timezone=True), nullable=True)   # when the device recorded it
    received_at = Column(DateTime(timezone=True), nullable=True)   # when the server received it
    gps_accuracy_m = Column(Double, nullable=True)
    is_offline = Column(Boolean, nullable=False, default=False)
    face_similarity = Column(Double, nullable=True)
    risk_flags = Column(ARRAY(String(40)), nullable=False, default=list)
    needs_review = Column(Boolean, nullable=False, default=False)
    review_status = Column(String(20), nullable=True)       # APPROVED | REJECTED
    reviewed_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    review_note = Column(String(500), nullable=True)

    user = relationship("User", back_populates="attendance", foreign_keys=[user_id])
    reviewer = relationship("User", foreign_keys=[reviewed_by])
    site = relationship("Site")
    shift = relationship("Shift", back_populates="attendance")
    overtime_requests = relationship(
        "OvertimeRequest", back_populates="attendance", cascade="all, delete-orphan"
    )


class OvertimeRequest(Base):
    __tablename__ = "overtime_requests"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    attendance_id = Column(Integer, ForeignKey("attendance.id", ondelete="CASCADE"), nullable=True)
    requested_start = Column(DateTime(timezone=True), nullable=False)
    requested_end = Column(DateTime(timezone=True), nullable=False)
    approved_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    status = Column(String(20), default="PENDING")
    notes = Column(String(500), nullable=True)
    supervisor_notes = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    attendance = relationship("Attendance", back_populates="overtime_requests")
    submitter = relationship("User", foreign_keys=[user_id])
    approver = relationship("User", foreign_keys=[approved_by])


class TemporaryAssignment(Base):
    __tablename__ = "temporary_assignments"

    id         = Column(Integer, primary_key=True)
    user_id    = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    site_id    = Column(Integer, ForeignKey("sites.id", ondelete="CASCADE"), nullable=False)
    shift_id   = Column(Integer, ForeignKey("shifts.id", ondelete="CASCADE"), nullable=False)
    start_date = Column(Date, nullable=False)
    end_date   = Column(Date, nullable=False)
    notes      = Column(Text, nullable=True)
    created_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user    = relationship("User", foreign_keys=[user_id])
    site    = relationship("Site")
    shift   = relationship("Shift")
    creator = relationship("User", foreign_keys=[created_by])


class CheckinAttempt(Base):
    """A check-in or check-out the device tried and could not complete.

    Stored so a failure leaves evidence for the supervisor instead of an empty day.
    """

    __tablename__ = "checkin_attempts"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    client_event_id = Column(String(64), nullable=False, unique=True)
    kind = Column(String(20), nullable=False)          # CHECKIN | CHECKOUT
    reason = Column(String(40), nullable=False)        # see schemas.attendance.AttemptReason
    detail = Column(String(500), nullable=True)
    captured_at = Column(DateTime(timezone=True), nullable=False)
    received_at = Column(DateTime(timezone=True), server_default=func.now())
    latitude = Column(Double, nullable=True)
    longitude = Column(Double, nullable=True)
    gps_accuracy_m = Column(Double, nullable=True)
    app_version = Column(String(30), nullable=True)

    user = relationship("User")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    action = Column(String(100))
    ip_address = Column(String(50))
    user_agent = Column(Text)
    status = Column(String(50))
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="audit_logs", foreign_keys=[user_id])


class LeaveRequest(Base):
    __tablename__ = "leave_requests"

    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    leave_type = Column(String(20), nullable=False)  # SICK | PERMIT | ANNUAL
    start_date = Column(Date, nullable=False)
    end_date = Column(Date, nullable=False)
    reason = Column(String(500), nullable=False)
    status = Column(String(20), nullable=False, default="PENDING")
    reviewed_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reviewed_at = Column(DateTime(timezone=True), nullable=True)
    review_note = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", foreign_keys=[user_id])
    reviewer = relationship("User", foreign_keys=[reviewed_by])
