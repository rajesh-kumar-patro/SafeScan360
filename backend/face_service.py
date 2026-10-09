"""Face detection + embedding + matching (OpenCV YuNet detector, SFace recognizer).

The service fails *closed*: if the ONNX models are missing/unloadable, ``ready()``
reports why and the workflow refuses to start - it never skips face verification.
"""
from __future__ import annotations

import threading
import time
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

DETECTOR_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/"
    "face_detection_yunet_2023mar.onnx"
)
RECOGNIZER_URL = (
    "https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/"
    "face_recognition_sface_2021dec.onnx"
)
MAX_SIDE = 1280


class FaceError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class FrameCheck:
    state: str                      # no_face | multiple | too_small | ok
    score: Optional[float] = None   # cosine similarity vs. reference (state == ok)
    matched: bool = False
    box: Optional[List[float]] = None  # normalised [x1, y1, x2, y2]
    person_id: Optional[int] = None    # best-matching registered person (1:N identification only)


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    a = np.asarray(a, dtype=np.float32).ravel()
    b = np.asarray(b, dtype=np.float32).ravel()
    na, nb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
    if na == 0 or nb == 0:
        return 0.0
    return float(np.dot(a, b) / (na * nb))


def _download(url: str, dest: Path, min_bytes: int = 100_000) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with urllib.request.urlopen(url, timeout=60) as resp, open(tmp, "wb") as fh:
        fh.write(resp.read())
    if tmp.stat().st_size < min_bytes:  # e.g. a git-lfs pointer or an HTML error page
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"Downloaded file from {url} is too small to be an ONNX model.")
    tmp.replace(dest)


class OpenCvFaceBackend:
    """YuNet (detect) + SFace (128-d embedding)."""

    name = "opencv-yunet-sface"

    def __init__(self, detector_path: Path, recognizer_path: Path, score_threshold: float):
        import cv2
        self._cv2 = cv2
        self.detector = cv2.FaceDetectorYN.create(str(detector_path), "", (320, 320), score_threshold, 0.3, 5000)
        self.recognizer = cv2.FaceRecognizerSF.create(str(recognizer_path), "")
        self._lock = threading.Lock()

    def detect(self, img: np.ndarray) -> List[Dict]:
        h, w = img.shape[:2]
        with self._lock:
            self.detector.setInputSize((w, h))
            _, faces = self.detector.detect(img)
        out = []
        for row in (faces if faces is not None else []):
            x, y, fw, fh = [float(v) for v in row[:4]]
            out.append({"box": (x, y, fw, fh), "score": float(row[-1]), "row": row})
        return out

    def embed(self, img: np.ndarray, face: Dict) -> np.ndarray:
        with self._lock:
            aligned = self.recognizer.alignCrop(img, face["row"])
            feat = self.recognizer.feature(aligned)
        return np.asarray(feat, dtype=np.float32).ravel()


class FaceService:
    def __init__(self, backend=None, detector_path: Path = None, recognizer_path: Path = None,
                 score_threshold: float = 0.85, match_threshold: float = 0.40, min_face_px: int = 80,
                 auto_download: bool = True):
        self._backend = backend
        self._detector_path = detector_path
        self._recognizer_path = recognizer_path
        self.score_threshold = score_threshold
        self.match_threshold = match_threshold
        self.min_face_px = min_face_px
        self.auto_download = auto_download
        self._error: Optional[str] = None
        self._last_attempt = 0.0
        self._lock = threading.Lock()

    # -- lifecycle ---------------------------------------------------------
    def _load(self) -> None:
        with self._lock:
            if self._backend is not None:
                return
            if time.time() - self._last_attempt < 30 and self._error:
                return  # don't hammer the network / disk on every frame
            self._last_attempt = time.time()
            try:
                for path, url in ((self._detector_path, DETECTOR_URL), (self._recognizer_path, RECOGNIZER_URL)):
                    if not path.is_file():
                        if not self.auto_download:
                            raise RuntimeError(f"Face model missing: {path}")
                        print(f"[FACE] Downloading {path.name} ...")
                        _download(url, path)
                self._backend = OpenCvFaceBackend(self._detector_path, self._recognizer_path, self.score_threshold)
                self._error = None
                print(f"[FACE] Loaded {self._backend.name}")
            except Exception as exc:  # noqa: BLE001 - reported through ready()
                self._error = (
                    f"Face verification models unavailable: {exc}. Place "
                    f"{getattr(self._detector_path, 'name', 'face_detection_yunet_2023mar.onnx')} and "
                    f"{getattr(self._recognizer_path, 'name', 'face_recognition_sface_2021dec.onnx')} in the models/ folder "
                    "(run `python scripts/download_face_models.py`)."
                )
                print(f"[FACE ERROR] {self._error}")

    def ready(self) -> Tuple[bool, str]:
        if self._backend is None:
            self._load()
        if self._backend is None:
            return False, self._error or "Face verification backend not loaded."
        return True, ""

    @property
    def embedder_name(self) -> str:
        return getattr(self._backend, "name", "unknown")

    # -- detection ---------------------------------------------------------
    @staticmethod
    def _prepare(img: np.ndarray) -> np.ndarray:
        import cv2
        h, w = img.shape[:2]
        scale = MAX_SIDE / max(h, w)
        if scale < 1:
            img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
        return img

    def _faces(self, img: np.ndarray):
        ok, reason = self.ready()
        if not ok:
            raise FaceError("FACE_SERVICE_UNAVAILABLE", reason)
        img = self._prepare(img)
        faces = [f for f in self._backend.detect(img) if f["score"] >= self.score_threshold]
        faces.sort(key=lambda f: f["box"][2] * f["box"][3], reverse=True)
        return img, faces

    @staticmethod
    def _norm_box(face: Dict, img: np.ndarray) -> List[float]:
        h, w = img.shape[:2]
        x, y, fw, fh = face["box"]
        return [max(0.0, x / w), max(0.0, y / h), min(1.0, (x + fw) / w), min(1.0, (y + fh) / h)]

    @staticmethod
    def _area(face: Dict) -> float:
        return face["box"][2] * face["box"][3]

    def _classify(self, faces: List[Dict]) -> str:
        if not faces:
            return "no_face"
        if len(faces) > 1 and self._area(faces[1]) >= 0.3 * self._area(faces[0]):
            return "multiple"
        if min(faces[0]["box"][2], faces[0]["box"][3]) < self.min_face_px:
            return "too_small"
        return "ok"

    @staticmethod
    def _unit(vec: np.ndarray) -> np.ndarray:
        n = float(np.linalg.norm(vec))
        return (vec / n).astype(np.float32) if n else vec.astype(np.float32)

    # -- public API --------------------------------------------------------
    def registration_embedding(self, img: np.ndarray) -> Tuple[np.ndarray, List[float]]:
        """Embedding for a registration photo; demands exactly one clear face."""
        img, faces = self._faces(img)
        state = self._classify(faces)
        if state == "no_face":
            raise FaceError("FACE_NOT_DETECTED", "No face was detected in the photo. Use a clear, front-facing photo.")
        if state == "multiple":
            raise FaceError("MULTIPLE_FACES", "More than one face was found. Upload a photo with only one person.")
        if state == "too_small":
            raise FaceError("FACE_TOO_SMALL", "The face is too small in the photo. Use a closer photo.")
        return self._unit(self._backend.embed(img, faces[0])), self._norm_box(faces[0], img)

    def check_frame(self, img: np.ndarray, reference: np.ndarray) -> FrameCheck:
        img, faces = self._faces(img)
        state = self._classify(faces)
        if not faces:
            return FrameCheck("no_face")
        box = self._norm_box(faces[0], img)
        if state != "ok":
            return FrameCheck(state, box=box)
        emb = self._unit(self._backend.embed(img, faces[0]))
        score = cosine_similarity(emb, reference)
        return FrameCheck("ok", score=round(score, 4), matched=score >= self.match_threshold, box=box)

    def identify_frame(self, img: np.ndarray, gallery: List[Dict]) -> FrameCheck:
        """1:N check: compare the face in ``img`` with every ``{"id", "embedding"}`` in ``gallery``.

        Read-only: nothing is registered or modified. ``matched`` is True only when the best
        cosine similarity reaches the match threshold; ``person_id`` is that best candidate.
        """
        img, faces = self._faces(img)
        state = self._classify(faces)
        if not faces:
            return FrameCheck("no_face")
        box = self._norm_box(faces[0], img)
        if state != "ok":
            return FrameCheck(state, box=box)
        emb = self._unit(self._backend.embed(img, faces[0]))
        best_id, best = None, -1.0
        for person in gallery:
            sim = cosine_similarity(emb, person["embedding"])
            if sim > best:
                best_id, best = person["id"], sim
        if best_id is None:
            return FrameCheck("ok", score=0.0, matched=False, box=box)
        return FrameCheck("ok", score=round(best, 4), matched=best >= self.match_threshold, box=box,
                          person_id=best_id)

    def face_present(self, img: np.ndarray) -> bool:
        """True when at least one confident face is visible (used to detect that a person left)."""
        try:
            _, faces = self._faces(img)
        except FaceError:
            return False
        return bool(faces)
