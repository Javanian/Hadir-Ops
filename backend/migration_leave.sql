-- Leave requests (sick, permit, annual leave). Idempotent: safe to run twice.
--   docker compose exec -T db psql -U hadirops -d hadirops < backend/migration_leave.sql
SET search_path TO hadirops, public;

CREATE TABLE IF NOT EXISTS leave_requests (
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

CREATE INDEX IF NOT EXISTS idx_leave_user_dates ON leave_requests (user_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_leave_pending ON leave_requests (created_at) WHERE status = 'PENDING';
