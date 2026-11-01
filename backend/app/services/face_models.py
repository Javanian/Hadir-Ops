"""
Face model files, pinned by URL and SHA-256
============================================
Both networks come from the OpenCV model zoo, and their weights are published
under permissive licenses that allow commercial use:

  YuNet  (face detection)    MIT         opencv/opencv_zoo models/face_detection_yunet
  SFace  (face recognition)  Apache-2.0  opencv/opencv_zoo models/face_recognition_sface

The URLs name one opencv_zoo commit and every file is checked against the
SHA-256 recorded by Git LFS for that commit, so a changed upstream file is
refused rather than loaded.

    python -m app.services.face_models DIR    # download and verify (Docker build)

Standard library only, so the Docker build can run it before installing anything.
"""

import hashlib
import os
import sys
import tempfile
import urllib.request
from dataclasses import dataclass
from pathlib import Path

# Saved next to every embedding. Embeddings from different models cannot be
# compared, so a user enrolled with another model has to enrol again.
EMBEDDING_MODEL = "opencv-sface-2021dec"

_ZOO = "https://media.githubusercontent.com/media/opencv/opencv_zoo/48b10fa505aeb51fbd127fc60a5c660040e823b7/models"


@dataclass(frozen=True)
class ModelFile:
    name: str
    url: str
    sha256: str
    license: str


DETECTOR = ModelFile(
    name="face_detection_yunet_2026may.onnx",
    url=f"{_ZOO}/face_detection_yunet/face_detection_yunet_2026may.onnx",
    sha256="ebafce4e3c118d6554634be5c27ab333b4c047a9a8c3faf1d7cf93101c22f0f0",
    license="MIT",
)
RECOGNIZER = ModelFile(
    name="face_recognition_sface_2021dec.onnx",
    url=f"{_ZOO}/face_recognition_sface/face_recognition_sface_2021dec.onnx",
    sha256="0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    license="Apache-2.0",
)
MODEL_FILES = (DETECTOR, RECOGNIZER)


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(1 << 20):
            digest.update(chunk)
    return digest.hexdigest()


def _download(model: ModelFile, path: Path) -> None:
    """Download to a temporary file and move it into place only once the hash
    matches, so an interrupted or tampered download never leaves a model file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, suffix=".part")
    try:
        digest = hashlib.sha256()
        with os.fdopen(fd, "wb") as out, urllib.request.urlopen(model.url, timeout=60) as resp:
            while chunk := resp.read(1 << 20):
                digest.update(chunk)
                out.write(chunk)
        if digest.hexdigest() != model.sha256:
            raise RuntimeError(f"Download of {model.name} has SHA-256 {digest.hexdigest()}, expected {model.sha256}")
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def ensure_model_files(directory: str | os.PathLike, download: bool = True) -> tuple[Path, Path]:
    """Return the (detector, recognizer) paths in `directory`, downloading any
    missing file when `download` is true. Raises if a file's hash is wrong."""
    root = Path(directory).expanduser()
    paths = []
    for model in MODEL_FILES:
        path = root / model.name
        if not path.exists():
            if not download:
                raise FileNotFoundError(f"Face model file missing: {path}")
            _download(model, path)
        actual = _sha256(path)
        if actual != model.sha256:
            raise RuntimeError(
                f"{path} has SHA-256 {actual}, expected {model.sha256}. Delete it to download it again."
            )
        paths.append(path)
    return paths[0], paths[1]


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit("usage: python -m app.services.face_models DIR")
    for p in ensure_model_files(sys.argv[1]):
        print(f"ok  {p}")
