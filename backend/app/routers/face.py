"""
Face Recognition Router — Phase 3
===================================
Endpoints:
  POST   /face/register/{user_id}  — store embedding (any user: own face; ADMIN/SUPERVISOR: any user)
  POST   /face/verify/{user_id}    — verify against stored embedding (any auth user)
  GET    /face/status/{user_id}    — check whether user has a face registered (any auth user)
  DELETE /face/{user_id}           — remove embedding (ADMIN only)

The InsightFace model is loaded once at startup and lives in app.state.face_app.
It is injected into FaceService via _get_face_service() without touching main.py's
logic or any Phase 1/2 module.
"""

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.core.dependencies import get_current_user, require_role
from app.repositories.user_repository import UserRepository
from app.services.face_service import FaceService

router = APIRouter(prefix="/face", tags=["Face Recognition"])


# ── Dependency ─────────────────────────────────────────────────────────────────

def _get_face_service(request: Request) -> FaceService:
    """Build a FaceService from the app-level InsightFace model."""
    return FaceService(
        face_app=request.app.state.face_app,
        similarity_threshold=settings.FACE_SIMILARITY_THRESHOLD,
        max_width=settings.FACE_MAX_WIDTH,
    )


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.post(
    "/register/{user_id}",
    summary="Register (or replace) face embedding — any user for own face; ADMIN/SUPERVISOR for any user",
    responses={
        200: {"description": "Embedding stored successfully"},
        403: {"description": "EMPLOYEE attempting to register another user's face"},
        404: {"description": "User not found"},
        422: {"description": "No face detected / multiple faces detected / invalid image"},
    },
)
async def register_face(
    user_id: int,
    request: Request,
    file: UploadFile = File(..., description="JPEG or PNG — must contain exactly one face"),
    db: AsyncSession = Depends(get_db),
    current_user=Depends(get_current_user),
):
    # IDOR protection: EMPLOYEE can only register their own face
    if current_user.role.name == "EMPLOYEE" and current_user.id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only register your own face.",
        )

    repo = UserRepository(db)
    user = await repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    image_bytes = await file.read()
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
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    repo = UserRepository(db)
    user = await repo.get_by_id(user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.face_embedding is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No face registered for this user",
        )

    image_bytes = await file.read()
    face_svc = _get_face_service(request)

    # pgvector returns the embedding as a numpy array or list — normalise to list
    stored = list(user.face_embedding)
    return face_svc.verify(image_bytes, stored)


@router.get(
    "/status/{user_id}",
    summary="Check whether a user has a face embedding registered",
)
async def face_status(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
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
    db: AsyncSession = Depends(get_db),
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
