# HadirOps

Attendance and workforce operations for field and plant employees. Employees check in from a mobile app with face verification and GPS; supervisors and admins manage sites, shifts, assignments and overtime approvals from a web dashboard.

The system has three parts that share one API:

| Component | Stack | Used by |
| --- | --- | --- |
| [`backend/`](backend/) | FastAPI, SQLAlchemy (async), PostgreSQL with `pgvector`, InsightFace | Mobile app and web dashboard |
| [`web/`](web/) | React, Vite, TypeScript, Tailwind CSS, TanStack Query and Table, Leaflet | Admins and supervisors |
| [`mobile/`](mobile/) | React Native with Expo SDK 54, TypeScript | Employees and supervisors |

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

- Check-in and check-out with a selfie. The backend detects exactly one face, extracts a 512-dimension InsightFace embedding and compares it with the enrolled embedding by cosine similarity. A match returns a short-lived signed face token that the check-in carries as proof.
- Location check per site, using the accuracy the phone reports. A point inside the radius passes. A point whose accuracy circle reaches the radius is accepted and flagged. A precise point outside is recorded as `OUT_OF_RADIUS`. Nothing is silently rejected.
- Works without signal. The app writes each check-in to an on-device outbox before sending it, keeps the time of the button press, and delivers it when the connection returns. Retries are safe because every event carries a client-generated id.
- Review queue instead of blocking. Mock locations, poor GPS, missing face proof and phone clocks that disagree become risk flags. A supervisor approves or rejects the record (a rejection needs a note).
- Failed attempts leave evidence. When GPS, the camera, face matching or the server fails, the app reports the attempt with time and location, so an employee is not marked absent with nothing on record.
- Shift matching and lateness. Each site has its own timezone. Timestamps are stored in UTC and business rules (today's shift, `ONTIME` or `LATE` with tolerance) run in site-local time.
- Automatic check-out. A background worker closes open records after their shift ends. A real check-out that arrives later from an offline phone replaces the automatic one.
- Overtime. Weekend and holiday work is counted as overtime at check-out. Weekday overtime goes through a request and approval flow, and only one pending or approved request is allowed per attendance record.
- Assignments, holidays, sites with a map picker, reports and exports in the web dashboard.
- Role-based access for `ADMIN`, `SUPERVISOR` and `EMPLOYEE`. Supervisors only see and approve their direct reports; employees only see their own records.

## Architecture

```mermaid
flowchart LR
  M["Mobile app<br/>(Expo, camera + GPS)"] -->|JWT, multipart selfie| API
  W["Web dashboard<br/>(React + Vite)"] -->|JWT| API
  subgraph API["FastAPI backend"]
    R["Routers<br/>auth, attendance, face, overtime,<br/>shifts, sites, assignments, users"] --> S["Services<br/>business rules"]
    S --> Repo["Repositories<br/>SQLAlchemy async"]
    S --> F["InsightFace buffalo_s<br/>(loaded once at startup)"]
    BG["Auto check-out worker"] --> S
  end
  Repo --> DB[("PostgreSQL + pgvector")]
```

The web admin and mobile app share one design system with IEMS ([design-system/hadirops/MASTER.md](design-system/hadirops/MASTER.md)): navy chrome, soft-depth cards, one blue action color, Plus Jakarta Sans bundled with the web build, and color tokens instead of hex values in the mobile screens.

The backend follows a router, service and repository split. The InsightFace model is loaded once in the FastAPI lifespan hook and injected into the face service, so requests do not pay the model load cost. Rate limiting uses `slowapi`.

### Check-in flow

The diagram shows the online path: the face matches the stored embedding, then the server applies the location and shift rules and stores the result. When a step cannot complete (no signal, no face proof), the check-in is still stored with risk flags, as described in [Reliability](#reliability).

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/Javanian/Hadir-Ops/main/docs/diagrams/hadirops-checkin-dark.svg">
  <img alt="Check-in sequence: the mobile app takes a GPS fix and a face photo, verifies the face through FastAPI and InsightFace against a pgvector embedding, then posts the check-in, which the API validates against the site radius and shift before inserting the attendance row" src="docs/diagrams/hadirops-checkin-light.svg">
</picture>

Drawn from [docs/diagrams/hadirops-checkin.json](docs/diagrams/hadirops-checkin.json), which lists the source lines behind each step.

## Reliability

Low-star Play Store reviews of attendance apps used in Indonesia (2,127 one- and two-star reviews across 13 apps, October 2024 to October 2026) keep returning to the same failures: errors at the morning rush, offline check-ins that never upload, GPS drifting hundreds of metres and refusing honest people, and failures that end up as an unpaid absence. HadirOps treats each of these as a design requirement.

| Failure | What HadirOps does | Where |
| --- | --- | --- |
| Double tap or timeout creates two records | Each event has a client id. Repeating it returns the stored record (HTTP 200). Unique indexes on `(user_id, work_date)` and the event id settle races in the database. | `attendance_service.checkin`, `migration_durable_checkin.sql` |
| No signal at the gate | The event is stored on the phone first and sent in order (check-in before check-out) with backoff when the network, the app or the login comes back. | `mobile/src/offline/` |
| Late upload gets the wrong time | The phone sends the time of the button press plus a monotonic age measured at send time. If the two disagree by more than 5 minutes, the record keeps the phone's time and is flagged `CLOCK_MISMATCH`. Events older than 72 hours are refused. | `checkin_rules.resolve_event_time` |
| GPS drift | The accuracy circle is compared with the site radius (accuracy capped at 150 m). Overlap is accepted and flagged `LOW_GPS_ACCURACY`. | `checkin_rules.evaluate_geofence` |
| Fake GPS | Android's mock-location signal is recorded as `MOCK_LOCATION` and sent to review, not blocked. | `mobile/src/utils/location.ts` |
| Face check impossible offline | The check-in is stored with `FACE_NOT_VERIFIED` and the photo is uploaded when the record syncs. A match clears the flag. | `POST /attendance/{id}/face` |
| Failure leaves no trace | `POST /attendance/attempts` stores what failed, when and where. Supervisors see it next to the review queue. | `web/src/pages/review/` |
| Several workers or replicas | The auto check-out pass runs under a Postgres advisory lock, so only one process closes records at a time. | `main.run_auto_checkout_once` |
| Silent bad deploy | `/health/ready` checks the database and the face model and returns 503 when either is missing. Production refuses to start with the development `SECRET_KEY`. | `main.py`, `config.py` |

### Tests and load

`backend/tests` runs against a real PostgreSQL database built from `database.sql`: 38 tests covering the time and geofence rules, idempotent retries, concurrent submissions, offline check-ins and check-outs, review queue permissions, failed attempts, health checks and the worker lock. CI runs them on every push with `pgvector/pgvector:pg16`, and also builds the web dashboard and type-checks the mobile app.

```bash
cd backend
pip install -r requirements.txt -r requirements-dev.txt
TEST_DATABASE_URL=postgresql+asyncpg://hadirops:hadiropspass@localhost:5433/hadirops_test pytest
```

`backend/scripts/load_checkin.py` simulates a morning rush against a running API: every employee checks in at once and part of the requests are sent twice. On a desktop PC (Windows, 2 uvicorn workers, local PostgreSQL 16, face verification off, 100 concurrent clients):

| Employees | Requests (resent) | Success | Records | p50 | p95 | Throughput |
| --- | --- | --- | --- | --- | --- | --- |
| 2,000 | 2,587 (587) | 100% | 2,000 | 795 ms | 1,314 ms | 116 req/s |
| 2,000 | 2,608 (608) | 100% | 2,000 | 690 ms | 1,688 ms | 118 req/s |

Face matching happens before the check-in request and is not part of these numbers.

The offline flow was also driven end to end in the Expo web build: the browser was set offline, a check-in was taken and stored on the device, and it reached the database 15 seconds after the connection returned, with the original time.

### Upgrading an existing database

```bash
docker compose exec -T db psql -U hadirops -d hadirops < backend/migration_durable_checkin.sql
```

The migration is idempotent. It backfills the site-local `work_date` for existing check-ins. If an older bug left two check-ins on one day for the same person, the later one keeps a `NULL` work date instead of being deleted.

## Run locally

Requirements: Docker Desktop with at least 4 GB of memory, Node.js 18 or newer, and Expo Go on a phone on the same network as your computer.

```bash
# 1. Environment files (defaults work for local development)
cp .env.example .env
cp backend/.env.example backend/.env

# 2. Backend, database and web dashboard
docker compose up -d --build
docker compose logs -f backend   # wait until the face model has loaded

# 3. Sample data: sites, shifts, supervisor/employee hierarchy, attendance
docker compose exec backend python seed.py

# 4. Mobile app
cd mobile
npm install
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

## Repository notes

- Source, SQL migrations, app assets, npm lockfiles and `.env.example` are tracked. Local environment files, editor settings, dependencies, build output and runtime data are not.
- Containers, the database, native package identifiers (`com.hadirops.mobile`) and the seed admin account all use the `hadirops` name.
- The user interface is in Indonesian.

## Limitations

- Face verification compares embeddings only. It has no liveness or anti-spoofing check, so a printed photo of an enrolled employee may pass.
- Android's monotonic clock pauses in deep sleep, so a phone that slept between an offline check-in and its upload is flagged `CLOCK_MISMATCH` for review rather than proven.
- The mobile app has no automated UI tests. The offline flow was checked in the Expo web build, not on physical devices in the field.
- InsightFace runs on CPU inside the backend container, which makes the first start slow.

## Author

Tee San ([Javanian](https://github.com/Javanian)) · [Portfolio](https://porto.hillteo.com) · [teesanfajar@gmail.com](mailto:teesanfajar@gmail.com)
