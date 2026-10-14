CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS hadirops;
SET search_path TO hadirops, public;

CREATE TABLE roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) UNIQUE NOT NULL
);

INSERT INTO roles (name) VALUES
('ADMIN'),
('SUPERVISOR'),
('EMPLOYEE'),
('SALES');

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role_id INT REFERENCES roles(id),
    site_id INT,
    face_embedding VECTOR(512),
    is_active BOOLEAN DEFAULT TRUE,
    failed_login_attempts INT DEFAULT 0,
    locked_until TIMESTAMPTZ NULL,
    supervisor_id INT REFERENCES users(id) ON DELETE SET NULL,
    password_changed_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE sites (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    radius_meter INT NOT NULL,
    timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Jakarta',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users
ADD CONSTRAINT fk_users_site
FOREIGN KEY (site_id) REFERENCES sites(id);

CREATE TABLE shifts (
    id SERIAL PRIMARY KEY,
    site_id INT REFERENCES sites(id) ON DELETE CASCADE,
    name VARCHAR(100),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    is_cross_midnight BOOLEAN DEFAULT FALSE,
    work_hours_standard INT DEFAULT 8,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE work_schedules (
    id SERIAL PRIMARY KEY,
    shift_id INT REFERENCES shifts(id) ON DELETE CASCADE,
    day_of_week INT NOT NULL, -- 0=Sunday, 6=Saturday
    toleransi_telat_menit INT DEFAULT 0
);

CREATE TABLE holidays (
    id SERIAL PRIMARY KEY,
    holiday_date DATE UNIQUE NOT NULL,
    description VARCHAR(200),
    is_national BOOLEAN DEFAULT TRUE
);

CREATE TABLE attendance (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id) ON DELETE CASCADE,
    site_id INT REFERENCES sites(id),
    shift_id INT REFERENCES shifts(id),
    checkin_time TIMESTAMPTZ NOT NULL,
    checkout_time TIMESTAMPTZ,
    auto_checkout BOOLEAN DEFAULT FALSE,
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    work_duration_minutes INT DEFAULT 0,
    overtime_minutes INT DEFAULT 0,
    is_weekend BOOLEAN DEFAULT FALSE,
    is_holiday BOOLEAN DEFAULT FALSE,
    status VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    -- Durable check-in: idempotency, device time, GPS accuracy, review queue
    work_date DATE,
    client_event_id VARCHAR(64),
    checkout_event_id VARCHAR(64),
    captured_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ,
    gps_accuracy_m DOUBLE PRECISION,
    is_offline BOOLEAN NOT NULL DEFAULT FALSE,
    face_similarity DOUBLE PRECISION,
    risk_flags VARCHAR(40)[] NOT NULL DEFAULT '{}',
    needs_review BOOLEAN NOT NULL DEFAULT FALSE,
    review_status VARCHAR(20),
    reviewed_by INT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_note VARCHAR(500)
);

-- One check-in per user per site-local work date. work_date is computed by the
-- application from the site timezone (DATE(checkin_time) would use the UTC date).
CREATE UNIQUE INDEX uq_attendance_user_work_date
    ON attendance (user_id, work_date) WHERE work_date IS NOT NULL;
CREATE UNIQUE INDEX uq_attendance_client_event
    ON attendance (client_event_id) WHERE client_event_id IS NOT NULL;
CREATE UNIQUE INDEX uq_attendance_checkout_event
    ON attendance (checkout_event_id) WHERE checkout_event_id IS NOT NULL;
CREATE INDEX idx_attendance_needs_review
    ON attendance (checkin_time DESC) WHERE needs_review;
CREATE INDEX idx_attendance_open
    ON attendance (user_id) WHERE checkout_time IS NULL;

CREATE TABLE checkin_attempts (
    id              SERIAL PRIMARY KEY,
    user_id         INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    client_event_id VARCHAR(64) NOT NULL UNIQUE,
    kind            VARCHAR(20) NOT NULL,
    reason          VARCHAR(40) NOT NULL,
    detail          VARCHAR(500),
    captured_at     TIMESTAMPTZ NOT NULL,
    received_at     TIMESTAMPTZ DEFAULT NOW(),
    latitude        DOUBLE PRECISION,
    longitude       DOUBLE PRECISION,
    gps_accuracy_m  DOUBLE PRECISION,
    app_version     VARCHAR(30)
);
CREATE INDEX idx_checkin_attempts_user_time
    ON checkin_attempts (user_id, captured_at DESC);

CREATE TABLE overtime_requests (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    attendance_id INT REFERENCES attendance(id) ON DELETE CASCADE,
    requested_start TIMESTAMPTZ NOT NULL,
    requested_end TIMESTAMPTZ NOT NULL,
    approved_by INT REFERENCES users(id),
    status VARCHAR(20) DEFAULT 'PENDING',
    notes VARCHAR(500),
    supervisor_notes VARCHAR(500),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INT REFERENCES users(id),
    action VARCHAR(100),
    ip_address VARCHAR(50),
    user_agent TEXT,
    status VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_attendance_user
ON attendance(user_id);

CREATE INDEX idx_shift_site
ON shifts(site_id);

CREATE INDEX idx_users_face_embedding
ON users
USING ivfflat (face_embedding vector_cosine_ops)
WITH (lists = 100);

CREATE INDEX idx_users_supervisor ON users(supervisor_id);

CREATE TABLE temporary_assignments (
  id              SERIAL PRIMARY KEY,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id         INTEGER NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  shift_id        INTEGER NOT NULL REFERENCES shifts(id) ON DELETE CASCADE,
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  notes           TEXT,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_date_range CHECK (end_date >= start_date)
);

CREATE INDEX idx_tmp_assign_user ON temporary_assignments(user_id);
CREATE INDEX idx_tmp_assign_date  ON temporary_assignments(start_date, end_date);

-- Leave requests (sick, permit, annual leave)
CREATE TABLE leave_requests (
    id          SERIAL PRIMARY KEY,
    user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    leave_type  VARCHAR(20) NOT NULL CHECK (leave_type IN ('SICK', 'PERMIT', 'ANNUAL')),
    start_date  DATE NOT NULL,
    end_date    DATE NOT NULL,
    reason      VARCHAR(500) NOT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'PENDING'
                CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')),
    reviewed_by INT REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_note VARCHAR(500),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_leave_date_range CHECK (end_date >= start_date)
);

CREATE INDEX idx_leave_user_dates ON leave_requests (user_id, start_date, end_date);
CREATE INDEX idx_leave_pending ON leave_requests (created_at) WHERE status = 'PENDING';
