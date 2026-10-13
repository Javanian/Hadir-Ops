import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from insightface.app import FaceAnalysis
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.core.config import settings
from app.routers import assignments, attendance, auth, face, overtime, shifts, sites, users

limiter = Limiter(key_func=get_remote_address)


# ── Auto-checkout background worker ───────────────────────────────────────────

async def _auto_checkout_worker():
    """
    Runs forever (every 60 s) and auto-checkouts any attendance record
    whose shift end time has passed.  Also auto-checkouts records whose
    APPROVED overtime end time has passed.  Imported lazily to avoid
    circular imports during module loading.
    """
    # Short initial delay so the app finishes startup before first run
    await asyncio.sleep(30)
    while True:
        try:
            from datetime import datetime, timezone
            from app.core.database import AsyncSessionLocal
            from app.services.attendance_service import AttendanceService
            from app.repositories.attendance_repository import AttendanceRepository
            async with AsyncSessionLocal() as db:
                # 1. Normal shift-end auto-checkout (existing logic)
                count = await AttendanceService(db).run_auto_checkout()
                if count:
                    print(f"[auto-checkout] Shift-end: {count} record(s).", flush=True)

                # 2. Approved overtime end auto-checkout
                now_utc = datetime.now(timezone.utc)
                att_repo = AttendanceRepository(db)
                ot_records = await att_repo.get_open_with_approved_overtime_due(now_utc)
                for att in ot_records:
                    checkin = att.checkin_time
                    work_mins = max(0, int((now_utc - checkin).total_seconds() / 60))
                    # overtime_minutes is already written by the approve action;
                    # we only set checkout_time and work_duration_minutes here.
                    att.checkout_time = now_utc
                    att.work_duration_minutes = work_mins
                    att.auto_checkout = True
                if ot_records:
                    await db.commit()
                    print(
                        f"[auto-checkout] OT-end: {len(ot_records)} record(s).",
                        flush=True,
                    )
        except Exception as exc:
            # Never crash the worker; production logging goes here (Phase 7)
            print(f"[auto-checkout] Error: {exc}", flush=True)
        await asyncio.sleep(60)


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    # 1. Load InsightFace model once (shared across all requests)
    face_model = FaceAnalysis(
        name=settings.FACE_MODEL_NAME,
        providers=["CPUExecutionProvider"],
    )
    face_model.prepare(ctx_id=0, det_size=(640, 640))
    app.state.face_app = face_model

    # 2. Start auto-checkout background task
    checkout_task = asyncio.create_task(_auto_checkout_worker())

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    checkout_task.cancel()
    try:
        await checkout_task
    except asyncio.CancelledError:
        pass

    from app.core.database import engine
    await engine.dispose()


# ── App ───────────────────────────────────────────────────────────────────────

app = FastAPI(
    title="HadirOps API",
    description="API manajemen presensi, shift, penugasan, dan lembur.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ── Rate limiter ──────────────────────────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS ──────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX or None,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


# ── Secure headers ────────────────────────────────────────────────────────────
@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "geolocation=(self)"
    return response


# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(sites.router)
app.include_router(shifts.router)
app.include_router(face.router)
app.include_router(attendance.router)
app.include_router(overtime.router)
app.include_router(assignments.router)


# ── Health check ──────────────────────────────────────────────────────────────
@app.get("/health", tags=["System"])
async def health_check():
    return {"status": "ok", "service": "HadirOps", "phase": "5"}
