import asyncio
import logging
import os
import socket
import time
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.core.config import settings
from app.routers import assignments, attendance, auth, face, leave, overtime, reports, shifts, sites, users

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
log = logging.getLogger("hadirops")

limiter = Limiter(key_func=get_remote_address)

# Lease shared by every API process; only the holder runs a pass.
AUTO_CHECKOUT_LOCK = "auto_checkout"
_WORKER_ID = f"{socket.gethostname()}:{os.getpid()}"

_worker_state = {"last_run": None, "last_error": None}


# ── Auto-checkout background worker ───────────────────────────────────────────

async def run_auto_checkout_once(worker_id: str = _WORKER_ID) -> tuple[int, int] | None:
    """
    One pass of the auto-checkout job. Returns (shift_end, overtime_end) counts,
    or None if another process holds the lease.

    Several uvicorn workers or containers each run this loop. A lease document
    in MongoDB makes sure only one of them closes records at a time; it
    expires on its own, so a process that dies mid-pass cannot block the rest.
    """
    from app.core.database import get_database
    from app.db import locks
    from app.services.attendance_service import AttendanceService

    db = get_database()
    ttl = max(60, settings.AUTO_CHECKOUT_INTERVAL_SECONDS * 5)
    if not await locks.acquire(db, AUTO_CHECKOUT_LOCK, worker_id, ttl):
        return None
    try:
        service = AttendanceService(db)
        shift_end = await service.run_auto_checkout()
        ot_end = await service.run_overtime_end_checkout()
        return shift_end, ot_end
    finally:
        await locks.release(db, AUTO_CHECKOUT_LOCK, worker_id)


async def _auto_checkout_worker():
    """Runs forever and never lets one failed pass stop the next one."""
    # Short initial delay so the app finishes startup before first run
    await asyncio.sleep(30)
    while True:
        try:
            result = await run_auto_checkout_once()
            _worker_state["last_run"] = datetime.now(timezone.utc)
            _worker_state["last_error"] = None
            if result and any(result):
                log.info("auto-checkout closed %d at shift end, %d at overtime end", *result)
        except Exception as exc:
            _worker_state["last_error"] = str(exc)[:300]
            log.exception("auto-checkout pass failed")
        await asyncio.sleep(settings.AUTO_CHECKOUT_INTERVAL_SECONDS)


def _load_face_model():
    # Imported here so the API can start (and be tested) without the model
    # when FACE_ENABLED is false.
    from insightface.app import FaceAnalysis

    model = FaceAnalysis(name=settings.FACE_MODEL_NAME, providers=["CPUExecutionProvider"])
    model.prepare(ctx_id=0, det_size=(640, 640))
    return model


# ── Lifespan ──────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ───────────────────────────────────────────────────────────────
    settings.check_production_safety()

    # 0. Indexes and validators (idempotent)
    from app.core.database import get_database
    from app.db.schema import ensure_schema
    await ensure_schema(get_database())

    # 1. Load InsightFace model once (shared across all requests).
    # If face is enabled and the model fails to load, startup fails loudly
    # rather than running with check-ins that can never be verified.
    app.state.face_app = _load_face_model() if settings.FACE_ENABLED else None

    # 2. Start auto-checkout background task
    checkout_task = (
        asyncio.create_task(_auto_checkout_worker()) if settings.AUTO_CHECKOUT_ENABLED else None
    )

    yield

    # ── Shutdown ──────────────────────────────────────────────────────────────
    if checkout_task is not None:
        checkout_task.cancel()
        try:
            await checkout_task
        except asyncio.CancelledError:
            pass

    from app.core.database import client
    await client.close()


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
app.include_router(leave.router)
app.include_router(reports.router)


# ── Health checks ─────────────────────────────────────────────────────────────

@app.get("/health/live", tags=["System"])
async def liveness():
    """The process is up. Use for container restart decisions."""
    return {"status": "ok"}


@app.get("/health", tags=["System"])
@app.get("/health/ready", tags=["System"])
async def readiness(request: Request):
    """
    Ready to take check-ins: the database answers and, when enabled, the face
    model is loaded. Returns 503 otherwise so a load balancer can route around it.
    """
    from app.core.database import get_database

    checks = {}
    healthy = True

    started = time.perf_counter()
    try:
        await asyncio.wait_for(get_database().command("ping"), timeout=3)
        checks["database"] = {"ok": True, "latency_ms": round((time.perf_counter() - started) * 1000, 1)}
    except Exception as exc:
        healthy = False
        checks["database"] = {"ok": False, "error": type(exc).__name__}

    if settings.FACE_ENABLED:
        face_ok = getattr(request.app.state, "face_app", None) is not None
        checks["face_model"] = {"ok": face_ok}
        healthy = healthy and face_ok

    last_run = _worker_state["last_run"]
    checks["auto_checkout"] = {
        "enabled": settings.AUTO_CHECKOUT_ENABLED,
        "last_run": last_run.isoformat() if last_run else None,
        "last_error": _worker_state["last_error"],
    }

    body = {"status": "ok" if healthy else "degraded", "service": "HadirOps", "checks": checks}
    return JSONResponse(body, status_code=200 if healthy else 503)
