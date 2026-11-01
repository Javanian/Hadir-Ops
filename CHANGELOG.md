# Changelog

Notable changes per release. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/). A `vX.Y.Z` tag publishes the images and the GitHub release from the matching section below.

## [Unreleased]

## [2.0.0] - 2026-11-01

The project is now **Rollproof** (it was HadirOps), built for teams in any country.

### Added

- English user interface by default, with Indonesian, on the web dashboard and the mobile app. The browser or phone language picks the default and a switcher saves the choice. Dates, durations, month and weekday names follow the language; the iOS permission prompts are localized.
- Public demo mode (`DEMO_MODE=true`, or `docker-compose.demo.yml`): one-click sign-in as admin or supervisor, a fresh employee account per visitor, and every record, enrolled faces included, replaced with a fictional sample company every day at 00:00 UTC. The shared demo accounts cannot be edited, deleted or given a new password.
- The mobile app built for browsers and served at `/app` next to the dashboard, for employees without the native app and for the demo.
- Sites take any IANA time zone instead of the three Indonesian ones.
- `seed.py` seeds the same sample company as the demo, with sites in Rotterdam, Jakarta, Houston, Singapore and a UTC field office.
- Releases: images on `ghcr.io` with SLSA provenance, an SBOM and GitHub artifact attestations, and the API reference published to GitHub Pages from the code.
- Optional error reporting to Sentry (`SENTRY_DSN`), with no request bodies or personal data.
- `GET /health/ready` reports the version and whether the server is a demo.
- SECURITY.md, PRIVACY.md and a deployment guide (docs/DEPLOY.md).

### Changed

- Face recognition uses OpenCV YuNet (MIT) and SFace (Apache 2.0) instead of InsightFace, whose pretrained models are for non-commercial research only. Model files are pinned by URL and SHA-256 and ship in the image.
- Python 3.14, React 19, Vite 8, Expo SDK 58 and every other dependency at its current release, with no deprecated APIs.
- The production stack: Caddy with automatic HTTPS in front of the dashboard, the API and the mobile web build; MongoDB with authentication; nightly backups.
- Remaining Indonesian API error messages are in English.

### Fixed

- The mobile password change shows "same password" and "wrong current password" again; it read the error code from the wrong field.

### Breaking

- Default database, database user, containers and images are named `rollproof`. Keep an existing database by setting `DB_NAME=hadirops` and `DB_USER=hadirops` in `.env`.
- The mobile app identifier is `app.rollproof.mobile`; it is a new app in the stores, and users sign in once more.
- Face embeddings made with InsightFace cannot be compared with SFace. Those users are asked to enrol again (`reregister_required`, verification answers 409). `FACE_SIMILARITY_THRESHOLD` is now `FACE_MATCH_THRESHOLD` (default 0.363).
- `seed_recent.py` is gone; `seed.py` generates recent attendance itself.
- The web image is built with the mobile app as a second build context (`docker build --build-context mobile=../mobile web`).

## [1.1.0] - 2026-10-15

### Added

- Durable check-in: client event ids make retries safe, unique indexes settle races, and risk flags (mock location, weak GPS, unverified face, phone clock mismatch) send a record to review instead of refusing it.
- Offline outbox in the mobile app for check-in and check-out, delivered with the original time when the signal returns.
- Supervisor review queue and a list of failed attempts in the dashboard.
- Sick, permit and annual leave requests with approval.
- Attendance recap per employee with CSV export.

### Changed

- Data layer moved from PostgreSQL to MongoDB (replica set, transactions, validators); `scripts/migrate_from_postgres.py` copies an existing install.
- Pages of the dashboard load on first visit.

### Fixed

- Tokens are invalidated on a password change, and a locked account answers 403 on every attempt.
- Object-level access rules are enforced in one place.
- The dashboard uses the local calendar date instead of the UTC date.

## [1.0.0] - 2026-10-13

First version, as HadirOps: face-verified check-in with GPS geofence, shifts and schedules per site, temporary assignments, overtime requests, holidays, reports, and role-based access for admins, supervisors and employees.

[Unreleased]: https://github.com/Javanian/rollproof/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/Javanian/rollproof/releases/tag/v2.0.0
[1.1.0]: https://github.com/Javanian/rollproof/commits/main
[1.0.0]: https://github.com/Javanian/rollproof/commits/main
