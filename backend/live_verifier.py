"""Live (camera-driven) worker verification: face identification -> PPE -> result -> next person.

``LiveVerifier`` drives one VerificationService session at a time from a stream of camera
frames. It never registers anybody: the face is only compared with the permanent worker
registrations (read-only) and an unknown face simply ends the session as UNKNOWN PERSON.

After a result (verified + PPE outcome, or unknown / failed) it keeps the result on screen
until the person has left the camera view (no face for ``leave_seconds``) and at least
``min_hold`` seconds have passed, then starts a new session for the next person. This stops a
worker standing in front of the camera from generating an endless stream of alerts and e-mails.
"""
from __future__ import annotations

import threading
import time
from typing import Callable, Dict, Optional

import cv2
import numpy as np

from backend.verification_service import VerificationService, WorkflowError

PPE_ITEMS = ("helmet", "vest", "shoes", "gloves")
GREEN, BLUE, RED, AMBER, WHITE = (80, 200, 60), (235, 130, 40), (60, 60, 230), (30, 170, 245), (255, 255, 255)


class LiveVerifier:
    def __init__(self, service: VerificationService, faces, min_hold: float = 5.0, leave_seconds: float = 3.0,
                 clock: Callable[[], float] = time.monotonic):
        self.service, self.faces, self.clock = service, faces, clock
        self.min_hold, self.leave_seconds = min_hold, leave_seconds
        self._lock = threading.Lock()
        self.sid: Optional[str] = None
        self.snapshot: Optional[Dict] = None
        self.last_result: Optional[Dict] = None
        self.error: Optional[Dict] = None
        self.waiting_for_exit = False
        self._finished_at: Optional[float] = None
        self._absent_since: Optional[float] = None
        self._next = False
        self._retry_at = 0.0

    # -- control -----------------------------------------------------------
    def request_next(self) -> None:
        """Operator pressed 'Next person': start a fresh session on the next frame."""
        with self._lock:
            self._next = True

    def reset(self) -> None:
        with self._lock:
            self.sid, self.snapshot, self.error = None, None, None
            self.waiting_for_exit, self._finished_at, self._absent_since, self._next = False, None, None, False

    # -- per-frame ----------------------------------------------------------
    def step(self, frame: np.ndarray) -> Optional[Dict]:
        with self._lock:
            now = self.clock()
            if self._next:
                self.sid, self.waiting_for_exit, self._finished_at, self._absent_since = None, False, None, None
                self._next, self.snapshot = False, None
            if self.sid is None:
                if now < self._retry_at:
                    return self.snapshot
                try:
                    first = self.service.start(None)
                    self.sid, self.error, self.snapshot = first["session_id"], None, first
                except WorkflowError as exc:
                    self.error = {"code": exc.code, "message": exc.message}
                    self._retry_at = now + 2.0
                    return self.snapshot
            try:
                snap = self.service.process_frame(self.sid, frame)
            except WorkflowError as exc:                     # session expired / purged: start again
                self.sid, self.snapshot = None, None
                self.error = {"code": exc.code, "message": exc.message}
                self._retry_at = now + 0.5
                return None
            self.snapshot = snap
            if snap["phase"] in ("done", "failed"):
                if self._finished_at is None:
                    self._finished_at, self._absent_since = now, None
                    self.last_result = {"phase": snap["phase"], "status": snap["status"],
                                        "person": snap.get("person"), "result": snap.get("result"),
                                        "error": snap.get("error")}
                self.waiting_for_exit = True
                if self.faces.face_present(frame):
                    self._absent_since = None
                elif self._absent_since is None:
                    self._absent_since = now
                if (now - self._finished_at >= self.min_hold and self._absent_since is not None
                        and now - self._absent_since >= self.leave_seconds):
                    self.sid, self.waiting_for_exit, self._finished_at, self._absent_since = None, False, None, None
            return snap

    def public_state(self) -> Dict:
        with self._lock:
            return {"snapshot": self.snapshot, "last_result": self.last_result, "error": self.error,
                    "waiting_for_exit": self.waiting_for_exit}


# -- drawing --------------------------------------------------------------
def _box_px(box, w, h):
    return int(box[0] * w), int(box[1] * h), int(box[2] * w), int(box[3] * h)


def _label(img, text, x, y, color):
    (tw, th), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 2)
    y = max(th + 6, y)
    cv2.rectangle(img, (x, y - th - 6), (x + tw + 8, y + 2), color, -1)
    cv2.putText(img, text, (x + 4, y - 3), cv2.FONT_HERSHEY_SIMPLEX, 0.55, WHITE, 2, cv2.LINE_AA)


def annotate(frame: np.ndarray, snap: Optional[Dict]) -> np.ndarray:
    """Draw face box, PPE boxes and a status banner on a copy of ``frame``."""
    out = frame.copy()
    if not snap:
        return out
    h, w = out.shape[:2]
    status = snap.get("status") or {}
    code = status.get("code", "")
    verified = bool((snap.get("face") or {}).get("verified"))
    unknown = code == "UNKNOWN_PERSON"
    box = (snap.get("face") or {}).get("box")
    if box:
        x1, y1, x2, y2 = _box_px(box, w, h)
        color = GREEN if verified else RED if (unknown or code == "FACE_FAILED") else BLUE
        cv2.rectangle(out, (x1, y1), (x2, y2), color, 3)
        name = (snap.get("person") or {}).get("name") if verified else None
        _label(out, f"{name} - VERIFIED" if name else "UNKNOWN PERSON" if unknown else "FACE", x1, y1 - 4, color)
    ppe = snap.get("ppe") or {}
    for d in ppe.get("boxes", []):
        x1, y1, x2, y2 = _box_px(d["box"], w, h)
        cv2.rectangle(out, (x1, y1), (x2, y2), AMBER, 2)
        _label(out, f"{d['item'].upper()} {int(d['conf'] * 100)}%", x1, y1 - 4, AMBER)
    banner = status.get("message", "")
    result = snap.get("result")
    if result and result.get("ppe") is not None:
        banner = f"{result['ppe_percentage']}% PPE - " + ("COMPLIANT" if result["work_allowed"] else
                                                        "MISSING: " + ", ".join(m.upper() for m in result["missing"]))
    bcolor = GREEN if (result and result.get("work_allowed")) else RED if (unknown or result or code == "FACE_FAILED") else BLUE
    cv2.rectangle(out, (0, 0), (w, 30), bcolor, -1)
    cv2.putText(out, banner[:70], (8, 21), cv2.FONT_HERSHEY_SIMPLEX, 0.6, WHITE, 2, cv2.LINE_AA)
    progress = ppe.get("progress")
    if progress:
        x = 8
        for item in PPE_ITEMS:
            state = (progress.get(item) or {}).get("state")
            mark, c = {"present": ("OK", GREEN), "absent": ("MISSING", RED)}.get(state, ("...", BLUE))
            text = f"{item.upper()} {mark}"
            (tw, _), _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2)
            cv2.rectangle(out, (x - 4, h - 28), (x + tw + 4, h - 6), c, -1)
            cv2.putText(out, text, (x, h - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.5, WHITE, 2, cv2.LINE_AA)
            x += tw + 16
    return out
