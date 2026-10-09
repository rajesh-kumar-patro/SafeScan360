"""
face_box.py  -  smooth, moving face-detection box for the live MJPEG stream.

Why this lives in the backend:
    The camera is an MJPEG <img> in the browser. The only way for the box to
    move together with the face (with no lag) is to draw it on every frame
    before the frame is encoded and streamed.

How to use (inside your existing stream generator):

    from face_box import FaceBox, draw_face_box

    face_box = FaceBox()                       # create once per stream

    while True:
        ok, frame = cap.read()
        ...
        det = detect_face(frame)               # YOUR detector -> (x, y, w, h) or None
        box = face_box.update(det)             # smoothed box or None

        if verified:
            color, label = (0, 200, 0), person_name        # green
        elif box is not None:
            color, label = (255, 140, 0), "Verifying..."   # blue-ish (BGR)
        else:
            color, label = None, ""

        draw_face_box(frame, box, color, label)

        # expose to /api/live-verify/state so the frontend can stop the
        # warning sound when the worker walks away:
        live_state["face_present"] = face_box.present()

        ... encode frame as JPEG and yield it ...
"""

import time

import cv2


class FaceBox:
    def __init__(self, alpha=0.4, hold_seconds=0.4):
        """
        alpha        smoothing: 0.2 = very smooth/slow, 0.6 = snappy.
        hold_seconds keep drawing the last box for this long after a missed
                     detection, so the box does not flicker.
        """
        self.alpha = alpha
        self.hold = hold_seconds
        self.box = None          # smoothed (x, y, w, h) as floats
        self.last_seen = 0.0

    def update(self, detected):
        """detected: (x, y, w, h) in frame pixels, or None. Returns smoothed box or None."""
        now = time.time()

        if detected is not None:
            new = tuple(float(v) for v in detected)
            if self.box is None:
                self.box = new
            else:
                a = self.alpha
                self.box = tuple(a * n + (1 - a) * o for n, o in zip(new, self.box))
            self.last_seen = now
        elif self.box is not None and now - self.last_seen > self.hold:
            self.box = None

        return self.box

    def present(self):
        """True while a face is (recently) in front of the camera."""
        return self.box is not None


def pick_largest(faces):
    """Choose the biggest face when several are detected. faces: list of (x, y, w, h)."""
    if not faces:
        return None
    return max(faces, key=lambda f: f[2] * f[3])


def draw_face_box(frame, box, color, label=""):
    """Corner-bracket box that follows the face. Does nothing if box/color is None."""
    if box is None or color is None:
        return

    x, y, w, h = (int(v) for v in box)
    arm = max(14, w // 5)          # length of each corner bracket
    t = 3                          # line thickness

    corners = [
        (x,     y,     1,  1),
        (x + w, y,    -1,  1),
        (x,     y + h, 1, -1),
        (x + w, y + h, -1, -1),
    ]
    for px, py, dx, dy in corners:
        cv2.line(frame, (px, py), (px + dx * arm, py), color, t)
        cv2.line(frame, (px, py), (px, py + dy * arm), color, t)

    if label:
        cv2.putText(
            frame, label, (x, max(22, y - 10)),
            cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2, cv2.LINE_AA,
        )


# ------------------------------------------------------------------
# Optional: fast detection helper (OpenCV Haar) if you don't already
# have a detector returning (x, y, w, h). If you use InsightFace /
# face_recognition / MediaPipe, convert their output to (x, y, w, h).
# ------------------------------------------------------------------
_cascade = None


def detect_face_haar(frame, scale_width=320):
    """Runs on a downscaled copy for speed; returns the largest face or None."""
    global _cascade
    if _cascade is None:
        _cascade = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )

    h, w = frame.shape[:2]
    scale = scale_width / float(w)
    small = cv2.resize(frame, (scale_width, int(h * scale)))
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)

    faces = _cascade.detectMultiScale(gray, 1.1, 5, minSize=(40, 40))
    best = pick_largest([tuple(f) for f in faces])
    if best is None:
        return None

    return tuple(int(v / scale) for v in best)
