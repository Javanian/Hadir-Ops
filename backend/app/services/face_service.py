"""
Face Recognition Service — Phase 3
===================================
Responsibilities:
  - Decode & resize images (max_width cap)
  - Detect faces via InsightFace (buffalo_s, CPU-only)
  - Reject 0 or >1 detected faces
  - Extract L2-normalised 512-d embeddings
  - Compute cosine similarity (dot-product of normalised vectors)
  - Threshold comparison for verification

The FaceAnalysis instance is created ONCE at app startup (lifespan) and
accessed here through dependency injection — never instantiated here.
"""

import cv2
import numpy as np
from fastapi import HTTPException, status


class FaceService:
    def __init__(self, face_app, similarity_threshold: float, max_width: int):
        self.face_app = face_app
        self.similarity_threshold = similarity_threshold
        self.max_width = max_width

    # ── Private helpers ────────────────────────────────────────────────────────

    def _decode_and_resize(self, image_bytes: bytes) -> np.ndarray:
        """Decode raw image bytes to a BGR ndarray and resize if needed."""
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
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
        Run InsightFace detection + recognition.
        Returns a float32 ndarray of shape (512,), already L2-normalised.
        Raises HTTP 422 if 0 or >1 faces are detected.
        """
        img = self._decode_and_resize(image_bytes)
        faces = self.face_app.get(img)

        if len(faces) == 0:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="No face detected in the image.",
            )
        if len(faces) > 1:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=(
                    f"Multiple faces detected ({len(faces)}). "
                    "Provide an image with exactly one face."
                ),
            )

        # normed_embedding is already L2-normalised by InsightFace
        return faces[0].normed_embedding.astype(np.float32)

    # ── Public API ─────────────────────────────────────────────────────────────

    def extract_embedding(self, image_bytes: bytes) -> list:
        """
        Extract a 512-d face embedding from image_bytes.
        Returns a plain Python list suitable for pgvector storage.
        """
        return self._extract_embedding(image_bytes).tolist()

    def verify(self, image_bytes: bytes, stored_embedding: list) -> dict:
        """
        Compare the face in image_bytes against a stored embedding.

        Args:
            image_bytes:      raw bytes of the query image (JPEG/PNG)
            stored_embedding: list of 512 floats retrieved from the DB

        Returns:
            {
                "verified":   bool,
                "similarity": float  (cosine similarity, -1..1),
                "threshold":  float
            }
        """
        query = self._extract_embedding(image_bytes)

        stored = np.array(stored_embedding, dtype=np.float32)
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
