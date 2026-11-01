# HadirOps

Attendance and workforce operations for field and plant employees. Employees check in from a mobile app with face verification and GPS; supervisors and admins manage sites, shifts, assignments and overtime approvals from a web dashboard.

The system has three parts that share one API:

| Component | Stack | Used by |
| --- | --- | --- |
| [`backend/`](backend/) | Python 3.14, FastAPI, MongoDB 9.0 (PyMongo async driver, replica set), OpenCV 5 face recognition (YuNet + SFace) | Mobile app and web dashboard |
| [`web/`](web/) | React 19, React Router 8, Vite 8, TypeScript 6, Tailwind CSS 4, TanStack Query and Table 9, Leaflet | Admins and supervisors |
| [`mobile/`](mobile/) | Expo SDK 58, React Native 0.88 (new architecture), TypeScript 6 | Employees and supervisors |

Every dependency is locked with hashes (`backend/uv.lock`, the npm lockfiles), new releases are only adopted after a 7-day cooldown, and CI fails on any deprecation warning in the backend tests and on any use of a deprecated API in the web and mobile code (see [Supply chain and upgrades](#supply-chain-and-upgrades)).

## Screenshots

Web dashboard and mobile app with fictional sample data.

| Dashboard | Attendance monitoring |
| --- | --- |
| ![Dashboard with today's attendance KPIs, 7-day trend and activity table](docs/screenshots/web-dashboard.png) | ![Attendance list with check-in, check-out, duration and status per employee](docs/screenshots/web-attendance.png) |
| **User management** | **Admin login** |
| ![User list with role, site, status and face enrollment](docs/screenshots/web-users.png) | ![Admin login page](docs/screenshots/web-login.png) |
| **Review queue** | **Check-in saved offline (mobile)** |
| ![Review queue listing a check-in flagged for late upload, low GPS accuracy and a mock location, with approve and reject buttons](docs/screenshots/web-review.png) | <img src="docs/screenshots/mobile-offline.png" alt="Mobile home screen showing a check-in stored on the phone while offline, waiting for signal" width="260"> |

<img src="docs/screenshots/mobile-login.png" alt="Mobile app login screen" width="260">

## What it does

- Check-in and check-out with a selfie. The backend detects exactly one face (YuNet), extracts a 128-dimension SFace embedding and compares it with the enrolled embedding by cosine similarity. A match returns a short-lived signed face token that the check-in carries as proof.
- Location check per site, using the accuracy the phone reports. A point inside the radius passes. A point whose accuracy circle reaches the radius is accepted and flagged. A precise point outside is recorded as `OUT_OF_RADIUS`. Nothing is silently rejected.
- Works without signal. The app writes each check-in to an on-device outbox before sending it, keeps the time of the button press, and delivers it when the connection returns. Retries are safe because every event carries a client-generated id.
- Review queue instead of blocking. Mock locations, poor GPS, missing face proof and phone clocks that disagree become risk flags. A supervisor approves or rejects the record (a rejection needs a note).
- Failed attempts leave evidence. When GPS, the camera, face matching or the server fails, the app reports the attempt with time and location, so an employee is not marked absent with nothing on record.
- Shift matching and lateness. Each site has its own timezone. Timestamps are stored in UTC and business rules (today's shift, `ONTIME` or `LATE` with tolerance) run in site-local time.
- Automatic check-out. A background worker closes open records after their shift ends. A real check-out that arrives later from an offline phone replaces the automatic one.
- Overtime. Weekend and holiday work is counted as overtime at check-out. Weekday overtime goes through a request and approval flow, and only one pending or approved request is allowed per attendance record.
- Sick days, permits and annual leave. Employees submit from the mobile app (up to 30 days per request, starting at most 7 days back or 90 days ahead) and can cancel while it is pending. Overlapping requests are refused, also when two arrive at once. Supervisors approve or reject their direct reports' requests in the web dashboard, a rejection needs a note, and the dashboard shows who is on leave today.
- Attendance recap per employee for up to 62 days: workdays, present, late, sick, permit and annual leave, and days absent without notice (a past workday with no check-in and no approved leave), with CSV export. Workdays come from the site's shift schedules, temporary assignments and holidays.
- Assignments, holidays, sites with a map picker, reports and exports in the web dashboard.
- Role-based access for `ADMIN`, `SUPERVISOR` and `EMPLOYEE`. Supervisors only see and approve their direct reports; employees only see their own records.

## Architecture

```mermaid
flowchart LR
  M["Mobile app<br/>(Expo, camera + GPS)"] -->|JWT, multipart selfie| API
  W["Web dashboard<br/>(React + Vite)"] -->|JWT| API
  subgraph API["FastAPI backend"]
    R["Routers<br/>auth, attendance, face, overtime,<br/>shifts, sites, assignments, users"] --> S["Services<br/>business rules"]
    S --> Repo["Repositories<br/>PyMongo async"]
    S --> F["OpenCV YuNet + SFace<br/>(loaded once at startup)"]
    BG["Auto check-out worker"] --> S
  end
  Repo --> DB[("MongoDB<br/>replica set")]
```

The web admin and mobile app share one design system with IEMS ([design-system/hadirops/MASTER.md](design-system/hadirops/MASTER.md)): navy chrome, soft-depth cards, one blue action color, Plus Jakarta Sans bundled with the web build, and color tokens instead of hex values in the mobile screens.

The backend follows a router, service and repository split; the repositories are the only code that talks to MongoDB (see [Data model](#data-model)). The face engine is loaded once in the FastAPI lifespan hook and injected into the face service, so requests do not pay the model load cost; inference runs in the thread pool so it never blocks the event loop. Login rate limiting is a small dependency on top of `limits`.

### Check-in flow

The diagram shows the online path: the face matches the stored embedding, then the server applies the location and shift rules and stores the result. When a step cannot complete (no signal, no face proof), the check-in is still stored with risk flags, as described in [Reliability](#reliability).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Javanian/Hadir-Ops/main/docs/diagrams/hadirops-checkin-dark.svg">
  <img alt="Check-in sequence: the mobile app takes a GPS fix and a face photo, verifies the face through FastAPI and OpenCV SFace against the stored embedding, then posts the check-in, which the API validates against the site radius and shift before inserting the attendance row" src="docs/diagrams/hadirops-checkin-light.svg">
</picture>

Drawn from [docs/diagrams/hadirops-checkin.json](docs/diagrams/hadirops-checkin.json), which lists the source lines behind each step.

## Reliability

Low-star Play Store reviews of attendance apps used in Indonesia (2,127 one- and two-star reviews across 13 apps, October 2024 to October 2026) keep returning to the same failures: errors at the morning rush, offline check-ins that never upload, GPS drifting hundreds of metres and refusing honest people, and failures that end up as an unpaid absence. HadirOps treats each of these as a design requirement.

| Failure | What HadirOps does | Where |
| --- | --- | --- |
| Double tap or timeout creates two records | Each event has a client id. Repeating it returns the stored record (HTTP 200). Unique indexes on `(user_id, work_date)` and the event id settle races in the database. | `attendance_service.checkin`, `app/db/schema.py` |
| No signal at the gate | The event is stored on the phone first and sent in order (check-in before check-out) with backoff when the network, the app or the login comes back. | `mobile/src/offline/` |
| Late upload gets the wrong time | The phone sends the time of the button press plus a monotonic age measured at send time. If the two disagree by more than 5 minutes, the record keeps the phone's time and is flagged `CLOCK_MISMATCH`. Events older than 72 hours are refused. | `checkin_rules.resolve_event_time` |
| GPS drift | The accuracy circle is compared with the site radius (accuracy capped at 150 m). Overlap is accepted and flagged `LOW_GPS_ACCURACY`. | `checkin_rules.evaluate_geofence` |
| Fake GPS | Android's mock-location signal is recorded as `MOCK_LOCATION` and sent to review, not blocked. | `mobile/src/utils/location.ts` |
| Face check impossible offline | The check-in is stored with `FACE_NOT_VERIFIED` and the photo is uploaded when the record syncs. A match clears the flag. | `POST /attendance/{id}/face` |
| Failure leaves no trace | `POST /attendance/attempts` stores what failed, when and where. Supervisors see it next to the review queue. | `web/src/pages/review/` |
| Several workers or replicas | The auto check-out pass runs under a lease document with an expiry, so only one process closes records at a time and a crashed worker cannot block the others. | `main.run_auto_checkout_once`, `app/db/locks.py` |
| Silent bad deploy | `/health/ready` checks the database and the face model and returns 503 when either is missing. Production refuses to start with the development `SECRET_KEY`. | `main.py`, `config.py` |

### Tests and load

`backend/tests` runs against a real MongoDB replica set with the production indexes and validators: 81 tests covering the time and geofence rules, idempotent retries, concurrent submissions, offline check-ins and check-outs, review queue permissions, failed attempts, health checks, the worker lease, login lockout, token invalidation after a password change, the leave request rules (including concurrent submissions), the attendance recap, the data layer (cascading deletes, validators, id allocation), per-client login rate limiting, passwords hashed by the earlier passlib release, the first-admin script, enrolments from an earlier face model, and the real face models on public-domain NASA photos (the same person in a different photo matches, two other people do not, a group photo and a photo without a face are refused, an altered model file is refused). Any `DeprecationWarning` fails the run.

CI runs them on Python 3.12 and 3.14 against `mongo:9.0.4`. It also lints (zero warnings, deprecated APIs are errors) and builds the web dashboard, type-checks, lints, runs `expo-doctor` on and bundles the mobile app, audits every locked dependency against OSV (including known malicious releases), checks the workflows with zizmor and builds both production images.

```bash
cd backend
uv sync                         # exact versions from uv.lock, hashes checked
TEST_MONGODB_URL="mongodb://localhost:27017/?replicaSet=rs0" uv run pytest
```

The first run downloads the two face model files (39 MB) into `backend/models` and checks their SHA-256. The API tests use a stub for the face service; `tests/test_face_model.py` runs the real models.

`backend/scripts/load_checkin.py` simulates a morning rush against a running API: every employee checks in at once and part of the requests are sent twice. Runs on a Windows desktop (2 uvicorn workers, local single-node MongoDB 8.0 replica set, face verification off, 100 concurrent clients):

| Employees | Requests (resent) | Success | Records | p50 | p95 | Throughput |
| --- | --- | --- | --- | --- | --- | --- |
| 500 | 631 (131) | 100% | 500 | 690 ms | 1,567 ms | 112 req/s |
| 2,000 | 2,619 (619) | 100% | 2,000 | 1,091 ms | 1,292 ms | 99 req/s |
| 2,000 | 2,586 (586) | 100% | 2,000 | 726 ms | 3,311 ms | 98 req/s |

Every run ends with exactly one record per employee. Throughput on this machine is bounded by the disk: a raw benchmark of 2,000 concurrent durable inserts (`w: majority`, journaled) managed about 190 per second with a multi-second p95, against roughly 1,600 per second without journaling, so repeated runs vary between about 30 and 100 req/s. Writes stay durable anyway; measure on the target server before sizing. Face matching happens before the check-in request and is not part of these numbers.

The offline flow was also driven end to end in the Expo web build: the browser was set offline, a check-in was taken and stored on the device, and it reached the database 15 seconds after the connection returned, with the original time.

### Moving an existing PostgreSQL install

Earlier versions stored data in PostgreSQL. `backend/scripts/migrate_from_postgres.py` copies every table into MongoDB with the same ids (work schedules folded into their shift, roles into each user, pgvector embeddings into arrays) and raises the id counters above the copied ones. Stop the API first.

```bash
uv pip install asyncpg
PG_URL=postgresql://hadirops:pass@host:5432/hadirops PG_SCHEMA=hadirops \
MONGODB_URL="mongodb://host:27017/?replicaSet=rs0" MONGODB_DB=hadirops \
    python scripts/migrate_from_postgres.py
```

Indexes and validators are created by the API at startup (and by the seed and migration scripts), so a new database needs no separate schema step.

## Data model

MongoDB, one collection per aggregate. The choices that keep the old relational guarantees:

| Concern | How it is handled | Where |
| --- | --- | --- |
| Numeric ids the apps already use | Integer `_id` from a `counters` collection. Each process reserves a block of 50 with one `$inc` (hi/lo), because a single counter document updated on every check-in became a hot spot under load. | `app/db/ids.py` |
| One check-in per person per day | Partial unique index on `(user_id, work_date)`; `work_date` is the site-local date stored as `YYYY-MM-DD`. Queries on partially indexed fields state `$type: "string"` so the planner can use the index. | `app/db/schema.py`, `attendance_repository.py` |
| No two overlapping leave requests | Multi-document transaction that also writes the user document: a concurrent submission hits a write conflict, is retried after the first commits, and then sees the overlap. | `leave_service.create` |
| A decision is taken once | Conditional update on `status: "PENDING"` for leave and overtime. | `leave_repository`, `overtime_repository` |
| Shift schedules | Embedded array in the shift document; schedule ids stay global for the API. | `shift_repository.py` |
| Cascading deletes | Done in a transaction by the repository (a user's attendance, overtime, leave and assignments go with them; references from other records are cleared). | `user_repository.delete_cascade` |
| CHECK constraints | `$jsonSchema` validators (enums, required fields) plus `$expr` for date ranges. | `app/db/schema.py` |
| Related data | Loaded in batches with `$in`, one query per related collection, not per row. | `app/db/relations.py` |
| Face embeddings | A 128-number array on the user, with the name of the model that made it (`face_model`). Matching is one-to-one against the user's own embedding, so no vector index is involved. | `app/db/documents.py` |

Transactions need a replica set; a single-node set is enough and is what `docker-compose.yml` runs.

## Run locally

Requirements: Docker Desktop with at least 4 GB of memory, Node.js 24 or 26 (LTS), and Expo Go for SDK 58 on a phone on the same network as your computer. Without Docker, the backend runs with [uv](https://docs.astral.sh/uv/) (`cd backend && uv sync && uv run uvicorn app.main:app --reload`) against any MongoDB 9.0 replica set.

```bash
# 1. Environment files (defaults work for local development)
cp .env.example .env
cp backend/.env.example backend/.env

# 2. Backend, database and web dashboard
docker compose up -d --build
docker compose logs -f backend   # wait until the face model has loaded

# 3. Sample data: sites, shifts, supervisor/employee hierarchy, attendance, leave
docker compose exec backend python seed.py
docker compose exec backend python seed_recent.py   # attendance for the last 7 days

# 4. Mobile app
cd mobile
npm ci
npm start -- --clear             # scan the QR code with Expo Go
```

On Windows PowerShell, use `Copy-Item` instead of `cp` for step 1.

| Service | URL |
| --- | --- |
| Web dashboard | http://localhost:5173 |
| API | http://localhost:8000 |
| Swagger UI | http://localhost:8000/docs |
| ReDoc | http://localhost:8000/redoc |

### Seed accounts (local only)

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@hadirops.local` | `Admin@123` |
| Supervisor | `spv101@example.com` | `12345` |
| Employee | `emp101@example.com` | `12345` |

These accounts exist only after running `seed.py`. Do not use them in any shared or production deployment.

### Useful commands

```bash
docker compose restart backend   # restart the API
docker compose down              # stop, keep database data
docker compose down -v           # stop and delete the database volume
```

A database volume created by an earlier version (MongoDB 8.0) starts on 9.0 as is; MongoDB keeps the 8.0 feature set until `db.adminCommand({setFeatureCompatibilityVersion: "9.0", confirm: true})` is run.

## Going live

`docker-compose.prod.yml` runs three containers on one host: **web** (Caddy: HTTPS with automatic certificates, the dashboard, and the API under `/api`), **backend** (two uvicorn workers) and **db** (MongoDB with authentication). Only ports 80 and 443 are published.

```bash
# On the server, in a checkout of this repository
cp .env.example .env                       # DOMAIN, DB_PASSWORD (openssl rand -hex 24)
cp backend/.env.example backend/.env       # SECRET_KEY (see the comment in the file)
openssl rand -base64 756 > deploy/mongo-keyfile
chmod 400 deploy/mongo-keyfile && sudo chown 999:999 deploy/mongo-keyfile

docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec backend \
    python scripts/create_admin.py --email it@company.example --name "IT Admin"
```

Then log in at `https://DOMAIN`, create sites, shifts and users, and build the mobile app against the same address.

| Before go-live | Why |
| --- | --- |
| DNS for `DOMAIN` points at the server; ports 80 and 443 are open | Caddy needs them to obtain and renew the certificate |
| `SECRET_KEY` is random and at least 32 characters | The API refuses to start in production otherwise; it signs every token |
| `create_admin.py`, never `seed.py`, on the production database | `seed.py` creates demo accounts with published passwords |
| `deploy/backup.sh` runs nightly from cron and the archives are copied off the host | One volume holds all attendance data; the script keeps 14 days locally and documents the restore command |
| The mobile app is built with `EXPO_PUBLIC_API_BASE_URL=https://DOMAIN/api` in the EAS `production` environment | Release builds refuse a missing or plain-HTTP address |

What production does differently: the API docs (`/docs`, `/redoc`, `/openapi.json`) are not served, CORS allows only `https://DOMAIN`, the backend trusts `X-Forwarded-For` only because nothing but Caddy can reach it (so login rate limits apply per employee, not to the proxy), Caddy sends HSTS, a Content-Security-Policy and the other security headers and refuses request bodies over 8 MB, and every container restarts on failure. The backend health check uses `/health/ready`, which fails while the database or the face model is missing.

### Face recognition models

| Model | Task | Weights license | Source |
| --- | --- | --- | --- |
| YuNet (`face_detection_yunet_2026may.onnx`) | Finds faces and five landmarks | MIT | [opencv_zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet) |
| SFace (`face_recognition_sface_2021dec.onnx`) | 128-d embedding of an aligned face | Apache 2.0 | [opencv_zoo](https://github.com/opencv/opencv_zoo/tree/main/models/face_recognition_sface) |

Both run in OpenCV's DNN module, which the backend already uses to decode photos, so there is no separate inference runtime. `app/services/face_models.py` pins each file to one opencv_zoo commit and its SHA-256; the Docker image downloads them at build time, and the API checks the hashes again at every start and refuses to run on a mismatch.

Both weight files carry permissive licenses that allow commercial use. The SFace paper trained its models on public research face datasets (CASIA-WebFace, VGGFace2, MS-Celeb-1M), as nearly every openly available recognition model is, and OpenCV does not say which one its file came from. Some of those datasets were published for research use. Whether that reaches a model trained on them is not settled; for a large commercial deployment, ask counsel. InsightFace's pretrained packs, used by earlier versions of HadirOps, are licensed for non-commercial research only and are no longer used.

**Upgrading from a version with InsightFace:** stored embeddings came from another model and cannot be compared with SFace. They are kept, but the API treats those users as not enrolled: `GET /face/status` reports `reregister_required`, verification answers 409, and the mobile app asks the employee to register their face again from the Profile screen. An admin can delete the old data from the user page. Rename `FACE_SIMILARITY_THRESHOLD` in `backend/.env` to `FACE_MATCH_THRESHOLD` (default 0.363, OpenCV's published SFace threshold); the old 0.3 would be too lenient for SFace.

### Mobile release builds

```bash
cd mobile
npx eas-cli@latest env:set production --name EXPO_PUBLIC_API_BASE_URL --value https://DOMAIN/api --visibility plaintext
npx eas-cli@latest build --profile production --platform android   # or ios
```

`eas.json` has a `preview` profile (installable APK for testing) and a `production` profile with automatic build numbers. The app asks only for the camera and foreground location.

## Supply chain and upgrades

- **Locked:** `backend/uv.lock` and the npm lockfiles record every package with its hash; Docker builds install with `uv sync --locked` and `npm ci --ignore-scripts`. Base images and GitHub Actions are pinned by digest and commit SHA.
- **Cooldown:** a release is used only after it has been public for 7 days (`exclude-newer` in `backend/pyproject.toml`, `cooldown` in Dependabot), long enough for most malicious uploads to be found and pulled.
- **Weekly updates:** Dependabot opens grouped pull requests for Python, npm, Docker images and Actions; CI tests and audits each one. Expo SDK packages are upgraded together with `npx expo install expo@^<sdk> --fix`.
- **Known exceptions:** the remaining `npm audit` findings are moderate, in build tooling only (ESLint's `minimatch`, the Expo CLI's `glob`), and wait for upstream releases.

## Repository notes

- Source, app assets, npm lockfiles and `.env.example` are tracked. Local environment files, editor settings, dependencies, build output and runtime data are not.
- Containers, the database, native package identifiers (`com.hadirops.mobile`) and the seed admin account all use the `hadirops` name.
- The user interface is in Indonesian.

## Limitations

- Face verification compares embeddings only. It has no liveness or anti-spoofing check, so a printed photo of an enrolled employee may pass. The GPS geofence, the device clock checks and the supervisor review queue are the other controls. MiniFASNet (Apache 2.0) is a candidate for a passive liveness check.
- Android's monotonic clock pauses in deep sleep, so a phone that slept between an offline check-in and its upload is flagged `CLOCK_MISMATCH` for review rather than proven.
- The mobile app has no automated UI tests. The offline flow was checked in the Expo web build, not on physical devices in the field.
- SFace is a compact model (LFW 99.40%, per OpenCV). It is accurate enough to confirm an employee against their own enrolment, but it is not meant for searching one face among thousands.

## Author

Tee San ([Javanian](https://github.com/Javanian)) · [Portfolio](https://porto.hillteo.com) · [teesanfajar@gmail.com](mailto:teesanfajar@gmail.com)
