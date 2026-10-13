-- Phase F6: Supervisor–Employee Hierarchy
-- Run this on existing databases that were initialized before Phase F6.
-- Safe to run multiple times (uses IF NOT EXISTS / IF EXISTS guards).

CREATE SCHEMA IF NOT EXISTS hadirops;
SET search_path TO hadirops, public;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS supervisor_id INT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_users_supervisor ON users(supervisor_id);
