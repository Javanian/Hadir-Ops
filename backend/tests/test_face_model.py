"""The real InsightFace model behind FaceService, on InsightFace's own sample photo.

Skipped unless the `face` extra is installed (`uv sync --extra face`). The model
pack is downloaded on first use into INSIGHTFACE_HOME (default ~/.insightface).
"""

import os

import pytest
from fastapi import HTTPException

insightface = pytest.importorskip("insightface")
cv2 = pytest.importorskip("cv2")


@pytest.fixture(scope="module")
def model():
    from app.main import build_face_model

    return build_face_model("buffalo_s", root=os.environ.get("INSIGHTFACE_HOME"))


@pytest.fixture(scope="module")
def faces(model):
    from insightface.data import get_image

    img = get_image("t1")  # a group photo shipped with insightface
    found = sorted(model.get(img), key=lambda f: f.bbox[0])
    assert len(found) >= 2

    def crop(face, pad=60):
        x1, y1, x2, y2 = (int(v) for v in face.bbox)
        part = img[max(0, y1 - pad):y2 + pad, max(0, x1 - pad):x2 + pad]
        return cv2.imencode(".jpg", part)[1].tobytes()

    return img, crop(found[0]), crop(found[1])


def test_only_detection_and_recognition_are_loaded(model):
    assert sorted(model.models) == ["detection", "recognition"]


def test_same_person_matches_and_another_does_not(model, faces):
    from app.services.face_service import FaceService

    _, first, second = faces
    svc = FaceService(model, similarity_threshold=0.3, max_width=640)
    enrolled = svc.extract_embedding(first)
    assert len(enrolled) == 512
    assert svc.verify(first, enrolled)["verified"] is True
    other = svc.verify(second, enrolled)
    assert other["verified"] is False and other["similarity"] < 0.3


def test_photo_with_several_faces_is_refused(model, faces):
    from app.services.face_service import FaceService

    img, _, _ = faces
    svc = FaceService(model, similarity_threshold=0.3, max_width=640)
    with pytest.raises(HTTPException) as exc:
        svc.extract_embedding(cv2.imencode(".jpg", img)[1].tobytes())
    assert exc.value.status_code == 422
