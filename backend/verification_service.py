"""Server-side Face -> PPE -> Work-authorization state machine.

All authorization decisions are made here, never in the browser. A session moves
strictly ``face -> ppe -> done`` (or ``failed``); PPE frames are never evaluated
before the face has been verified, and ``work_allowed`` can only become True when
the face is verified AND all four required PPE items are confirmed.
"""
from __future__ import annotations

import threading
import time
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Dict, List, Optional

import numpy as np

from backend.face_service import FaceError
from backend.person_store import PersonStore, mask_mobile
from backend.ppe_workflow import (
    REQUIRED_ITEMS,
    PpeTracker,
    associate_with_person,
    compute_compliance,
    decide_authorization,
)


class WorkflowError(Exception):
    def __init__(self, code: str, message: str, http_status: int = 400):
        super().__init__(message)
        self.code, self.message, self.http_status = code, message, http_status


@dataclass
class VerifySettings:
    face_confirm_frames: int = 3
    face_max_frames: int = 30
    ppe_confidence: float = 0.50
    ppe_confirm_frames: int = 3
    ppe_max_frames: int = 30
    session_ttl: float = 180.0
    min_frame_interval: float = 0.10
    guard_threshold: float = 0.20
    guard_frames: int = 5
    max_sessions: int = 100
    unknown_frames: int = 8          # live 1:N mode: face seen but matching nobody for this many frames
    associate_ppe: bool = False      # (main.py enables it from config) keep only PPE detections that belong to the verified person


STATUS = {
    "DETECTING_FACE": ("Detecting Face", "info"),
    "FACE_FOUND": ("Face Found", "info"),
    "VERIFYING": ("Verifying Identity", "info"),
    "FACE_VERIFIED": ("Face Verified", "success"),
    "FACE_FAILED": ("Face Verification Failed", "error"),
    "UNKNOWN_PERSON": ("Unknown Person", "error"),
    "MULTIPLE_FACES": ("Multiple faces in view - only one person at a time", "warn"),
    "FACE_TOO_SMALL": ("Move closer to the camera", "warn"),
    "DETECTING_PPE": ("Detecting PPE", "info"),
    "WORK_AUTHORIZED": ("Work Authorized", "success"),
    "WORK_NOT_AUTHORIZED": ("Work Not Authorized", "error"),
    "FAILED": ("Verification Failed", "error"),
}


@dataclass
class Session:
    id: str
    person: Optional[Dict]          # None while a live (1:N) session has not identified anybody yet
    tracker: PpeTracker
    created: float
    last_seen: float
    last_counted: Optional[float] = None
    phase: str = "face"
    face_frames: int = 0
    face_seen: int = 0
    face_streak: int = 0
    face_scores: Optional[List[float]] = None
    face_verified: bool = False
    face_score: Optional[float] = None
    multiple_frames: int = 0
    mismatch_streak: int = 0
    face_box: Optional[List[float]] = None
    ppe_boxes: Optional[List[Dict]] = None
    status_code: str = "DETECTING_FACE"
    error: Optional[Dict] = None
    result: Optional[Dict] = None
    lock: Optional[threading.Lock] = None
    gallery: Optional[List[Dict]] = None   # live 1:N mode only: [{"id", "embedding", ...}] (server side)
    candidate_id: Optional[int] = None
    unknown_streak: int = 0


class VerificationService:
    def __init__(self, store: PersonStore, faces, ppe_detector: Callable, ppe_ready: Callable,
                 settings: VerifySettings = None, negative_classes=(),
                 on_unauthorized: Optional[Callable] = None,
                 photo_url: Callable[[str], str] = lambda f: f"/api/person-photos/{f}",
                 clock: Callable[[], float] = time.monotonic):
        self.store, self.faces = store, faces
        self.ppe_detector, self.ppe_ready = ppe_detector, ppe_ready
        self.settings = settings or VerifySettings()
        self.negative_classes = tuple(negative_classes)
        self.on_unauthorized = on_unauthorized
        self.photo_url = photo_url
        self.clock = clock
        self._sessions: Dict[str, Session] = {}
        self._lock = threading.Lock()

    # -- public helpers ----------------------------------------------------
    def person_public(self, person: Dict, full: bool = False) -> Dict:
        data = {"id": person["id"], "code": person["code"], "name": person["name"]}
        if full:
            data["mobile"] = person["mobile"]
            data["image"] = self.photo_url(person["photo_file"])
        else:
            data["mobile_masked"] = mask_mobile(person["mobile"])
        return data

    # -- session lifecycle -------------------------------------------------
    def _purge(self, now: float) -> None:
        for sid in [k for k, s in self._sessions.items() if now - s.last_seen > self.settings.session_ttl]:
            self._sessions.pop(sid, None)

    def start(self, person_id: Optional[int] = None) -> Dict:
        """Start a session. With ``person_id`` the camera face is compared with that one person (1:1);
        without it the face is compared with every registered worker (1:N, live detection)."""
        ok, reason = self.faces.ready()
        if not ok:
            raise WorkflowError("FACE_SERVICE_UNAVAILABLE", reason, 503)
        ok, reason = self.ppe_ready()
        if not ok:
            raise WorkflowError("PPE_MODEL_UNAVAILABLE", reason, 503)
        person, gallery = None, None
        if person_id is not None:
            person = self.store.get_person(int(person_id), with_embedding=True)
            if not person:
                raise WorkflowError("UNKNOWN_PERSON", "No registered person found. Register first.", 404)
            if person.get("embedder") != self.faces.embedder_name:
                raise WorkflowError(
                    "EMBEDDER_MISMATCH",
                    "This person was registered with a different face model. Please register again.", 409)
        else:
            # Read-only snapshot of the permanent registrations; the live system never writes to them.
            gallery = [p for p in self.store.all_embeddings() if p.get("embedder") == self.faces.embedder_name]
        now = self.clock()
        s = self.settings
        sess = Session(
            id=uuid.uuid4().hex, person=person, created=now, last_seen=now, face_scores=[], ppe_boxes=[],
            tracker=PpeTracker(s.ppe_confirm_frames, s.ppe_max_frames, self.negative_classes),
            lock=threading.Lock(), gallery=gallery,
        )
        with self._lock:
            self._purge(now)
            if len(self._sessions) >= s.max_sessions:
                raise WorkflowError("TOO_MANY_SESSIONS", "Too many active verification sessions. Try again shortly.", 429)
            self._sessions[sess.id] = sess
        snap = self._snapshot(sess)
        if person:
            snap["person"] = self.person_public(person)  # name + masked mobile only, until the face is verified
        return snap

    def drop_person_sessions(self, person_id: int) -> None:
        """Forget every session that holds this person's embedding (called when a worker is deleted)."""
        with self._lock:
            for sid in [k for k, v in self._sessions.items()
                        if (v.person and v.person["id"] == person_id)
                        or (v.gallery and any(g["id"] == person_id for g in v.gallery))]:
                self._sessions.pop(sid, None)

    def _get(self, session_id: str) -> Session:
        with self._lock:
            sess = self._sessions.get(session_id)
        if not sess:
            raise WorkflowError("SESSION_NOT_FOUND", "Verification session expired or not found. Start again.", 404)
        return sess

    def get_state(self, session_id: str) -> Dict:
        return self._snapshot(self._get(session_id))

    # -- frame processing --------------------------------------------------
    def process_frame(self, session_id: str, img: np.ndarray) -> Dict:
        sess = self._get(session_id)
        with sess.lock:
            now = self.clock()
            if sess.phase in ("done", "failed"):
                return self._snapshot(sess)
            if now - sess.created > self.settings.session_ttl:
                self._fail(sess, "SESSION_TIMEOUT", "Verification timed out. Please try again.")
                return self._snapshot(sess)
            sess.last_seen = now
            if sess.last_counted is not None and now - sess.last_counted < self.settings.min_frame_interval:
                snap = self._snapshot(sess)
                snap["throttled"] = True  # frames faster than the interval are not counted
                return snap
            sess.last_counted = now
            try:
                if sess.phase == "face":
                    (self._identify_step if sess.gallery is not None else self._face_step)(sess, img)
                else:
                    self._ppe_step(sess, img, now)
            except FaceError as exc:
                self._fail(sess, exc.code, exc.message)
            return self._snapshot(sess)

    def _face_step(self, s: Session, img: np.ndarray) -> None:
        cfg = self.settings
        s.face_frames += 1
        chk = self.faces.check_frame(img, s.person["embedding"])
        s.face_box = chk.box
        if chk.state == "no_face":
            s.face_streak, s.status_code = 0, "DETECTING_FACE"
        elif chk.state == "multiple":
            s.face_streak, s.status_code = 0, "MULTIPLE_FACES"
            s.multiple_frames += 1
        elif chk.state == "too_small":
            s.face_streak, s.status_code = 0, "FACE_TOO_SMALL"
        else:
            s.face_seen += 1
            if chk.matched:
                s.face_streak += 1
                s.face_scores.append(chk.score)
            else:
                s.face_streak = 0
                s.face_scores.clear()
            s.status_code = "FACE_FOUND" if s.face_seen == 1 else "VERIFYING"

        if s.face_streak >= cfg.face_confirm_frames:
            recent = s.face_scores[-cfg.face_confirm_frames:]
            s.face_verified = True
            s.face_score = round(float(sum(recent) / len(recent)), 4)
            s.phase, s.status_code = "ppe", "FACE_VERIFIED"
        elif s.face_frames >= cfg.face_max_frames:
            if s.face_seen == 0 and s.multiple_frames > 0:
                self._fail(s, "MULTIPLE_FACES", STATUS["MULTIPLE_FACES"][0])
            elif s.face_seen == 0:
                self._fail(s, "FACE_NOT_DETECTED",
                           "No face detected. Face the camera in good light and try again.")
            else:
                self._fail(s, "FACE_VERIFICATION_FAILED",
                           "Face does not match the registered person. Try again.")

    def _identify_step(self, s: Session, img: np.ndarray) -> None:
        """Live 1:N face step: the same person must win the comparison on N consecutive frames."""
        cfg = self.settings
        chk = self.faces.identify_frame(img, s.gallery)
        s.face_box = chk.box
        if chk.state in ("no_face", "too_small"):
            # Idle: nobody (usable) in front of the camera. Waiting is not a failure, so these frames
            # neither count towards the frame limit nor towards the session timeout.
            s.created = self.clock()
            s.face_streak, s.unknown_streak, s.candidate_id = 0, 0, None
            s.face_scores.clear()
            s.status_code = "DETECTING_FACE" if chk.state == "no_face" else "FACE_TOO_SMALL"
            return
        s.face_frames += 1
        if chk.state == "multiple":
            s.face_streak, s.status_code = 0, "MULTIPLE_FACES"
            s.multiple_frames += 1
        else:
            s.face_seen += 1
            if chk.matched:
                if chk.person_id == s.candidate_id:
                    s.face_streak += 1
                else:                      # a different best match: restart the confirmation
                    s.candidate_id, s.face_streak = chk.person_id, 1
                    s.face_scores.clear()
                s.face_scores.append(chk.score)
                s.unknown_streak = 0
            else:
                s.face_streak, s.candidate_id = 0, None
                s.face_scores.clear()
                s.unknown_streak += 1
            s.status_code = "FACE_FOUND" if s.face_seen == 1 else "VERIFYING"

        if s.face_streak >= cfg.face_confirm_frames:
            winner = next((g for g in s.gallery if g["id"] == s.candidate_id), None)
            if winner is not None:
                recent = s.face_scores[-cfg.face_confirm_frames:]
                s.person, s.face_verified = winner, True
                s.face_score = round(float(sum(recent) / len(recent)), 4)
                s.phase, s.status_code = "ppe", "FACE_VERIFIED"
                return
        if s.unknown_streak >= cfg.unknown_frames:
            self._fail(s, "UNKNOWN_PERSON", "Worker not registered.")
        elif s.face_frames >= cfg.face_max_frames:
            if s.face_seen == 0 and s.multiple_frames > 0:
                self._fail(s, "MULTIPLE_FACES", STATUS["MULTIPLE_FACES"][0])
            elif s.face_seen == 0:
                self._fail(s, "FACE_NOT_DETECTED", "No face detected. Face the camera in good light and try again.")
            elif s.unknown_streak > 0:
                self._fail(s, "UNKNOWN_PERSON", "Worker not registered.")
            else:
                self._fail(s, "FACE_VERIFICATION_FAILED", "Face verification failed. Please try again.")

    def _ppe_step(self, s: Session, img: np.ndarray, now: float) -> None:
        cfg = self.settings
        if s.status_code == "FACE_VERIFIED":
            s.status_code = "DETECTING_PPE"
        # Identity guard: someone clearly different stepping in after verification.
        try:
            chk = self.faces.check_frame(img, s.person["embedding"])
            if chk.box:
                s.face_box = chk.box          # latest face position (also used to tie PPE to this person)
            if chk.state == "ok":
                s.mismatch_streak = s.mismatch_streak + 1 if chk.score < cfg.guard_threshold else 0
        except FaceError:
            pass
        if s.mismatch_streak >= cfg.guard_frames:
            self._fail(s, "IDENTITY_CHANGED", "A different person was detected during PPE verification.")
            return
        try:
            detections = self.ppe_detector(img)
        except Exception as exc:  # noqa: BLE001
            print(f"[PPE ERROR] {exc}")
            self._fail(s, "PPE_MODEL_ERROR", "PPE detection failed. Work cannot be authorized.")
            return
        confirmed = [d for d in detections if d["conf"] >= cfg.ppe_confidence]
        if cfg.associate_ppe:
            confirmed = associate_with_person(confirmed, s.face_box)
        s.ppe_boxes = confirmed
        s.tracker.update(confirmed)
        if s.tracker.finished:
            self._finalize(s, img)

    # -- outcomes ----------------------------------------------------------
    def _fail(self, s: Session, code: str, message: str) -> None:
        s.phase = "failed"
        s.status_code = ("UNKNOWN_PERSON" if code == "UNKNOWN_PERSON" else
                         "FACE_FAILED" if code in {"FACE_VERIFICATION_FAILED", "FACE_NOT_DETECTED",
                                                   "MULTIPLE_FACES"} else "FAILED")
        s.error = {"code": code, "message": message}
        if s.person is not None:      # an unidentified (unknown) person is never written anywhere
            try:
                self.store.add_verification(s.person["id"], s.id, s.face_verified, s.face_score, None, None,
                                            None, False, f"FAILED:{code}")
            except Exception as exc:  # noqa: BLE001
                print(f"[DB ERROR] {exc}")
        s.result = {
            "person": self.person_public(s.person) if s.person else None,  # no photo / full mobile for an unverified face
            "face_verified": s.face_verified, "face_score": s.face_score,
            "ppe": None, "ppe_percentage": None, "absent_percentage": None, "missing": [],
            "work_allowed": False, "status": "UNKNOWN_PERSON" if code == "UNKNOWN_PERSON" else "VERIFICATION_FAILED",
            "error": s.error,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }

    def _finalize(self, s: Session, img: np.ndarray) -> None:
        ppe = s.tracker.result()
        comp = compute_compliance(ppe)
        allowed = decide_authorization(s.face_verified, True, ppe)
        status = "WORK_AUTHORIZED" if allowed else "WORK_NOT_AUTHORIZED"
        vid = None
        try:
            vid = self.store.add_verification(s.person["id"], s.id, s.face_verified, s.face_score, ppe,
                                              comp["ppe_percentage"], comp["missing"], allowed, status)
        except Exception as exc:  # noqa: BLE001
            print(f"[DB ERROR] {exc}")
        result = {
            "person": self.person_public(s.person, full=True),
            "face_verified": s.face_verified, "face_score": s.face_score,
            "ppe": ppe, "ppe_percentage": comp["ppe_percentage"], "absent_percentage": comp["absent_percentage"],
            "missing": comp["missing"], "work_allowed": allowed, "status": status,
            "no_ppe_detected": comp["present_count"] == 0,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "verification_id": vid, "email_alert": "not_required",
        }
        if not allowed and self.on_unauthorized:
            try:
                result["email_alert"] = self.on_unauthorized(result, s.person, img, s.ppe_boxes or [])
            except Exception as exc:  # noqa: BLE001 - alerting must never change the decision
                print(f"[ALERT ERROR] {exc}")
                result["email_alert"] = "error"
        s.result, s.phase, s.status_code = result, "done", status

    # -- response ----------------------------------------------------------
    def _snapshot(self, s: Session) -> Dict:
        text, level = STATUS.get(s.status_code, STATUS["FAILED"])
        if s.error:
            text = s.error["message"] if s.status_code == "FAILED" else text
        cfg = self.settings
        snap = {
            "session_id": s.id, "phase": s.phase,
            "status": {"code": s.status_code, "message": text, "level": level},
            "face": {
                "box": s.face_box, "verified": s.face_verified, "score": s.face_score,
                "streak": s.face_streak, "needed": cfg.face_confirm_frames,
                "frames": s.face_frames, "max_frames": cfg.face_max_frames,
            },
            "ppe": None, "person": None, "result": s.result, "error": s.error,
        }
        if s.face_verified:  # identity details are only shown after a successful face match
            snap["person"] = self.person_public(s.person, full=True)
            snap["ppe"] = {
                "progress": s.tracker.progress(), "frames": s.tracker.frames, "max_frames": s.tracker.max_frames,
                "boxes": [{"item": d["item"], "conf": round(d["conf"], 3), "box": d["box"]}
                          for d in (s.ppe_boxes or [])],
            }
        return snap
