-- migration_overtime_v2.sql
-- Adds user_id and notes columns to overtime_requests to support
-- standalone overtime requests (not tied to an existing attendance record).
--
-- Run on any database initialized before this migration:
--   docker exec hadirops_backend psql $DATABASE_URL -f migration_overtime_v2.sql

CREATE SCHEMA IF NOT EXISTS hadirops;
SET search_path TO hadirops, public;

ALTER TABLE overtime_requests ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users(id);
ALTER TABLE overtime_requests ADD COLUMN IF NOT EXISTS notes VARCHAR(500);

-- Backfill user_id from attendance records for existing rows
UPDATE overtime_requests or2
SET user_id = a.user_id
FROM attendance a
WHERE or2.attendance_id = a.id
  AND or2.user_id IS NULL;
