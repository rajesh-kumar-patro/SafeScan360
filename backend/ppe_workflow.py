"""PPE class mapping, multi-frame confirmation and compliance maths.

Pure Python (no cv2 / torch / FastAPI) so the safety-critical decision logic can
be unit-tested without a model or a camera.
"""
from __future__ import annotations

import re
from typing import Dict, Iterable, List, Optional

# The four items that decide work authorization, in display order.
REQUIRED_ITEMS = ("helmet", "vest", "shoes", "gloves")

# Application-level classes used by the workflow.
POSITIVE_CLASSES = REQUIRED_ITEMS
NEGATIVE_CLASSES = ("no_helmet", "no_vest", "no_shoes", "no_gloves")
APP_CLASSES = ("vest", "helmet", "shoes", "gloves", "no_vest", "no_helmet", "no_shoes", "no_gloves")

# Model class name (lower-case, separators removed) -> application class.
# Anything not listed (person, goggles, no_goggle ...) is ignored on purpose.
_ALIASES = {
    "helmet": "helmet", "hardhat": "helmet", "safetyhelmet": "helmet",
    "vest": "vest", "safetyvest": "vest", "highvis": "vest", "highvisvest": "vest", "hivisvest": "vest",
    "shoes": "shoes", "shoe": "shoes", "boots": "shoes", "boot": "shoes",
    "safetyshoes": "shoes", "safetyboots": "shoes", "footwear": "shoes",
    "gloves": "gloves", "glove": "gloves", "safetygloves": "gloves",
    "nohelmet": "no_helmet", "nohardhat": "no_helmet", "withouthelmet": "no_helmet",
    "novest": "no_vest", "nosafetyvest": "no_vest", "withoutvest": "no_vest", "nohighvis": "no_vest",
    "noshoes": "no_shoes", "noshoe": "no_shoes", "noboots": "no_shoes", "noboot": "no_shoes",
    "withoutshoes": "no_shoes", "withoutboots": "no_shoes", "nofootwear": "no_shoes",
    "nogloves": "no_gloves", "noglove": "no_gloves", "withoutgloves": "no_gloves",
}


def _key(name) -> str:
    return re.sub(r"[^a-z0-9]", "", str(name).lower())


def build_class_map(model_names: Dict[int, str]) -> Dict[int, str]:
    """Map the model's *actual* {class_id: name} onto application classes.

    Class IDs are never assumed - the map is derived from ``model.names``.
    """
    mapping: Dict[int, str] = {}
    for idx, name in model_names.items():
        app_class = _ALIASES.get(_key(name))
        if app_class:
            mapping[int(idx)] = app_class
    return mapping


def missing_required_classes(class_map: Dict[int, str]) -> List[str]:
    """Required positive classes the model cannot detect (workflow must fail closed)."""
    available = set(class_map.values())
    return [item for item in REQUIRED_ITEMS if item not in available]


def explicit_absence_classes(class_map: Dict[int, str]) -> List[str]:
    return [c for c in NEGATIVE_CLASSES if c in set(class_map.values())]


def compute_compliance(ppe: Dict[str, bool]) -> Dict:
    """PPE % = present items / 4 * 100. Only the four required items count."""
    present = sum(1 for item in REQUIRED_ITEMS if ppe.get(item) is True)
    total = len(REQUIRED_ITEMS)
    pct = round(present / total * 100, 1)
    pct = int(pct) if float(pct).is_integer() else pct
    absent = round(100 - pct, 1)
    absent = int(absent) if float(absent).is_integer() else absent
    return {
        "ppe_percentage": pct,
        "absent_percentage": absent,
        "present_count": present,
        "missing": [item for item in REQUIRED_ITEMS if ppe.get(item) is not True],
    }


def decide_authorization(face_verified: bool, ppe_available: bool, ppe: Optional[Dict[str, bool]]) -> bool:
    """FACE VERIFIED + ALL FOUR PPE ITEMS CONFIRMED = ALLOWED. Everything else = not allowed."""
    if face_verified is not True or ppe_available is not True or not ppe:
        return False
    return all(ppe.get(item) is True for item in REQUIRED_ITEMS)


# How far (in face widths) a detection's centre may be from the face centre, per item.
_BAND = {"helmet": 1.5, "vest": 2.5, "shoes": 3.0, "gloves": 4.0}


def associate_with_person(detections: List[Dict], face_box: Optional[List[float]]) -> List[Dict]:
    """Keep only PPE detections that plausibly belong to the person whose face is at ``face_box``.

    Boxes are normalised ``[x1, y1, x2, y2]``. A detection is kept when its centre is
    horizontally within a per-item band of face-widths around the face (helmet 1.5, vest 2.5,
    shoes 3, gloves 4 - hands move) and, vertically:
    helmet - not below the chin; vest - below the middle of the face; shoes - below the chin;
    gloves - anywhere (hands move). ``no_*`` classes follow their positive item. Without a
    face box nothing can be judged, so every detection is kept (never invents or removes items
    on its own authority).
    """
    if not face_box:
        return list(detections)
    fx1, fy1, fx2, fy2 = face_box
    fcx, fcy, fw = (fx1 + fx2) / 2, (fy1 + fy2) / 2, max(1e-6, fx2 - fx1)
    kept = []
    for d in detections:
        x1, y1, x2, y2 = d["box"]
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        item = d["item"][3:] if d["item"].startswith("no_") else d["item"]
        if abs(cx - fcx) > _BAND.get(item, 4.0) * fw:
            continue
        if item == "helmet" and cy > fy2:
            continue
        if item == "vest" and cy < fcy:
            continue
        if item == "shoes" and cy < fy2:
            continue
        kept.append(d)
    return kept


# ---------------------------------------------------------------------------
# Live PPE-absence alarm helpers (pure Python, no model / camera needed)
# ---------------------------------------------------------------------------
# How each required item is spoken: (spoken name, verb). Item keys are the project's own
# application classes (helmet / vest / shoes / gloves - the model's "boots" maps to "shoes").
SPOKEN_NAMES = {
    "helmet": ("helmet", "is"),
    "vest": ("safety vest", "is"),
    "shoes": ("safety shoes", "are"),
    "gloves": ("gloves", "are"),
}


def build_missing_ppe_message(missing: Iterable[str]) -> str:
    """Spoken warning for the given missing items, always in REQUIRED_ITEMS order.

    ["helmet"] -> "Warning. Helmet is missing."
    ["helmet", "gloves"] -> "Warning. Helmet and gloves are missing."
    Returns "" when nothing is missing.
    """
    wanted = set(missing)
    ordered = [i for i in REQUIRED_ITEMS if i in wanted]
    if not ordered:
        return ""
    names = [SPOKEN_NAMES[i][0] for i in ordered]
    if len(names) == 1:
        phrase, verb = names[0], SPOKEN_NAMES[ordered[0]][1]
    else:
        phrase, verb = ", ".join(names[:-1]) + " and " + names[-1], "are"
    return f"Warning. {phrase[0].upper()}{phrase[1:]} {verb} missing."


def summarize_ppe_status(workers: List[Dict]) -> Dict:
    """One compact status for the live UI, built from the tracker's per-worker results.

    status: NO_WORKER      - nobody in view
            CHECKING       - someone is still being assessed and nothing is missing yet
            PPE_MISSING    - at least one worker lacks at least one required item
            ALL_PPE_DETECTED
    ``missing`` is the union over the workers in view; ``detected`` is every required item that
    nobody is missing. ``announcement`` is the sentence the browser speaks ("" = stay silent) and
    ``signature`` changes only when the set of missing items changes (used for the cooldown).
    """
    active = [w for w in workers if not w.get("lost")]
    missing_set = set()
    for w in active:
        missing_set.update(i for i in w.get("missing", []) if i in REQUIRED_ITEMS)
    missing = [i for i in REQUIRED_ITEMS if i in missing_set]
    detected = [i for i in REQUIRED_ITEMS if i not in missing_set]
    if not active:
        status = "NO_WORKER"
    elif missing:
        status = "PPE_MISSING"
    elif any(w.get("checking") for w in active):
        status = "CHECKING"
    else:
        status = "ALL_PPE_DETECTED"
    return {
        "status": status,
        "missing": missing,
        "detected": detected if active else [],
        "required": list(REQUIRED_ITEMS),
        "announcement": build_missing_ppe_message(missing),
        "signature": "|".join(missing),
    }


class PpeTracker:
    """Confirms PPE items over consecutive frames.

    * An item is *present* only after ``confirm_frames`` consecutive frames that
      each contain it above the confidence threshold.
    * With a model that has explicit ``no_*`` classes, a confirmed ``no_*`` run
      overrides a positive (conservative: contradictory evidence => absent).
    * An item that is never confirmed inside the window is *absent*. Nothing is
      ever marked present just to reach 100%.
    """

    def __init__(self, confirm_frames: int, max_frames: int, has_negative_classes: Iterable[str] = ()):
        self.confirm_frames = max(1, confirm_frames)
        self.max_frames = max(self.confirm_frames, max_frames)
        self.negative_supported = set(has_negative_classes)
        self.frames = 0
        self.streak = {i: 0 for i in REQUIRED_ITEMS}
        self.neg_streak = {i: 0 for i in REQUIRED_ITEMS}
        self.present_confirmed = {i: False for i in REQUIRED_ITEMS}
        self.absent_confirmed = {i: False for i in REQUIRED_ITEMS}
        self.best_conf = {i: 0.0 for i in REQUIRED_ITEMS}

    def update(self, detections: List[Dict]) -> None:
        """``detections``: [{"item": app_class, "conf": float}], already above threshold."""
        self.frames += 1
        seen = {d["item"] for d in detections}
        for d in detections:
            if d["item"] in self.best_conf:
                self.best_conf[d["item"]] = max(self.best_conf[d["item"]], float(d["conf"]))
        for item in REQUIRED_ITEMS:
            self.streak[item] = self.streak[item] + 1 if item in seen else 0
            self.neg_streak[item] = self.neg_streak[item] + 1 if f"no_{item}" in seen else 0
            if self.streak[item] >= self.confirm_frames:
                self.present_confirmed[item] = True
            if self.neg_streak[item] >= self.confirm_frames:
                self.absent_confirmed[item] = True

    def item_state(self, item: str) -> str:
        if self.absent_confirmed[item]:
            return "absent"
        if self.present_confirmed[item]:
            return "present"
        return "absent" if self.finished and not self.present_confirmed[item] else "checking"

    @property
    def decided(self) -> bool:
        return all(self.present_confirmed[i] or self.absent_confirmed[i] for i in REQUIRED_ITEMS)

    @property
    def finished(self) -> bool:
        return self.decided or self.frames >= self.max_frames

    def result(self) -> Dict[str, bool]:
        return {i: bool(self.present_confirmed[i] and not self.absent_confirmed[i]) for i in REQUIRED_ITEMS}

    def progress(self) -> Dict[str, Dict]:
        return {
            i: {"state": self.item_state(i), "streak": self.streak[i], "needed": self.confirm_frames}
            for i in REQUIRED_ITEMS
        }
