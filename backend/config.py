
import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

UPLOAD_DIR = Path(os.getenv("SAFESCAN_UPLOAD_DIR") or BASE_DIR / "uploads")  # env override is for tests
INCIDENT_DIR = UPLOAD_DIR / "incidents"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
INCIDENT_DIR.mkdir(parents=True, exist_ok=True)

# Model paths
PPE_MODEL_PATH = BASE_DIR / "best.pt"
FIRE_SMOKE_MODEL_PATH = BASE_DIR / "Fire_smoke.pt"

# Model configuration
PPE_CONFIDENCE = float(os.getenv("PPE_CONFIDENCE", "0.40"))
FIRE_CONFIDENCE = float(os.getenv("FIRE_CONFIDENCE", "0.25"))
SMOKE_CONFIDENCE = float(os.getenv("SMOKE_CONFIDENCE", "0.25"))

IMG_SIZE = int(os.getenv("IMG_SIZE", "416"))
FRAME_SKIP = max(1, int(os.getenv("FRAME_SKIP", "1")))
LIVE_FPS = max(1, int(os.getenv("LIVE_FPS", "8")))
LIVE_JPEG_QUALITY = int(os.getenv("LIVE_JPEG_QUALITY", "80"))
MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "500"))

DEVICE = os.getenv("DEVICE", "auto").strip().lower()

# CP Plus IP camera / RTSP configuration
# Example: rtsp://username:password@192.168.1.100:554/<stream-path>
CAMERA_RTSP_URL = os.getenv("CAMERA_RTSP_URL", "").strip()
RTSP_TRANSPORT = os.getenv("RTSP_TRANSPORT", "tcp").strip().lower()

# Violation and alert configuration
CONTINUOUS_VIOLATION_SECONDS = float(
    os.getenv("CONTINUOUS_VIOLATION_SECONDS", "2.0")
)
ALERT_COOLDOWN_SECONDS = float(
    os.getenv("ALERT_COOLDOWN_SECONDS", "10")
)
INCIDENT_RETENTION_HOURS = float(
    os.getenv("INCIDENT_RETENTION_HOURS", "24")
)

# Email configuration
ALERT_EMAIL_TO = os.getenv("ALERT_EMAIL_TO", "")
SMTP_SERVER = os.getenv("SMTP_SERVER", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "465"))
SMTP_USERNAME = os.getenv("SMTP_USERNAME", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")


# Construction site location for live-stream email alerts
SITE_ADDRESS = os.getenv(
    "SITE_ADDRESS",
    "Your Construction Site Address"
).strip()

SITE_LATITUDE = os.getenv("SITE_LATITUDE", "").strip()
SITE_LONGITUDE = os.getenv("SITE_LONGITUDE", "").strip()

# Generate Google Maps link when coordinates are configured
GOOGLE_MAPS_URL = ""

if SITE_LATITUDE and SITE_LONGITUDE:
    try:
        latitude = float(SITE_LATITUDE)
        longitude = float(SITE_LONGITUDE)

        if -90 <= latitude <= 90 and -180 <= longitude <= 180:
            GOOGLE_MAPS_URL = (
                f"https://www.google.com/maps?q={latitude},{longitude}"
            )
        else:
            print("WARNING: Invalid site latitude or longitude.")
    except ValueError:
        print("WARNING: Site coordinates must be numeric.")

# Allowed upload extensions
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".avi", ".mov", ".mkv"}

# Detection annotation colors (BGR format)
COLOR_SAFE = (0, 210, 80)
COLOR_WARNING = (0, 165, 255)
COLOR_HAZARD = (0, 60, 255)
COLOR_INFO = (255, 180, 0)


# ---------------------------------------------------------------------------
# Face Verification -> PPE Verification -> Work Authorization workflow
# (additive settings; every value can be overridden from .env)
# ---------------------------------------------------------------------------
def _env_bool(name: str, default: bool) -> bool:
    return os.getenv(name, str(default)).strip().lower() in {"1", "true", "yes", "on"}


# Private storage. Unlike /uploads this directory is NOT mounted as static files.
DATA_DIR = Path(os.getenv("SAFESCAN_DATA_DIR") or BASE_DIR / "data")  # env override is for tests
FACE_DIR = DATA_DIR / "faces"          # PERMANENT registration photos (only an admin Delete removes them)
ALERT_DIR = DATA_DIR / "alerts"        # PPE-violation snapshots (kept apart from registration photos)
DB_PATH = DATA_DIR / "safescan.db"
DATA_DIR.mkdir(parents=True, exist_ok=True)
FACE_DIR.mkdir(parents=True, exist_ok=True)
ALERT_DIR.mkdir(parents=True, exist_ok=True)

# Face models (OpenCV YuNet detector + SFace recognizer, ONNX).
MODELS_DIR = BASE_DIR / "models"
FACE_DETECTOR_MODEL_PATH = MODELS_DIR / "face_detection_yunet_2023mar.onnx"
FACE_RECOGNIZER_MODEL_PATH = MODELS_DIR / "face_recognition_sface_2021dec.onnx"
FACE_MODEL_AUTO_DOWNLOAD = _env_bool("FACE_MODEL_AUTO_DOWNLOAD", True)

# Face matching. SFace cosine similarity; OpenCV documents 0.363 as its operating
# point, the default here is slightly stricter. Tune on your own data.
FACE_MATCH_THRESHOLD = float(os.getenv("FACE_MATCH_THRESHOLD", "0.40"))
FACE_DUPLICATE_THRESHOLD = float(os.getenv("FACE_DUPLICATE_THRESHOLD", "0.55"))
FACE_DETECT_SCORE = float(os.getenv("FACE_DETECT_SCORE", "0.85"))
FACE_MIN_SIZE_PX = int(os.getenv("FACE_MIN_SIZE_PX", "80"))
FACE_CONFIRM_FRAMES = max(1, int(os.getenv("FACE_CONFIRM_FRAMES", "3")))
FACE_MAX_FRAMES = max(FACE_CONFIRM_FRAMES, int(os.getenv("FACE_MAX_FRAMES", "30")))

# PPE decision. Authorization is safety critical, so it uses its own (higher)
# confidence threshold than the general detection pages and needs N consecutive
# frames before an item is considered present.
PPE_VERIFY_CONFIDENCE = float(os.getenv("PPE_VERIFY_CONFIDENCE", "0.50"))
PPE_CONFIRM_FRAMES = max(1, int(os.getenv("PPE_CONFIRM_FRAMES", "3")))
PPE_MAX_FRAMES = max(PPE_CONFIRM_FRAMES, int(os.getenv("PPE_MAX_FRAMES", "30")))

# Session handling
VERIFY_SESSION_TTL_SECONDS = float(os.getenv("VERIFY_SESSION_TTL_SECONDS", "180"))
VERIFY_MIN_FRAME_INTERVAL_SECONDS = float(os.getenv("VERIFY_MIN_FRAME_INTERVAL_SECONDS", "0.10"))
REGISTRATION_PHOTO_MAX_MB = int(os.getenv("REGISTRATION_PHOTO_MAX_MB", "10"))

# Heuristic guard: while PPE is being checked, a clearly *different* face (cosine
# below this floor for several consecutive frames) aborts the session. Deliberately
# lower than FACE_MATCH_THRESHOLD because helmets / head turns lower similarity.
FACE_IDENTITY_GUARD_THRESHOLD = float(os.getenv("FACE_IDENTITY_GUARD_THRESHOLD", "0.20"))
FACE_IDENTITY_GUARD_FRAMES = max(1, int(os.getenv("FACE_IDENTITY_GUARD_FRAMES", "5")))


# ---------------------------------------------------------------------------
# Live (1:N) face identification + PPE alerts
# ---------------------------------------------------------------------------
# A live session has no pre-selected person: the face is compared with every registered worker.
# Consecutive frames in which a face is seen but matches nobody before the person is called UNKNOWN.
FACE_UNKNOWN_FRAMES = max(1, int(os.getenv("FACE_UNKNOWN_FRAMES", "8")))

# Live multi-worker tracking. These values control how quickly a worker is
# associated with a registration and how many consecutive missing-PPE frames
# are required before a removal alarm is raised.
TRACK_PPE_ABSENCE_FRAMES = max(3, int(os.getenv("TRACK_PPE_ABSENCE_FRAMES", "6")))
TRACK_IDENTITY_CONFIRM_FRAMES = max(1, int(os.getenv("TRACK_IDENTITY_CONFIRM_FRAMES", "2")))
TRACK_FACE_INTERVAL_FRAMES = max(1, int(os.getenv("TRACK_FACE_INTERVAL_FRAMES", "3")))

# PPE detections must belong to the verified person: their centre has to lie in a band around the
# face (helmet at/above the face, vest and shoes below it). Stops a helmet lying on a table or a
# vest on a stand from counting. Set to false to accept every detection in the frame.
PPE_PERSON_ASSOCIATION = _env_bool("PPE_PERSON_ASSOCIATION", True)

# After a live result the camera waits for the person to leave before checking the next one, so one
# worker standing in front of the camera cannot trigger an endless stream of alerts / e-mails.
LIVE_RESULT_MIN_HOLD_SECONDS = float(os.getenv("LIVE_RESULT_MIN_HOLD_SECONDS", "5"))
LIVE_LEAVE_SECONDS = float(os.getenv("LIVE_LEAVE_SECONDS", "3"))

# PPE alert history retention. Follows the existing incident retention by default; 0 = keep forever.
# This applies to ppe_alerts + alert images ONLY - registered workers are never expired.
PPE_ALERT_RETENTION_HOURS = float(os.getenv("PPE_ALERT_RETENTION_HOURS", str(INCIDENT_RETENTION_HOURS)))

# Person detection for live tracking. best.pt has no "person" class (helmet/vest/gloves/shoe only),
# so people are found with a standard COCO model. If yolov8n.pt is not in the project root,
# ultralytics downloads it automatically on first run. Use PERSON_MODEL to point at another model.
_person_default = BASE_DIR / "yolov8n.pt"
PERSON_MODEL = os.getenv("PERSON_MODEL", str(_person_default if _person_default.is_file() else "yolov8n.pt")).strip()
PERSON_CONFIDENCE = float(os.getenv("PERSON_CONFIDENCE", "0.35"))
PERSON_IMG_SIZE = int(os.getenv("PERSON_IMG_SIZE", "640"))
TRACK_MAX_LOST_FRAMES = max(1, int(os.getenv("TRACK_MAX_LOST_FRAMES", "15")))
TRACK_MIN_HITS = max(1, int(os.getenv("TRACK_MIN_HITS", "1")))


# ---------------------------------------------------------------------------
# Sign Up / Sign In (backend/auth.py) and live PPE voice alarm
# ---------------------------------------------------------------------------
# How long a login stays valid, in hours. Logout ends it immediately.
AUTH_SESSION_HOURS = max(0.1, float(os.getenv("AUTH_SESSION_HOURS", "12")))
