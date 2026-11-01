"""The real face engine (OpenCV YuNet + SFace) behind FaceService, on public-domain
NASA photos in tests/data.

The model files are downloaded on first use into FACE_MODEL_DIR (default
backend/models) and checked against their pinned SHA-256.
"""

import os
from pathlib import Path

import cv2
import numpy as np
import pytest
from fastapi import HTTPException

from app.services.face_engine import FaceEngine
from app.services.face_models import DETECTOR, RECOGNIZER, ensure_model_files
from app.services.face_service import FaceService

DATA = Path(__file__).parent / "data"
THRESHOLD = 0.363


@pytest.fixture(scope="module")
def engine():
    return FaceEngine(os.environ.get("FACE_MODEL_DIR", Path(__file__).parents[1] / "models"))


@pytest.fixture(scope="module")
def svc(engine):
    return FaceService(engine, similarity_threshold=THRESHOLD, max_width=640)


def _jpeg(img) -> bytes:
    return cv2.imencode(".jpg", img)[1].tobytes()


@pytest.fixture(scope="module")
def crew(engine):
    """The Apollo 11 crew photo and one crop per face, left to right:
    Armstrong, Collins, Aldrin."""
    img = cv2.imread(str(DATA / "apollo11_crew.jpg"))
    faces = sorted(engine.detect(img), key=lambda f: f[0])
    assert len(faces) == 3

    def crop(face, pad=80):
        x, y, w, h = (int(v) for v in face[:4])
        return _jpeg(img[max(0, y - pad):y + h + pad, max(0, x - pad):x + w + pad])

    return img, [crop(f) for f in faces]


def test_same_person_in_another_photo_matches(svc, crew):
    _, (armstrong, collins, aldrin_in_crew) = crew
    enrolled = svc.extract_embedding((DATA / "aldrin_portrait.jpg").read_bytes())
    assert len(enrolled) == 128

    same = svc.verify(aldrin_in_crew, enrolled)
    assert same["verified"] is True and same["similarity"] > 0.6

    for other in (armstrong, collins):
        result = svc.verify(other, enrolled)
        assert result["verified"] is False and result["similarity"] < THRESHOLD


def test_photo_with_several_faces_is_refused(svc, crew):
    img, _ = crew
    with pytest.raises(HTTPException) as exc:
        svc.extract_embedding(_jpeg(img))
    assert exc.value.status_code == 422


def test_photo_without_a_face_is_refused(svc):
    with pytest.raises(HTTPException) as exc:
        svc.extract_embedding(_jpeg(np.full((480, 640, 3), 128, np.uint8)))
    assert exc.value.status_code == 422


def test_embedding_from_another_model_is_refused(svc, crew):
    _, (_, _, aldrin_in_crew) = crew
    with pytest.raises(HTTPException) as exc:
        svc.verify(aldrin_in_crew, [0.1] * 512)  # e.g. a 512-d InsightFace embedding
    assert exc.value.status_code == 409


def test_altered_model_file_is_refused(tmp_path):
    (tmp_path / DETECTOR.name).write_bytes(b"not the pinned model")
    (tmp_path / RECOGNIZER.name).write_bytes(b"")
    with pytest.raises(RuntimeError, match="SHA-256"):
        ensure_model_files(tmp_path, download=False)


def test_missing_model_file_is_not_fetched_when_downloads_are_off(tmp_path):
    with pytest.raises(FileNotFoundError):
        ensure_model_files(tmp_path, download=False)
