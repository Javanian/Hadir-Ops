-- Migration: Penugasan (Temporary Site/Shift Assignment)
-- Run on existing databases:
--   docker exec presensiv2_backend psql $DATABASE_URL -f migration_penugasan.sql

CREATE SCHEMA IF NOT EXISTS hadirops;
SET search_path TO hadirops, public;

CREATE TABLE IF NOT EXISTS temporary_assignments (
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

CREATE INDEX IF NOT EXISTS idx_tmp_assign_user ON temporary_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_tmp_assign_date  ON temporary_assignments(start_date, end_date);
