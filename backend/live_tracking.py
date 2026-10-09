"""Live multi-worker tracking for SafeScan360.

Fixed version. What was wrong before
------------------------------------
* ``best.pt`` has no ``person`` class (only helmet / vest / gloves / shoe), so the old
  tracker found zero people and never drew a tracking frame, for one person or many.
* It also called ``ppe_model.track()`` and ``ppe_model.predict()`` on the same model, which
  fed every frame to ByteTrack twice and scrambled the IDs.
* Face crops were taken from a frame that had already been drawn on.

What it does now
----------------
* ``PersonDetector`` (COCO person class) finds every person; ``PersonTracker`` gives each one a
  stable ``Track #ID``. A tracking frame is drawn for a single person or any number of people.
* PPE items from ``best.pt`` are assigned to the person they belong to (head / torso / hands / feet).
* Registered workers are identified from the head region of each track (read-only face matching).
* Fire / smoke detection and the existing event format are unchanged.
"""
from __future__ import annotations

import time
from typing import Dict, List, Optional

import cv2
import numpy as np

from backend.config import (
    PERSON_CONFIDENCE,
    PERSON_IMG_SIZE,
    PERSON_MODEL,
    TRACK_FACE_INTERVAL_FRAMES,
    TRACK_MAX_LOST_FRAMES,
    TRACK_MIN_HITS,
)
from backend.person_tracker import PersonDetector, PersonTracker
from backend.ppe_workflow import REQUIRED_ITEMS, summarize_ppe_status

# engine class key -> required item name
_PPE_KEY_TO_ITEM = {"helmet": "helmet", "vest": "vest", "gloves": "gloves", "boots": "shoes"}
_PPE_NEG_TO_ITEM = {"no_helmet": "helmet", "no_vest": "vest", "no_gloves": "gloves", "no_boots": "shoes"}

# vertical band of the person box (0 = head, 1 = feet) where each item is expected
_ITEM_BANDS = {
    "helmet": (-0.10, 0.36),
    "vest": (0.12, 0.78),
    "gloves": (0.15, 0.95),
    "shoes": (0.62, 1.12),
}


class MultiWorkerTracker:
    def __init__(self, engine, faces, store, confirm_frames: int = 3,
                 absence_frames: int = 6, identity_frames: int = 2):
        self.engine = engine
        self.faces = faces
        self.store = store
        self.confirm_frames = max(1, confirm_frames)
        self.absence_frames = max(3, absence_frames)
        self.identity_frames = max(1, identity_frames)
        self.face_interval = TRACK_FACE_INTERVAL_FRAMES
        self.track_state: Dict[int, Dict] = {}
        self.frame_no = 0
        self.gallery: List[Dict] = []
        self._gallery_frame = -999
        self.enabled = True
        self.detector = PersonDetector(
            PERSON_MODEL, engine.device, conf=PERSON_CONFIDENCE, imgsz=PERSON_IMG_SIZE
        )
        self.tracker = PersonTracker(min_hits=TRACK_MIN_HITS, max_misses=TRACK_MAX_LOST_FRAMES)

    # ------------------------------------------------------------------ state
    def reset(self):
        self.track_state.clear()
        self.frame_no = 0
        self.gallery = []
        self._gallery_frame = -999
        self.tracker.reset()

    def _refresh_gallery(self):
        try:
            self.gallery = [
                p for p in self.store.all_embeddings()
                if p.get("embedder") == self.faces.embedder_name
            ]
        except Exception as exc:  # noqa: BLE001
            print(f"[TRACK] gallery refresh failed: {exc}")
        self._gallery_frame = self.frame_no

    # ---------------------------------------------------------------- helpers
    @staticmethod
    def _zone(cx, cy):
        col = "left" if cx < 0.34 else "center" if cx < 0.67 else "right"
        row = "top" if cy < 0.34 else "middle" if cy < 0.67 else "bottom"
        return f"{row}-{col}"

    @staticmethod
    def _in_band(det_box, person_box, band) -> bool:
        px1, py1, px2, py2 = person_box
        pw, ph = max(1, px2 - px1), max(1, py2 - py1)
        cx = (det_box[0] + det_box[2]) / 2
        cy = (det_box[1] + det_box[3]) / 2
        if not (px1 - 0.15 * pw <= cx <= px2 + 0.15 * pw):
            return False
        return py1 + band[0] * ph <= cy <= py1 + band[1] * ph

    def _assign_ppe(self, persons: List[Dict], ppe_dets: List[Dict]):
        """Give every detected PPE item to the single person it belongs to."""
        found = {p["track_id"]: {item: False for item in REQUIRED_ITEMS} for p in persons}
        explicit_missing = {p["track_id"]: set() for p in persons}
        for det in ppe_dets:
            key = det["class"]
            positive = _PPE_KEY_TO_ITEM.get(key)
            negative = _PPE_NEG_TO_ITEM.get(key)
            item = positive or negative
            if item is None:
                continue
            band = _ITEM_BANDS[item]
            dcx = (det["box"][0] + det["box"][2]) / 2
            best, best_d = None, None
            for p in persons:
                if not self._in_band(det["box"], p["box"], band):
                    continue
                pcx = (p["box"][0] + p["box"][2]) / 2
                d = abs(dcx - pcx)
                if best_d is None or d < best_d:
                    best, best_d = p, d
            if best is None:
                continue
            if positive:
                found[best["track_id"]][item] = True
            else:
                explicit_missing[best["track_id"]].add(item)
        return found, explicit_missing

    def _identity(self, clean_frame, track):
        tid = track["track_id"]
        state = self.track_state[tid]
        if track.get("lost"):
            return state
        if self.frame_no - state["last_face_frame"] < self.face_interval:
            return state
        state["last_face_frame"] = self.frame_no
        if not self.gallery:
            return state
        x1, y1, x2, y2 = track["box"]
        h, w = clean_frame.shape[:2]
        bw, bh = max(1, x2 - x1), max(1, y2 - y1)
        # Face lives in the head region (top of the person box), not the whole body.
        hx1 = max(0, int(x1 - 0.10 * bw))
        hx2 = min(w, int(x2 + 0.10 * bw))
        hy1 = max(0, int(y1 - 0.05 * bh))
        hy2 = min(h, int(y1 + 0.45 * bh))
        crop = clean_frame[hy1:hy2, hx1:hx2]
        if crop.size == 0:
            return state
        ch = crop.shape[0]
        if ch < 320:  # small CCTV head -> upscale so the face detector can see it
            scale = min(4.0, 320.0 / max(1, ch))
            crop = cv2.resize(crop, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        try:
            chk = self.faces.identify_frame(crop, self.gallery)
        except Exception:
            return state
        if chk.matched and chk.person_id is not None:
            if chk.person_id == state["candidate_id"]:
                state["streak"] += 1
            else:
                state["candidate_id"] = chk.person_id
                state["streak"] = 1
            state["face_score"] = chk.score
            if state["streak"] >= self.identity_frames:
                state["person"] = self.store.get_person(chk.person_id)
        else:
            state["candidate_id"] = None
            state["streak"] = 0
            # A previously confirmed identity is kept through a bad face frame.
        return state

    @staticmethod
    def _draw_track(img, box, color, label):
        x1, y1, x2, y2 = box
        h, w = img.shape[:2]
        x1, y1 = max(0, x1), max(0, y1)
        x2, y2 = min(w - 1, x2), min(h - 1, y2)
        cv2.rectangle(img, (x1, y1), (x2, y2), color, 3)
        # corner accents make the tracking frame easy to see on a busy picture
        cl = max(12, min(40, (x2 - x1) // 5))
        for (sx, sy, dx, dy) in ((x1, y1, 1, 1), (x2, y1, -1, 1), (x1, y2, 1, -1), (x2, y2, -1, -1)):
            cv2.line(img, (sx, sy), (sx + dx * cl, sy), color, 6)
            cv2.line(img, (sx, sy), (sx, sy + dy * cl), color, 6)
        (tw, th), _ = cv2.getTextSize(label, cv2.FONT_HERSHEY_SIMPLEX, 0.52, 2)
        top = y1 - th - 10
        if top < 0:                       # no room above the box -> put the label inside it
            top = y1
        cv2.rectangle(img, (x1, top), (min(w - 1, x1 + tw + 10), top + th + 10), color, -1)
        cv2.putText(img, label, (x1 + 5, top + th + 3), cv2.FONT_HERSHEY_SIMPLEX, 0.52,
                    (255, 255, 255), 2, cv2.LINE_AA)

    # ----------------------------------------------------------------- process
    def process(self, frame):
        self.frame_no += 1
        if self.frame_no - self._gallery_frame >= 30 or (not self.gallery and self.frame_no % 10 == 0):
            self._refresh_gallery()

        clean = frame.copy()                      # untouched copy for face matching
        # Existing engine = PPE items + fire/smoke. It draws on the frame it is given.
        annotated, base = self.engine.process_frame(frame)
        ppe_dets = base.pop("ppe_detections", [])

        detections = self.detector.detect(clean)
        tracked = self.tracker.update(detections)

        h, w = clean.shape[:2]
        found, explicit_missing = self._assign_ppe(tracked, ppe_dets)

        active_ids = set()
        workers = []
        for track in tracked:
            tid = track["track_id"]
            active_ids.add(tid)
            state = self.track_state.setdefault(tid, {
                "candidate_id": None, "streak": 0, "person": None, "face_score": None,
                "last_face_frame": -999, "frames": 0, "gone": 0,
                "ppe_missing_streak": {item: 0 for item in REQUIRED_ITEMS},
            })
            state["gone"] = 0
            lost = bool(track.get("lost"))
            if not lost:
                state["frames"] += 1
            self._identity(clean, track)

            ppe_now = found[tid]
            hist = state["ppe_missing_streak"]
            if not lost:   # no evidence while the box is only coasting
                for item in REQUIRED_ITEMS:
                    if ppe_now[item]:
                        hist[item] = 0
                    else:
                        hist[item] += 1

            # An item counts as present unless it has been absent for several frames in a row.
            ppe = {item: hist[item] < self.absence_frames for item in REQUIRED_ITEMS}
            missing = [item for item in REQUIRED_ITEMS if not ppe[item]]
            for item in explicit_missing[tid]:
                if not ppe_now[item] and item not in missing:
                    missing.append(item)
                    ppe[item] = False
            checking = state["frames"] < self.absence_frames and not all(ppe_now.values()) and not missing
            compliant = len(missing) == 0
            person = state.get("person")
            name = person.get("name") if person else "Unknown"
            worker_code = person.get("code") if person else None
            mobile = person.get("mobile") if person else None
            x1, y1, x2, y2 = track["box"]
            cx = ((x1 + x2) / 2) / max(1, w)
            cy = ((y1 + y2) / 2) / max(1, h)
            zone = self._zone(cx, cy)

            workers.append({
                "track_id": tid,
                "worker_id": worker_code,
                "worker_name": name,
                "mobile": mobile,
                "verified": bool(person),
                "face_score": state.get("face_score"),
                "box": track["box"],
                "confidence": track["confidence"],
                "lost": lost,
                "position": {"x": round(cx, 4), "y": round(cy, 4)},
                "zone": zone,
                **ppe,
                "boots": ppe["shoes"],          # legacy key used by older UI code
                "missing": missing,
                "checking": checking,
                "compliant": compliant,
                "risk": "LOW" if compliant else "HIGH" if len(missing) >= 2 else "MEDIUM",
            })

            if checking:
                color, status = (200, 160, 40), "CHECKING PPE"
            elif compliant:
                color, status = (70, 200, 70), "SAFE"
            else:
                color, status = (0, 90, 255), "MISSING: " + ",".join(m.title() for m in missing)
            label = f"#{tid} {name if person else 'UNKNOWN'} | {status}"
            self._draw_track(annotated, track["box"], color, label[:80])

        # Forget tracks that disappeared (after a grace period).
        for tid in list(self.track_state):
            if tid not in active_ids:
                self.track_state[tid]["gone"] += 1
                if self.track_state[tid]["gone"] > 30:
                    self.track_state.pop(tid, None)

        events = []
        for w_ in workers:
            if not w_["compliant"] and not w_["lost"]:
                events.append({
                    "type": "PPE_VIOLATION",
                    "severity": "HIGH" if len(w_["missing"]) >= 2 else "MEDIUM",
                    "message": f"{w_['worker_name']} (Track #{w_['track_id']}): missing {', '.join(w_['missing'])}",
                    "missing": w_["missing"],
                    "track_id": w_["track_id"],
                    "worker_id": w_["worker_id"] or f"TRACK-{w_['track_id']}",
                    "worker_name": w_["worker_name"],
                    "mobile": w_["mobile"],
                    "zone": w_["zone"],
                    "position": w_["position"],
                    "timestamp": time.strftime("%H:%M:%S"),
                })

        events.extend(base.get("events", []))   # fire / smoke events from the base engine
        n = len(workers)
        n_ok = sum(1 for x in workers if x["compliant"])
        base["workers"] = workers
        base["total_workers"] = n
        base["compliant"] = n_ok
        base["violations"] = n - n_ok
        base["compliance_pct"] = f"{(n_ok / n) * 100:.1f}%" if n else "0%"
        base["events"] = events
        base["tracking_enabled"] = True
        # Missing-PPE summary + spoken sentence for the browser's voice alarm (cheap: a few list ops,
        # no speech generation here - the browser speaks it, with its own cooldown).
        base["ppe_status"] = summarize_ppe_status(workers)
        base["person_detector"] = self.detector.backend
        base["registered_workers_in_view"] = sum(1 for x in workers if x["verified"])
        base["unknown_workers"] = sum(1 for x in workers if not x["verified"])
        base["tracking"] = {
            "active_tracks": n,
            "workers": workers,
            "camera_map": [
                {"track_id": x["track_id"], "name": x["worker_name"], "verified": x["verified"],
                 "zone": x["zone"], "x": x["position"]["x"], "y": x["position"]["y"], "risk": x["risk"]}
                for x in workers
            ],
        }
        return annotated, base
