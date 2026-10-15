"""
Face Recognition Router — Phase 3
===================================
Endpoints:
  POST   /face/register/{user_id}  — store embedding (own face; SUPERVISOR: direct reports; ADMIN: anyone)
  POST   /face/verify/{user_id}    — verify against stored embedding (same access rule)
  GET    /face/status/{user_id}    — whether a face is registered (same access rule)
  DELETE /face/{user_id}           — remove embedding (ADMIN only)

The InsightFace model is loaded once at startup and lives in app.state.face_app.
It is injected into FaceService via _get_face_service() without touching main.py's
logic or any Phase 1/2 module.
"""

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pymongo.asynchronous.database import AsyncDatabase

from app.core.access import require_user_access
from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role
from app.core.security import create_face_token
from app.core.uploads import read_image_upload
from app.repositories.user_repository import UserRepository
from app.services.face_service import FaceService

router = APIRouter(prefix="/face", tags=["Face Recognition"])


# ── Dependency ─────────────────────────────────────────────────────────────────

def _get_face_service(request: Request) -> FaceService:
    """Build a FaceService from the app-level InsightFace model."""
    face_app = getattr(request.app.state, "face_app", None)
    if face_app is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Face recognition is not available on this server.",
        )
    return FaceService(
        face_app=face_app,
        similarity_threshold=settings.FACE_SIMILARITY_THRESHOLD,
        max_width=settings.FACE_MAX_WIDTH,
    )


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post(
    "/register/{user_id}",
    summary="Register (or replace) face embedding — own face; SUPERVISOR for direct reports; ADMIN for anyone",
    responses={
        200: {"description": "Embedding stored successfully"},
        403: {"description": "Not your own face, and not a user you manage"},
        404: {"description": "User not found"},
        422: {"description": "No face detected / multiple faces detected / invalid image"},
    },
)
async def register_face(
    user_id: int,
    request: Request,
    file: UploadFile = File(..., description="JPEG or PNG — must contain exactly one face"),
    db: AsyncDatabase = Depends(get_db),
    current_user=Depends(get_current_user),
):
    # Own face; a supervisor for direct reports; ADMIN for anyone
    await require_user_access(db, current_user, user_id)

    repo = UserRepository(db)
    user = await repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    image_bytes = await read_image_upload(file)
    face_svc = _get_face_service(request)
    embedding = face_svc.extract_embedding(image_bytes)

    already_registered = user.face_embedding is not None
    await repo.update_face_embedding(user_id, embedding)

    action = "replaced" if already_registered else "registered"
    return {
        "message": f"Face {action} for user {user_id} ({user.name})",
        "embedding_dim": len(embedding),
    }


@router.post(
    "/verify/{user_id}",
    summary="Verify a face image against the stored embedding",
    responses={
        200: {"description": "Verification result (verified, similarity, threshold)"},
        404: {"description": "User not found / no face registered"},
        422: {"description": "No face / multiple faces / invalid image"},
    },
)
async def verify_face(
    user_id: int,
    request: Request,
    file: UploadFile = File(..., description="JPEG or PNG — must contain exactly one face"),
    db: AsyncDatabase = Depends(get_db),
    current_user=Depends(get_current_user),
):
    # Comparing photos against someone else's enrolled face is limited to the
    # people who manage that account.
    await require_user_access(db, current_user, user_id)
    repo = UserRepository(db)
    user = await repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.face_embedding is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No face registered for this user",
        )

    image_bytes = await read_image_upload(file)
    face_svc = _get_face_service(request)

    # Stored as a list of floats; copy it so the face service gets its own list
    stored = list(user.face_embedding)
    result = face_svc.verify(image_bytes, stored)
    # A verified user checking their own face gets a short-lived token that
    # the check-in / check-out request carries as proof.
    if result["verified"] and current_user.id == user_id:
        result["face_token"] = create_face_token(user_id, result["similarity"])
    return result


@router.get(
    "/status/{user_id}",
    summary="Check whether a user has a face embedding registered",
)
async def face_status(
    user_id: int,
    db: AsyncDatabase = Depends(get_db),
    current_user=Depends(get_current_user),
):
    await require_user_access(db, current_user, user_id)
    repo = UserRepository(db)
    user = await repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return {"user_id": user_id, "name": user.name, "has_face": user.face_embedding is not None}


@router.delete(
    "/{user_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove face embedding for a user (ADMIN only)",
)
async def delete_face(
    user_id: int,
    db: AsyncDatabase = Depends(get_db),
    _=Depends(require_role("ADMIN")),
):
    repo = UserRepository(db)
    user = await repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.face_embedding is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User has no face embedding to remove",
        )
    await repo.update_face_embedding(user_id, None)
