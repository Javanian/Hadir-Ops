"""
Face engine: YuNet finds faces, SFace turns one into an embedding
==================================================================
Both networks run on CPU through OpenCV's DNN module, which the API already
uses to decode photos, so face recognition needs no separate inference runtime.

The engine is created once at startup (lifespan) and shared by every request.
"""

import threading
from os import PathLike

import cv2
import numpy as np

from app.services.face_models import EMBEDDING_MODEL, ensure_model_files


class FaceEngine:
    model_id = EMBEDDING_MODEL

    def __init__(self, model_dir: str | PathLike, score_threshold: float = 0.9, download: bool = True):
        detector_path, recognizer_path = ensure_model_files(model_dir, download=download)
        # OpenCV 5 warns on every network it loads that the new graph engine
        # ignores target selection; CPU is what we want, so keep startup quiet.
        log_level = cv2.utils.logging.getLogLevel()
        cv2.utils.logging.setLogLevel(cv2.utils.logging.LOG_LEVEL_ERROR)
        try:
            # The input size is set per image in detect(); 0.3 is YuNet's NMS threshold.
            self._detector = cv2.FaceDetectorYN.create(str(detector_path), "", (320, 320), score_threshold, 0.3, 5000)
            self._recognizer = cv2.FaceRecognizerSF.create(str(recognizer_path), "")
        finally:
            cv2.utils.logging.setLogLevel(log_level)
        # The detector keeps the input size as state between calls, so requests
        # running in the thread pool take turns.
        self._lock = threading.Lock()

    def detect(self, img: np.ndarray) -> np.ndarray:
        """Faces in a BGR image, one row each: box, five landmarks and score."""
        h, w = img.shape[:2]
        with self._lock:
            self._detector.setInputSize((w, h))
            _, faces = self._detector.detect(img)
        return np.empty((0, 15), np.float32) if faces is None else faces

    def embed(self, img: np.ndarray, face: np.ndarray) -> np.ndarray:
        """L2-normalised 128-d embedding of one detected face, aligned on its landmarks."""
        with self._lock:
            feature = self._recognizer.feature(self._recognizer.alignCrop(img, face)).flatten()
        return (feature / np.linalg.norm(feature)).astype(np.float32)
