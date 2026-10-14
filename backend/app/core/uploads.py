"""Bounded reads for uploaded images."""

from fastapi import HTTPException, UploadFile, status

from app.core.config import settings

_CHUNK = 64 * 1024


async def read_image_upload(file: UploadFile) -> bytes:
    """Read an uploaded photo, refusing anything over MAX_UPLOAD_BYTES.

    Reads in chunks so an oversized body is rejected after MAX_UPLOAD_BYTES
    instead of being held in memory in full.
    """
    limit = settings.MAX_UPLOAD_BYTES
    chunks, size = [], 0
    while chunk := await file.read(_CHUNK):
        size += len(chunk)
        if size > limit:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail=f"Image is larger than {limit // (1024 * 1024)} MB.",
            )
        chunks.append(chunk)
    if size == 0:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Empty image.")
    return b"".join(chunks)
