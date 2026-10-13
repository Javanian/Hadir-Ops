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
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- NOTE: unique_daily_checkin index intentionally omitted.
-- Duplicate check-in prevention is enforced in the application layer
-- using a UTC range query spanning the site-local calendar day,
-- because DATE(checkin_time) returns UTC calendar date which crosses
-- midnight at a different wall-clock time than the site's local midnight.

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
