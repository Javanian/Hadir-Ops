"""
Face Recognition Service
=========================
Responsibilities:
  - Decode & resize images (max_width cap)
  - Detect faces (FaceEngine: YuNet on CPU) and reject 0 or >1 faces
  - Extract L2-normalised 128-d embeddings (FaceEngine: SFace)
  - Compute cosine similarity (dot-product of normalised vectors)
  - Threshold comparison for verification

The FaceEngine is created ONCE at app startup (lifespan) and passed in here,
never instantiated here. The methods are CPU-bound and synchronous: routers
run them in the thread pool so the event loop keeps serving other requests.
"""

import cv2
import numpy as np
from fastapi import HTTPException, status

from app.services.face_models import EMBEDDING_MODEL


def enrolled_embedding(user) -> list[float] | None:
    """The user's stored embedding, or None when there is none or it came from
    another model (it cannot be compared; the user has to enrol again)."""
    if user.face_embedding is None or user.face_model != EMBEDDING_MODEL:
        return None
    return list(user.face_embedding)


def require_enrolled_embedding(user) -> list[float]:
    """The embedding to compare against, or 404 (none) / 409 (earlier model)."""
    if user.face_embedding is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No face registered for this user",
        )
    stored = enrolled_embedding(user)
    if stored is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="The registered face was made with an earlier model. Register the face again.",
        )
    return stored


class FaceService:
    def __init__(self, engine, similarity_threshold: float, max_width: int):
        self.engine = engine
        self.similarity_threshold = similarity_threshold
        self.max_width = max_width

    # ── Private helpers ────────────────────────────────────────────────────────

    def _decode_and_resize(self, image_bytes: bytes) -> np.ndarray:
        """Decode raw image bytes to a BGR ndarray and resize if needed."""
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="Cannot decode image. Provide a valid JPEG or PNG file.",
            )
        h, w = img.shape[:2]
        if w > self.max_width:
            scale = self.max_width / w
            img = cv2.resize(
                img,
                (self.max_width, int(h * scale)),
                interpolation=cv2.INTER_AREA,
            )
        return img

    def _extract_embedding(self, image_bytes: bytes) -> np.ndarray:
        """
        Detect exactly one face and embed it.
        Returns a float32 ndarray of shape (128,), already L2-normalised.
        Raises HTTP 422 if 0 or >1 faces are detected.
        """
        img = self._decode_and_resize(image_bytes)
        faces = self.engine.detect(img)

        if len(faces) == 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="No face detected in the image.",
            )
        if len(faces) > 1:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail=(
                    f"Multiple faces detected ({len(faces)}). "
                    "Provide an image with exactly one face."
                ),
            )

        return self.engine.embed(img, faces[0])

    # ── Public API ─────────────────────────────────────────────────────────────

    def extract_embedding(self, image_bytes: bytes) -> list:
        """
        Extract a face embedding from image_bytes.
        Returns a plain Python list of floats (stored as an array on the user).
        """
        return self._extract_embedding(image_bytes).tolist()

    def verify(self, image_bytes: bytes, stored_embedding: list) -> dict:
        """
        Compare the face in image_bytes against a stored embedding.

        Args:
            image_bytes:      raw bytes of the query image (JPEG/PNG)
            stored_embedding: list of floats retrieved from the DB, from the same model

        Returns:
            {
                "verified":   bool,
                "similarity": float  (cosine similarity, -1..1),
                "threshold":  float
            }
        """
        query = self._extract_embedding(image_bytes)

        stored = np.array(stored_embedding, dtype=np.float32)
        if stored.shape != query.shape:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="The registered face was made with another model. Register the face again.",
            )
        # Re-normalise stored vector in case of floating-point drift
        norm = np.linalg.norm(stored)
        if norm > 0:
            stored = stored / norm

        # Cosine similarity of two L2-normalised vectors = their dot product
        similarity = float(np.dot(query, stored))

        return {
            "verified": similarity >= self.similarity_threshold,
            "similarity": round(similarity, 6),
            "threshold": self.similarity_threshold,
        }
