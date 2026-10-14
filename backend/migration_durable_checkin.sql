-- migration_durable_checkin.sql: offline-safe, idempotent check-in with review queue
-- Safe to run multiple times. Run after migration_tz.sql on databases created
-- before this change. database.sql already contains these objects.
--
-- What this does:
--   1. Adds device event, GPS accuracy, risk flag and review columns to attendance
--   2. Backfills attendance.work_date (site-local date) and enforces one check-in
--      per user per work date in the database, closing the double-submit race
--   3. Creates checkin_attempts, where the app reports check-ins it could not complete

CREATE SCHEMA IF NOT EXISTS hadirops;
SET search_path TO hadirops, public;

-- Step 1: new attendance columns
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS work_date DATE;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS client_event_id VARCHAR(64);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS checkout_event_id VARCHAR(64);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS captured_at TIMESTAMPTZ;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS gps_accuracy_m DOUBLE PRECISION;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS is_offline BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS face_similarity DOUBLE PRECISION;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS risk_flags VARCHAR(40)[] NOT NULL DEFAULT '{}';
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS review_status VARCHAR(20);
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS reviewed_by INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE attendance ADD COLUMN IF NOT EXISTS review_note VARCHAR(500);

-- Step 2: backfill work_date for the first check-in of each user per site-local day.
-- Older duplicates (possible before this migration) keep work_date NULL so the
-- unique index below can be created without deleting data.
WITH ranked AS (
    SELECT a.id,
           (a.checkin_time AT TIME ZONE COALESCE(s.timezone, 'Asia/Jakarta'))::date AS local_date,
           ROW_NUMBER() OVER (
               PARTITION BY a.user_id,
                            (a.checkin_time AT TIME ZONE COALESCE(s.timezone, 'Asia/Jakarta'))::date
               ORDER BY a.checkin_time, a.id
           ) AS rn
    FROM attendance a
    LEFT JOIN sites s ON s.id = a.site_id
    WHERE a.work_date IS NULL
)
UPDATE attendance a
SET work_date = ranked.local_date
FROM ranked
WHERE a.id = ranked.id
  AND ranked.rn = 1
  AND NOT EXISTS (
      SELECT 1 FROM attendance b
      WHERE b.user_id = a.user_id AND b.work_date = ranked.local_date
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_user_work_date
    ON attendance (user_id, work_date) WHERE work_date IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_client_event
    ON attendance (client_event_id) WHERE client_event_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_attendance_checkout_event
    ON attendance (checkout_event_id) WHERE checkout_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_needs_review
    ON attendance (checkin_time DESC) WHERE needs_review;
CREATE INDEX IF NOT EXISTS idx_attendance_open
    ON attendance (user_id) WHERE checkout_time IS NULL;

-- Step 3: failed attempts reported by the app
CREATE TABLE IF NOT EXISTS checkin_attempts (
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
CREATE INDEX IF NOT EXISTS idx_checkin_attempts_user_time
    ON checkin_attempts (user_id, captured_at DESC);
