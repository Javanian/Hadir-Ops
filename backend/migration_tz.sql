-- migration_tz.sql: Multi-Timezone Refactor
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS guards).
-- Run AFTER migration_f6.sql on any database initialized before the timezone refactor.
--
-- What this does:
--   1. Adds sites.timezone column (defaults to Asia/Jakarta)
--   2. Converts all TIMESTAMP columns to TIMESTAMPTZ, interpreting existing data as Asia/Jakarta
--   3. Drops the unique_daily_checkin DB index (duplicate checking moves to service layer)
--   4. Sets correct timezone for non-Jakarta sites

CREATE SCHEMA IF NOT EXISTS hadirops;
SET search_path TO hadirops, public;

-- Step 1: Add timezone column to sites
ALTER TABLE sites
  ADD COLUMN IF NOT EXISTS timezone VARCHAR(50) NOT NULL DEFAULT 'Asia/Jakarta';

-- Step 2: Convert attendance timestamps (checkout_time and created_at only).
-- NOTE: checkin_time is converted in Step 7 after the blocking index is dropped.
-- Existing naive values are assumed to be in Asia/Jakarta (WIB UTC+7).
ALTER TABLE attendance
  ALTER COLUMN checkout_time TYPE TIMESTAMPTZ
    USING checkout_time AT TIME ZONE 'Asia/Jakarta';

ALTER TABLE attendance
  ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING created_at AT TIME ZONE 'Asia/Jakarta';

-- Step 3: Convert overtime_requests timestamps
ALTER TABLE overtime_requests
  ALTER COLUMN requested_start TYPE TIMESTAMPTZ
    USING requested_start AT TIME ZONE 'Asia/Jakarta';

ALTER TABLE overtime_requests
  ALTER COLUMN requested_end TYPE TIMESTAMPTZ
    USING requested_end AT TIME ZONE 'Asia/Jakarta';

ALTER TABLE overtime_requests
  ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING created_at AT TIME ZONE 'Asia/Jakarta';

-- Step 4: Convert users timestamps
ALTER TABLE users
  ALTER COLUMN locked_until TYPE TIMESTAMPTZ
    USING locked_until AT TIME ZONE 'Asia/Jakarta';

ALTER TABLE users
  ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING created_at AT TIME ZONE 'Asia/Jakarta';

-- Step 5: Convert other table created_at columns
ALTER TABLE sites
  ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING created_at AT TIME ZONE 'Asia/Jakarta';

ALTER TABLE shifts
  ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING created_at AT TIME ZONE 'Asia/Jakarta';

ALTER TABLE audit_logs
  ALTER COLUMN created_at TYPE TIMESTAMPTZ
    USING created_at AT TIME ZONE 'Asia/Jakarta';

-- Step 6: Drop the unique_daily_checkin index BEFORE converting checkin_time.
-- The index uses DATE(checkin_time) which blocks the USING clause.
-- Duplicate check-in prevention is now enforced in attendance_service.py
-- via a UTC range query spanning the site-local calendar day.
DROP INDEX IF EXISTS unique_daily_checkin;

-- Step 7: Now convert attendance.checkin_time (index no longer blocks this).
ALTER TABLE attendance
  ALTER COLUMN checkin_time TYPE TIMESTAMPTZ
    USING checkin_time AT TIME ZONE 'Asia/Jakarta';

-- Step 8: Set correct timezone values for non-Jakarta sites
UPDATE sites SET timezone = 'Asia/Makassar' WHERE name = 'Site Makassar';
UPDATE sites SET timezone = 'Asia/Jayapura' WHERE name = 'Site Jayapura';
