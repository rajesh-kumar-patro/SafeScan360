"""Person detection + persistent tracking for the live CP Plus stream.

Why this module exists
----------------------
``best.pt`` only knows four classes (helmet, vest, gloves, shoe). It has NO
``person`` class, so tracking people with it can never produce a box. This module
adds:

* ``PersonDetector``  - finds every person in a frame (YOLO ``person`` class, with
  an OpenCV HOG fallback if the YOLO weights cannot be loaded).
* ``PersonTracker``   - keeps a stable ``Track #ID`` for each person, for a single
  person or many people, with motion prediction, IoU + centre-distance matching
  and a short "lost" grace period so a box does not flicker.

The tracker is pure NumPy (no ultralytics tracker API), so it behaves the same on
every ultralytics version and does not interfere with the PPE model.
"""
from __future__ import annotations

from typing import Dict, List, Optional

import numpy as np


# ---------------------------------------------------------------------------
# Detector
# ---------------------------------------------------------------------------
class PersonDetector:
    """Returns ``[{"box": [x1,y1,x2,y2], "confidence": float}]`` for every person."""

    def __init__(self, model_path: str, device: str, conf: float = 0.35, imgsz: int = 640):
        self.device = device
        self.conf = conf
        self.imgsz = imgsz
        self.model = None
        self.person_class = 0
        self.backend = "none"
        self._hog = None
        self._load(model_path)

    def _load(self, model_path: str):
        try:
            from ultralytics import YOLO  # imported lazily so unit tests need no torch
            self.model = YOLO(model_path)  # auto-downloads yolov8n.pt on first run if absent
            names = self.model.names
            names = dict(names) if isinstance(names, dict) else {i: n for i, n in enumerate(names)}
            for idx, name in names.items():
                if str(name).lower().strip() == "person":
                    self.person_class = int(idx)
                    break
            self.backend = f"yolo:{model_path}"
            print(f"[PERSON] Loaded person detector {model_path} (class {self.person_class})")
        except Exception as exc:  # noqa: BLE001
            print(f"[PERSON] YOLO person model unavailable ({exc}); using OpenCV HOG fallback.")
            self._load_hog()

    def _load_hog(self):
        import cv2
        self._hog = cv2.HOGDescriptor()
        self._hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
        self.backend = "opencv-hog"

    def detect(self, frame: np.ndarray) -> List[Dict]:
        if frame is None or frame.size == 0:
            return []
        if self.model is not None:
            try:
                res = self.model.predict(
                    frame, imgsz=self.imgsz, conf=self.conf, classes=[self.person_class],
                    device=self.device, verbose=False,
                )[0]
                out = []
                if res.boxes is not None:
                    for b in res.boxes:
                        x1, y1, x2, y2 = [float(v) for v in b.xyxy[0].tolist()]
                        out.append({"box": [x1, y1, x2, y2], "confidence": float(b.conf[0].item())})
                return out
            except Exception as exc:  # noqa: BLE001
                print(f"[PERSON] YOLO inference failed ({exc}); switching to HOG fallback.")
                self.model = None
                self._load_hog()
        return self._detect_hog(frame)

    def _detect_hog(self, frame: np.ndarray) -> List[Dict]:
        import cv2
        if self._hog is None:
            self._load_hog()
        h, w = frame.shape[:2]
        scale = 640.0 / max(h, w) if max(h, w) > 640 else 1.0
        small = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale != 1.0 else frame
        rects, weights = self._hog.detectMultiScale(small, winStride=(8, 8), padding=(8, 8), scale=1.05)
        out = []
        for (x, y, rw, rh), wt in zip(rects, np.ravel(weights) if len(rects) else []):
            if float(wt) < 0.5:
                continue
            out.append({
                "box": [x / scale, y / scale, (x + rw) / scale, (y + rh) / scale],
                "confidence": min(0.99, float(wt) / 3.0),
            })
        return out


# ---------------------------------------------------------------------------
# Tracker
# ---------------------------------------------------------------------------
def iou_matrix(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Pairwise IoU between boxes a (N,4) and b (M,4), both x1y1x2y2."""
    if len(a) == 0 or len(b) == 0:
        return np.zeros((len(a), len(b)), dtype=np.float32)
    ix1 = np.maximum(a[:, None, 0], b[None, :, 0])
    iy1 = np.maximum(a[:, None, 1], b[None, :, 1])
    ix2 = np.minimum(a[:, None, 2], b[None, :, 2])
    iy2 = np.minimum(a[:, None, 3], b[None, :, 3])
    inter = np.clip(ix2 - ix1, 0, None) * np.clip(iy2 - iy1, 0, None)
    area_a = np.clip(a[:, 2] - a[:, 0], 0, None) * np.clip(a[:, 3] - a[:, 1], 0, None)
    area_b = np.clip(b[:, 2] - b[:, 0], 0, None) * np.clip(b[:, 3] - b[:, 1], 0, None)
    union = area_a[:, None] + area_b[None, :] - inter
    return (inter / np.maximum(union, 1e-6)).astype(np.float32)


class _Track:
    __slots__ = ("id", "box", "vel", "conf", "hits", "misses", "age", "confirmed")

    def __init__(self, tid: int, box, conf: float):
        self.id = tid
        self.box = np.asarray(box, dtype=np.float32)
        self.vel = np.zeros(4, dtype=np.float32)
        self.conf = conf
        self.hits = 1
        self.misses = 0
        self.age = 1
        self.confirmed = False

    def predict(self) -> np.ndarray:
        return self.box + self.vel * min(self.misses + 1, 5)

    def update(self, box, conf: float):
        box = np.asarray(box, dtype=np.float32)
        # smoothed velocity + lightly smoothed box -> steady, non-jittery frame
        self.vel = 0.6 * self.vel + 0.4 * (box - self.box)
        self.box = 0.35 * self.box + 0.65 * box
        self.conf = conf
        self.hits += 1
        self.misses = 0


class PersonTracker:
    """Greedy IoU/centre-distance tracker with persistent integer IDs.

    min_hits  : detections needed before a track is shown (1 = show immediately,
                so a single person gets a frame straight away).
    max_misses: frames a track survives without a detection (box keeps showing,
                marked ``lost``) before it is dropped.
    """

    def __init__(self, min_hits: int = 1, max_misses: int = 15, iou_threshold: float = 0.2,
                 max_center_dist: float = 0.6):
        self.min_hits = max(1, min_hits)
        self.max_misses = max(1, max_misses)
        self.iou_threshold = iou_threshold
        self.max_center_dist = max_center_dist   # in units of the track's box diagonal
        self.tracks: List[_Track] = []
        self._next_id = 1

    def reset(self):
        self.tracks = []
        self._next_id = 1

    @staticmethod
    def _centers(boxes: np.ndarray) -> np.ndarray:
        return np.stack([(boxes[:, 0] + boxes[:, 2]) / 2, (boxes[:, 1] + boxes[:, 3]) / 2], axis=1)

    def update(self, detections: List[Dict]) -> List[Dict]:
        """detections: [{"box": [x1,y1,x2,y2], "confidence": f}] -> active tracks."""
        det_boxes = np.array([d["box"] for d in detections], dtype=np.float32).reshape(-1, 4)
        det_conf = [float(d.get("confidence", 0.0)) for d in detections]

        for t in self.tracks:
            t.age += 1
        pred = np.array([t.predict() for t in self.tracks], dtype=np.float32).reshape(-1, 4)

        matched_t, matched_d = set(), set()
        if len(self.tracks) and len(det_boxes):
            iou = iou_matrix(pred, det_boxes)
            # centre-distance bonus lets fast movers / partially-overlapping boxes still match
            tc, dc = self._centers(pred), self._centers(det_boxes)
            diag = np.maximum(np.hypot(pred[:, 2] - pred[:, 0], pred[:, 3] - pred[:, 1]), 1.0)
            dist = np.linalg.norm(tc[:, None, :] - dc[None, :, :], axis=2) / diag[:, None]
            score = iou + np.where(dist < self.max_center_dist, (self.max_center_dist - dist) * 0.5, 0.0)
            valid = (iou >= self.iou_threshold) | (dist < self.max_center_dist * 0.5)
            score = np.where(valid, score, -1.0)
            pairs = sorted(
                ((score[i, j], i, j) for i in range(score.shape[0]) for j in range(score.shape[1]) if score[i, j] > 0),
                reverse=True,
            )
            for _, i, j in pairs:
                if i in matched_t or j in matched_d:
                    continue
                matched_t.add(i)
                matched_d.add(j)
                self.tracks[i].update(det_boxes[j], det_conf[j])

        for i, t in enumerate(self.tracks):
            if i not in matched_t:
                t.misses += 1
                t.box = t.predict() if t.misses <= 3 else t.box   # coast briefly on motion

        for j in range(len(det_boxes)):
            if j not in matched_d:
                self.tracks.append(_Track(self._next_id, det_boxes[j], det_conf[j]))
                self._next_id += 1

        self.tracks = [t for t in self.tracks if t.misses <= self.max_misses]

        out = []
        for t in self.tracks:
            if t.hits >= self.min_hits:
                t.confirmed = True
            if not t.confirmed:
                continue
            out.append({
                "track_id": t.id,
                "box": [int(round(v)) for v in t.box.tolist()],
                "confidence": round(float(t.conf), 3),
                "lost": t.misses > 0,
            })
        return out
