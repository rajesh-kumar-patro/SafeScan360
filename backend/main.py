import base64
import copy
import itertools
import json
import os
import re
import smtplib
import subprocess
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path
from typing import Optional
from math import radians, sin, cos, sqrt, atan2
import mimetypes

import cv2
import numpy as np
from fastapi import BackgroundTasks, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.config import (
    ALERT_COOLDOWN_SECONDS,
    ALERT_EMAIL_TO,
    ALLOWED_IMAGE_EXTENSIONS,
    ALLOWED_VIDEO_EXTENSIONS,
    BASE_DIR,
    CONTINUOUS_VIOLATION_SECONDS,
    CAMERA_RTSP_URL,
    RTSP_TRANSPORT,
    LIVE_FPS,
    LIVE_JPEG_QUALITY,
    FIRE_SMOKE_MODEL_PATH,
    INCIDENT_DIR,
    INCIDENT_RETENTION_HOURS,
    MAX_UPLOAD_SIZE_MB,
    SMTP_PASSWORD,
    SMTP_PORT,
    SMTP_SERVER,
    SMTP_USERNAME,
    UPLOAD_DIR,
    SITE_ADDRESS, 
    GOOGLE_MAPS_URL, 
    SITE_LATITUDE, 
    SITE_LONGITUDE,
)
from backend.detection_engine import SafetyComplianceEngine
from backend.config import (
    ALERT_DIR, FACE_UNKNOWN_FRAMES, LIVE_LEAVE_SECONDS, LIVE_RESULT_MIN_HOLD_SECONDS,
    PPE_ALERT_RETENTION_HOURS, PPE_PERSON_ASSOCIATION, TRACK_PPE_ABSENCE_FRAMES, TRACK_IDENTITY_CONFIRM_FRAMES,
    ALERT_EMAIL_TO, DB_PATH, FACE_CONFIRM_FRAMES, FACE_DETECTOR_MODEL_PATH, FACE_DETECT_SCORE,
    FACE_DIR, FACE_DUPLICATE_THRESHOLD, FACE_IDENTITY_GUARD_FRAMES, FACE_IDENTITY_GUARD_THRESHOLD,
    FACE_MATCH_THRESHOLD, FACE_MAX_FRAMES, FACE_MIN_SIZE_PX, FACE_MODEL_AUTO_DOWNLOAD,
    FACE_RECOGNIZER_MODEL_PATH, PPE_CONFIRM_FRAMES, PPE_MAX_FRAMES, PPE_VERIFY_CONFIDENCE,
    REGISTRATION_PHOTO_MAX_MB, VERIFY_MIN_FRAME_INTERVAL_SECONDS, VERIFY_SESSION_TTL_SECONDS,
)
from backend.auth import AuthStore
from backend.auth_routes import AuthMiddleware, build_router as build_auth_router
from backend.config import AUTH_SESSION_HOURS
from backend.face_service import FaceError, FaceService, cosine_similarity
from backend.person_store import (
    DuplicateMobileError, PersonStore, mask_mobile, normalize_mobile, normalize_name,
)
from backend.ppe_workflow import (
    REQUIRED_ITEMS, compute_compliance, explicit_absence_classes, missing_required_classes,
)
from backend.live_verifier import LiveVerifier, annotate as annotate_live_frame
from backend.live_tracking import MultiWorkerTracker
from backend.verification_email import build_alert_html, build_alert_subject, build_alert_text
from backend.verification_email import build_html as build_verification_html
from backend.verification_email import build_text as build_verification_text
from backend.verification_service import VerificationService, VerifySettings, WorkflowError

app = FastAPI(title="SafeScan360 AI Engine", version="2.0")

# --- Authentication (Sign Up / Sign In) -------------------------------------------------------
# Users and sessions live in the existing SQLite database (data/safescan.db). The middleware
# is registered BEFORE CORS so CORS stays outermost and 401 replies still carry CORS headers.
# Every endpoint except /api/auth/* and /api/health now requires a signed-in session.
auth_store = AuthStore(DB_PATH, session_ttl=AUTH_SESSION_HOURS * 3600)
app.add_middleware(AuthMiddleware, store=auth_store)
app.include_router(build_auth_router(auth_store, AUTH_SESSION_HOURS * 3600))

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

engine = SafetyComplianceEngine()
executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="safescan-video")
email_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="safescan-email")
video_jobs = {}
video_jobs_lock = threading.Lock()

latest_live_stats = {
    "total_workers": 0, "compliant": 0, "violations": 0, "hazards": 0,
    "fire": False, "smoke": False, "fire_count": 0, "smoke_count": 0,
    "compliance_pct": "0%", "fps": 0, "latency_ms": 0, "events": [],
    "model_info": {}, "device": engine.device,
}

INCIDENTS_FILE = UPLOAD_DIR / "incident_log.json"
incident_store = []
active_alerts = {}
alert_lock = threading.Lock()


def load_incidents():
    global incident_store
    try:
        with open(INCIDENTS_FILE, "r", encoding="utf-8") as f:
            incident_store = json.load(f)
    except Exception:
        incident_store = []


def save_incidents():
    with open(INCIDENTS_FILE, "w", encoding="utf-8") as f:
        json.dump(incident_store, f, indent=2)


def cleanup_expired_incidents():
    global incident_store
    cutoff = time.time() - INCIDENT_RETENTION_HOURS * 3600
    kept = []
    for item in incident_store:
        if item.get("created_at_ts", time.time()) >= cutoff:
            kept.append(item)
        else:
            path = item.get("screenshot_path")
            if path and os.path.exists(path):
                try: os.remove(path)
                except OSError: pass
    incident_store = kept
    save_incidents()


def safe_name(name: str, fallback="upload"):
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(name or fallback).name)
    return stem[:120] or fallback


def save_screenshot(frame, label):
    filename = f"{label}_{datetime.now().strftime('%Y%m%d_%H%M%S_%f')}.jpg"
    path = INCIDENT_DIR / filename
    if cv2.imwrite(str(path), frame):
        return str(path)
    return None


def calculate_distance_km(lat1, lon1, lat2, lon2):
    """Calculate the great-circle distance between two points on the earth (in kilometers)."""
    R = 6371.0  # Earth radius in kilometers
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = sin(dlat / 2)**2 + cos(radians(lat1)) * cos(radians(lat2)) * sin(dlon / 2)**2
    c = 2 * atan2(sqrt(a), sqrt(1 - a))
    return R * c


def send_incident_email(incident):
    """Send a safety alert email with violation details, exact GPS coordinates, distance deviation, and captured evidence image."""
    if not ALERT_EMAIL_TO or not SMTP_USERNAME or not SMTP_PASSWORD:
        return

    try:
        details = incident.get("details") or {}
        missing = details.get("missing") or []
        missing_text = ", ".join(missing) if missing else incident.get("message", "Safety event detected")
        screenshot_path = incident.get("screenshot_path")
        source = incident.get("source", "unknown")
        incident_type = incident.get("type", "Unknown Event")
        severity = incident.get("severity", "UNKNOWN")
        timestamp = incident.get("timestamp", "")
        message_text = incident.get("message", "")

        subject = f"SafeScan360 Alert - {incident_type}"
        if missing:
            subject += f": {missing_text}"

        lat_str = SITE_LATITUDE.strip() if SITE_LATITUDE else ""
        lon_str = SITE_LONGITUDE.strip() if SITE_LONGITUDE else ""
        coordinates_text = f"{lat_str}, {lon_str}" if (lat_str and lon_str) else "Coordinates not configured"

        # Calculate traveling distance deviation if mobile/current lat & lon are provided in details
        current_lat = details.get("latitude")
        current_lon = details.get("longitude")
        distance_text = ""
        if current_lat and current_lon and lat_str and lon_str:
            try:
                dist_km = calculate_distance_km(
                    float(lat_str), float(lon_str),
                    float(current_lat), float(current_lon)
                )
                if dist_km < 1.0:
                    distance_text = f"{int(dist_km * 1000)} meters away from base"
                else:
                    distance_text = f"{dist_km:.2f} km away from base"
            except ValueError:
                pass

        # --- 1. Plain Text Body Fallback ---
        body = (
            "SafeScan360 Safety Alert\n\n"
            f"Event: {incident_type}\n"
            f"Severity: {severity}\n"
            f"Source: {source}\n"
            f"Time: {timestamp}\n"
        )

        if source == "live":
            body += (
                f"\n📍 Construction Site: {SITE_ADDRESS}\n"
                f"🎯 Exact Coordinates: {coordinates_text}\n"
            )
            if distance_text:
                body += f"📏 Distance Deviation: {distance_text}\n"
            body += f"🗺️ Google Maps Location: {GOOGLE_MAPS_URL if GOOGLE_MAPS_URL else 'Coordinates not configured'}\n"

        if details.get("worker_id"):
            body += f"Worker: {details['worker_id']}\n"
        if missing:
            body += f"Missing / not detected with explicit violation evidence: {missing_text}\n"
        if message_text:
            body += f"\nMessage: {message_text}\n"
            
        verification = incident.get("verification")
        if verification:
            body += build_verification_text(verification)

        body += "\nThe attached image is the captured evidence frame."

        # --- 2. Rich HTML Body ---
        html_body = f"""
        <html>
          <body style="font-family: Arial, sans-serif; color: #333;">
            <h2 style="color: #d9534f; margin-bottom: 5px;">SafeScan360 Safety Alert</h2>
            <hr style="border: 0; border-top: 2px solid #d9534f; margin-top: 0;" />
            <p><b>Event:</b> {incident_type}</p>
            <p><b>Severity:</b> <span style="color: #d9534f;">{severity}</span></p>
            <p><b>Source:</b> {source}</p>
            <p><b>Time:</b> {timestamp}</p>
        """

        if source == "live":
            html_body += f"""
            <div style="background-color: #f9f9f9; padding: 12px; border-radius: 6px; margin: 15px 0; border-left: 4px solid #0275d8;">
              <p style="margin: 0 0 8px 0;"><b>📍 Construction Site:</b> {SITE_ADDRESS}</p>
              <p style="margin: 0 0 8px 0;"><b>🎯 Exact Coordinates:</b> <code>{coordinates_text}</code></p>
            """
            if distance_text:
                html_body += f"""<p style="margin: 0 0 8px 0; color: #d9534f;"><b>📏 Distance Deviation:</b> {distance_text}</p>"""
            
            if GOOGLE_MAPS_URL:
                html_body += f"""
              <p style="margin: 10px 0 0 0;">
                <a href="{GOOGLE_MAPS_URL}" target="_blank" style="background-color: #0275d8; color: white; padding: 10px 18px; text-decoration: none; border-radius: 4px; font-weight: bold; display: inline-block;">
                  🗺️ Open Exact Pin in Google Maps
                </a>
              </p>
            """
            html_body += "</div>"

        if details.get("worker_id"):
            html_body += f"<p><b>Worker ID:</b> {details['worker_id']}</p>"
        if missing:
            html_body += f"<p><b>Missing PPE / Violation Evidence:</b> {missing_text}</p>"
        if message_text:
            html_body += f"<p><b>Message:</b> {message_text}</p>"

        if verification:
            html_body += build_verification_html(verification)

        html_body += """
            <p style="color: #666; font-size: 0.9em; margin-top: 25px;"><em>The attached image is the captured evidence frame.</em></p>
          </body>
        </html>
        """

        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = SMTP_USERNAME
        msg["To"] = ALERT_EMAIL_TO
        
        msg.set_content(body)
        msg.add_alternative(html_body, subtype="html")

        if screenshot_path:
            image_path = Path(screenshot_path)
            if image_path.is_file():
                image_data = image_path.read_bytes()
                mime_type, _ = mimetypes.guess_type(str(image_path))
                maintype, subtype = (mime_type.split("/") if mime_type else ("image", "jpeg"))
                msg.add_attachment(
                    image_data,
                    maintype=maintype,
                    subtype=subtype,
                    filename=image_path.name,
                )

        if verification and verification.get("photo_path"):
            photo_path = Path(verification["photo_path"])
            if photo_path.is_file():
                msg.add_attachment(photo_path.read_bytes(), maintype="image", subtype="jpeg",
                                   filename="registered_face.jpg")

        with smtplib.SMTP_SSL(SMTP_SERVER, SMTP_PORT, timeout=20) as server:
            server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.send_message(msg)
        print(f"[EMAIL] Alert sent to {ALERT_EMAIL_TO}: {subject}")
    except Exception as exc:
        print(f"[EMAIL ERROR] {exc}")


def register_incident(kind, message, severity, source, frame=None, details=None, debounce=True, email_extra=None,
                      send_email=True):
    now = time.time()
    key = f"{source}:{kind}"
    with alert_lock:
        if debounce:
            previous = active_alerts.get(key)
            if previous and now - previous < ALERT_COOLDOWN_SECONDS:
                return None
            active_alerts[key] = now
        screenshot_path = save_screenshot(frame, f"{kind.lower()}_{uuid.uuid4().hex[:8]}") if frame is not None else None
        incident = {
            "id": uuid.uuid4().hex,
            "type": kind,
            "source": source,
            "severity": severity,
            "message": message,
            "details": details or {},
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "created_at_ts": now,
            "screenshot_path": screenshot_path,
            "screenshot_url": f"/uploads/incidents/{Path(screenshot_path).name}" if screenshot_path else None,
        }
        incident_store.insert(0, incident)
        save_incidents()
    # email_extra (e.g. a person's name/mobile) goes to the email only; it is deliberately
    # not stored in incident_log.json, which is served from the public /uploads mount.
    if send_email:
        email_executor.submit(send_incident_email, {**incident, "verification": email_extra} if email_extra else incident)
    return incident


load_incidents()


def validate_upload(file: UploadFile, allowed):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in allowed:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext or 'unknown'}")
    return ext


async def read_upload(file: UploadFile):
    data = await file.read(MAX_UPLOAD_SIZE_MB * 1024 * 1024 + 1)
    if len(data) > MAX_UPLOAD_SIZE_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File exceeds {MAX_UPLOAD_SIZE_MB} MB limit")
    return data


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "SafeScan360 AI Engine", "device": engine.device}


@app.get("/api/models/status")
@app.get("/api/model-status")
def model_status():
    return {
        "ppe_model": True,
        "fire_smoke_model": Path(FIRE_SMOKE_MODEL_PATH).exists(),
        "device": engine.device,
        "ppe_classes": list(engine.ppe_names.values()),
        "fire_smoke_classes": list(engine.hazard_names.values()),
    }


@app.get("/api/live-stats")
def live_stats():
    return latest_live_stats

@app.get("/api/live-tracking/state")
def live_tracking_state():
    """Current persistent worker tracks and their relative camera-map positions."""
    return latest_tracking_state


@app.get("/api/stats")
def stats():
    return latest_live_stats


@app.get("/api/incidents")
def incidents():
    cleanup_expired_incidents()
    return {"incidents": incident_store}


@app.get("/api/recent-alerts")
def recent_alerts():
    cleanup_expired_incidents()
    return {"incidents": incident_store[:10]}


@app.delete("/api/incidents/{incident_id}")
def delete_incident(incident_id: str):
    global incident_store
    for i, item in enumerate(incident_store):
        if item.get("id") == incident_id:
            path = item.get("screenshot_path")
            if path and os.path.exists(path):
                try: os.remove(path)
                except OSError: pass
            incident_store.pop(i)
            save_incidents()
            return {"status": "deleted", "id": incident_id}
    raise HTTPException(status_code=404, detail="Incident not found")


def apply_alerts(stats, frame, source):
    if stats.get("fire"):
        register_incident("FIRE", "Fire detected", "CRITICAL", source, frame, {"confidence": max([e.get("confidence", 0) for e in stats["events"] if e.get("type") == "FIRE"] or [0])})
    if stats.get("smoke"):
        register_incident("SMOKE", "Smoke detected", "HIGH", source, frame, {"confidence": max([e.get("confidence", 0) for e in stats["events"] if e.get("type") == "SMOKE"] or [0])})
    if stats.get("violations"):
        for event in stats.get("events", []):
            if event.get("type") == "PPE_VIOLATION":
                register_incident("PPE_VIOLATION", event["message"], event.get("severity", "MEDIUM"), source, frame, event)


@app.post("/api/detect-image")
async def detect_image(file: UploadFile = File(...)):
    validate_upload(file, ALLOWED_IMAGE_EXTENSIONS)
    data = await read_upload(file)
    image = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise HTTPException(status_code=400, detail="Invalid or corrupted image")
    annotated, result = engine.process_frame(image)
    apply_alerts(result, annotated, "image")
    ok, buffer = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, 90])
    if not ok:
        raise HTTPException(status_code=500, detail="Could not encode annotated image")
    return {
        "status": "Success",
        "annotated_image": "data:image/jpeg;base64," + base64.b64encode(buffer).decode(),
        "stats": result,
    }


def transcode_to_browser_mp4(input_path: Path, output_path: Path):
    ffmpeg = "ffmpeg"
    command = [ffmpeg, "-y", "-i", str(input_path), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", str(output_path)]
    try:
        proc = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        return True, proc.stderr[-1000:]
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        return False, str(exc)


def process_video_job(job_id: str, raw_path: Path):
    with video_jobs_lock:
        video_jobs[job_id]["status"] = "processing"
    temp_path = UPLOAD_DIR / f"{job_id}_annotated_temp.mp4"
    final_path = UPLOAD_DIR / f"{job_id}_annotated.mp4"
    cap = cv2.VideoCapture(str(raw_path))
    if not cap.isOpened():
        raise RuntimeError("Could not open uploaded video")
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
    fps = float(cap.get(cv2.CAP_PROP_FPS) or 25.0)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    if width <= 0 or height <= 0:
        cap.release(); raise RuntimeError("Corrupted or unsupported video")
    writer = cv2.VideoWriter(str(temp_path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (width, height))
    if not writer.isOpened():
        cap.release(); raise RuntimeError("Could not create temporary video writer")

    frame_idx = 0
    processed = 0
    total_worker_frames = 0
    total_compliant_frames = 0
    max_hazards = 0
    fire_events = 0
    smoke_events = 0
    timeline = []
    start = time.perf_counter()
    last_stats = {}
    last_annotated = None
    try:
        while True:
            ret, frame = cap.read()
            if not ret: break
            if frame_idx % max(1, __import__('backend.config', fromlist=['FRAME_SKIP']).FRAME_SKIP) != 0:
                writer.write(frame)
                frame_idx += 1
                continue
            annotated, stats = engine.process_frame(frame)
            writer.write(annotated)
            last_stats = stats
            last_annotated = annotated
            processed += 1
            total_worker_frames += stats["total_workers"]
            total_compliant_frames += stats["compliant"]
            max_hazards = max(max_hazards, stats["hazards"])
            fire_events += int(stats["fire"])
            smoke_events += int(stats["smoke"])
            if frame_idx % max(1, int(fps)) == 0:
                timeline.append({
                    "time": round(frame_idx / fps, 2),
                    "timestamp": f"{int(frame_idx / fps // 60):02d}:{int(frame_idx / fps % 60):02d}",
                    "workers": stats["total_workers"], "compliant": stats["compliant"],
                    "violations": stats["violations"], "hazards": stats["hazards"],
                    "fire": stats["fire"], "smoke": stats["smoke"], "events": stats["events"],
                })
            if last_annotated is not None and (stats["fire"] or stats["smoke"] or stats["violations"]):
                apply_alerts(stats, annotated, "video")
            frame_idx += 1
            progress = round((frame_idx / frame_count) * 100, 1) if frame_count else 0
            elapsed = time.perf_counter() - start
            with video_jobs_lock:
                video_jobs[job_id].update({
                    "progress": min(progress, 99.9), "frames_processed": processed,
                    "processing_fps": round(processed / elapsed, 2) if elapsed else 0,
                })
    finally:
        cap.release(); writer.release()

    ok, ffmpeg_info = transcode_to_browser_mp4(temp_path, final_path)
    if not ok:
        os.replace(temp_path, final_path)
        ffmpeg_used = False
    else:
        temp_path.unlink(missing_ok=True)
        ffmpeg_used = True

    elapsed = time.perf_counter() - start
    overall_compliance = (total_compliant_frames / total_worker_frames * 100) if total_worker_frames else 0
    summary = {
        "compliance_pct": round(overall_compliance, 1),
        "active_hazards": max_hazards,
        "fire_events": fire_events,
        "smoke_events": smoke_events,
        "frames_total": frame_idx,
        "frames_processed": processed,
        "original_fps": round(fps, 2),
        "processing_fps": round(processed / elapsed, 2) if elapsed else 0,
        "processing_seconds": round(elapsed, 2),
        "duration_seconds": round(frame_idx / fps, 2) if fps else 0,
        "ffmpeg_used": ffmpeg_used,
        "timeline_events": timeline,
        "last_stats": last_stats,
    }
    with video_jobs_lock:
        video_jobs[job_id].update({"status": "completed", "progress": 100, "result": summary, "video_url": f"/uploads/{final_path.name}"})
    raw_path.unlink(missing_ok=True)


def process_video_wrapper(job_id, raw_path):
    try:
        process_video_job(job_id, raw_path)
    except Exception as exc:
        print(f"[VIDEO ERROR] {exc}")
        with video_jobs_lock:
            video_jobs[job_id].update({"status": "failed", "error": "Video processing failed. Check backend logs for details."})
        try: raw_path.unlink(missing_ok=True)
        except OSError: pass


@app.post("/api/detect/video")
@app.post("/upload_video")
async def upload_video(file: UploadFile = File(...)):
    validate_upload(file, ALLOWED_VIDEO_EXTENSIONS)
    data = await read_upload(file)
    job_id = uuid.uuid4().hex
    raw_path = UPLOAD_DIR / f"{job_id}_raw_{safe_name(file.filename, 'video.mp4')}"
    raw_path.write_bytes(data)
    with video_jobs_lock:
        video_jobs[job_id] = {"job_id": job_id, "status": "queued", "progress": 0, "filename": safe_name(file.filename)}
    executor.submit(process_video_wrapper, job_id, raw_path)
    return {"status": "processing", "job_id": job_id}


@app.get("/api/video/status/{job_id}")
def video_status(job_id: str):
    with video_jobs_lock:
        job = video_jobs.get(job_id)
        if not job: raise HTTPException(status_code=404, detail="Video job not found")
        return job


@app.get("/api/video/result/{job_id}")
def video_result(job_id: str):
    with video_jobs_lock:
        job = video_jobs.get(job_id)
    if not job: raise HTTPException(status_code=404, detail="Video job not found")
    if job["status"] != "completed": return job
    return job


@app.post("/api/detect/live")
async def detect_live(file: UploadFile = File(...)):
    """Legacy single-frame endpoint kept for compatibility with older clients."""
    global latest_live_stats
    data = await file.read(4 * 1024 * 1024)
    frame = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=400, detail="Invalid live frame")
    annotated, result = engine.process_frame(frame)
    latest_live_stats = result
    latest_live_stats["latency_ms"] = result["processing_ms"]
    apply_alerts(result, annotated, "live")
    ok, buf = cv2.imencode(".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, LIVE_JPEG_QUALITY])
    if not ok:
        raise HTTPException(status_code=500, detail="Could not encode live result")
    return {"image": "data:image/jpeg;base64," + base64.b64encode(buf).decode(), "stats": result}


def open_rtsp_camera():
    """Open the configured CP Plus RTSP stream, preferring TCP transport."""
    if not CAMERA_RTSP_URL:
        raise RuntimeError(
            "CAMERA_RTSP_URL is not configured. Add the CP Plus RTSP URL to .env."
        )

    if RTSP_TRANSPORT in {"tcp", "udp"}:
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = f"rtsp_transport;{RTSP_TRANSPORT}"

    cap = None
    if CAMERA_RTSP_URL.isdigit():       # e.g. CAMERA_RTSP_URL=0 -> local USB / laptop webcam (read by the backend)
        cap = cv2.VideoCapture(int(CAMERA_RTSP_URL))
        if not cap.isOpened():
            cap.release()
            raise RuntimeError(f"Could not open local camera {CAMERA_RTSP_URL}.")
        return cap
    try:
        cap = cv2.VideoCapture(CAMERA_RTSP_URL, cv2.CAP_FFMPEG)
    except Exception:
        cap = None

    if cap is None or not cap.isOpened():
        if cap is not None:
            cap.release()
        cap = cv2.VideoCapture(CAMERA_RTSP_URL)

    if not cap.isOpened():
        if cap is not None:
            cap.release()
        raise RuntimeError("Could not connect to the CP Plus RTSP stream. Check IP, username, password, RTSP path and network connection.")

    # Reduce buffering where the backend/OpenCV build supports it.
    try:
        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
    except Exception:
        pass
    return cap


# Increases with every processed live frame (never resets). The browser's voice alarm uses it to tell a
# fresh result from the stale last result that stays in latest_live_stats after a stream stops.
_live_frame_counter = itertools.count(1)


def cpplus_camera_stream():
    """Read CP Plus RTSP frames with persistent multi-worker tracking."""
    global latest_live_stats, latest_tracking_state, live_tracker
    cap = None
    frame_interval = 1.0 / max(1, LIVE_FPS)

    try:
        cap = open_rtsp_camera()
        if live_tracker is None:
            live_tracker = MultiWorkerTracker(
                engine,
                face_service,
                person_store,
                confirm_frames=PPE_CONFIRM_FRAMES,
                absence_frames=TRACK_PPE_ABSENCE_FRAMES,
                identity_frames=TRACK_IDENTITY_CONFIRM_FRAMES,
            )
        else:
            # A new stream starts with fresh track IDs/state.
            live_tracker.reset()
        last_emit = 0.0
        consecutive_failures = 0

        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                consecutive_failures += 1
                if consecutive_failures >= 20:
                    break
                time.sleep(0.05)
                continue

            consecutive_failures = 0
            now = time.perf_counter()
            if now - last_emit < frame_interval:
                continue
            last_emit = now

            started = time.perf_counter()
            annotated, result = live_tracker.process(frame)
            result["latency_ms"] = round((time.perf_counter() - started) * 1000, 1)
            result["fps"] = LIVE_FPS
            result["camera_source"] = "CP Plus RTSP"
            result["frame_seq"] = next(_live_frame_counter)
            latest_live_stats = result
            latest_tracking_state = {
                "tracking_enabled": True,
                "active_tracks": result.get("tracking", {}).get("active_tracks", 0),
                "workers": result.get("tracking", {}).get("workers", []),
                "camera_map": result.get("tracking", {}).get("camera_map", []),
                "camera_source": "CP Plus RTSP",
                "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            }

            if result.get("fire") or result.get("smoke") or result.get("violations"):
                apply_alerts(result, annotated, "live")

            ok, buf = cv2.imencode(
                ".jpg", annotated, [cv2.IMWRITE_JPEG_QUALITY, LIVE_JPEG_QUALITY]
            )
            if not ok:
                continue

            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n"
                + buf.tobytes()
                + b"\r\n"
            )
    except GeneratorExit:
        pass
    except Exception as exc:
        print(f"[CP PLUS RTSP ERROR] {exc}")
        latest_live_stats = {
            **latest_live_stats,
            "camera_source": "CP Plus RTSP",
            "camera_error": str(exc),
        }
    finally:
        if cap is not None:
            cap.release()
        latest_tracking_state = {
            "tracking_enabled": True,
            "active_tracks": 0,
            "workers": [],
            "camera_map": [],
            "camera_source": "CP Plus RTSP",
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        }


@app.get("/api/camera/status")
def camera_status():
    """Return whether a CP Plus RTSP URL is configured without opening the stream."""
    return {
        "configured": bool(CAMERA_RTSP_URL),
        "source": "CP Plus RTSP",
        "transport": RTSP_TRANSPORT,
    }


@app.get("/api/cpplus/live")
def cpplus_live():
    return StreamingResponse(
        cpplus_camera_stream(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache", "Pragma": "no-cache"},
    )


# Keep the old /video_feed URL working, but now use the CP Plus RTSP stream.
@app.get("/video_feed")
def video_feed():
    return StreamingResponse(
        cpplus_camera_stream(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache", "Pragma": "no-cache"},
    )


# ===========================================================================
# Face Verification -> PPE Verification -> Work Authorization workflow
# (additive; the detection / video / live / incident features above are unchanged)
# ===========================================================================
person_store = PersonStore(DB_PATH)
face_service = FaceService(
    detector_path=FACE_DETECTOR_MODEL_PATH, recognizer_path=FACE_RECOGNIZER_MODEL_PATH,
    score_threshold=FACE_DETECT_SCORE, match_threshold=FACE_MATCH_THRESHOLD,
    min_face_px=FACE_MIN_SIZE_PX, auto_download=FACE_MODEL_AUTO_DOWNLOAD,
)
# Load / download the face models in the background so the first request is not blocked.
threading.Thread(target=face_service.ready, name="face-model-warmup", daemon=True).start()

# Persistent live multi-worker tracker. Registration remains read-only for this
# component: new workers are picked up from the face gallery automatically.
live_tracker = None
latest_tracking_state = {
    "tracking_enabled": True,
    "active_tracks": 0,
    "workers": [],
    "camera_map": [],
}

_ppe_infer_lock = threading.Lock()
PHOTO_NAME_RE = re.compile(r"^[0-9a-f]{32}\.jpg$")
FRAME_MAX_BYTES = 4 * 1024 * 1024


def api_error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def ppe_workflow_ready():
    missing = missing_required_classes(engine.ppe_app_map)
    if missing:
        return False, f"The PPE model has no class for: {', '.join(missing)}. Work cannot be authorized."
    return True, ""


def workflow_ppe_detect(frame):
    with _ppe_infer_lock:
        return engine.detect_ppe_items(frame, PPE_VERIFY_CONFIDENCE)


def decode_image(data: bytes, what="image"):
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR) if data else None
    if img is None or img.size == 0:
        raise api_error(400, "INVALID_IMAGE", f"Invalid or corrupted {what}.")
    return img


def read_limited(upload: UploadFile, max_bytes: int, what="file") -> bytes:
    data = upload.file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise api_error(413, "FILE_TOO_LARGE", f"The {what} is too large.")
    return data


ALERT_IMAGE_RE = re.compile(r"^[0-9a-f]{32}\.jpg$")


def email_is_configured():
    return bool(ALERT_EMAIL_TO and SMTP_USERNAME and SMTP_PASSWORD)


def public_alert(alert):
    date, _, clock = (alert.get("timestamp") or "").partition(" ")
    return {
        **alert, "date": date, "time": clock,
        "image_url": f"/api/alert-images/{alert['captured_image']}" if alert.get("captured_image") else None,
    }


def purge_expired_ppe_alerts():
    """Retention for PPE ALERTS only (follows INCIDENT_RETENTION_HOURS by default; 0 = keep forever).
    Registered workers and their photos are never touched here."""
    if PPE_ALERT_RETENTION_HOURS <= 0:
        return
    for name in person_store.purge_alerts_older_than(time.time() - PPE_ALERT_RETENTION_HOURS * 3600):
        if ALERT_IMAGE_RE.match(name):
            (ALERT_DIR / name).unlink(missing_ok=True)


def send_ppe_alert_email(alert_id):
    """Send the PPE Violation Alert e-mail (captured image attached) and record the outcome.
    Never raises: a mail failure only changes the alert's email_status to 'failed'."""
    status = "failed"
    try:
        alert = person_store.get_alert(alert_id)
        if not alert:
            return
        if not email_is_configured():
            status = "not_configured"
            return
        msg = EmailMessage()
        msg["Subject"] = build_alert_subject(alert)
        msg["From"] = SMTP_USERNAME
        msg["To"] = ALERT_EMAIL_TO
        msg.set_content(build_alert_text(alert))
        msg.add_alternative(build_alert_html(alert), subtype="html")
        image = ALERT_DIR / alert["captured_image"] if alert.get("captured_image") else None
        if image is not None and ALERT_IMAGE_RE.match(image.name) and image.is_file():
            msg.add_attachment(image.read_bytes(), maintype="image", subtype="jpeg",
                               filename=f"ppe_violation_{alert['id']}.jpg")
        with smtplib.SMTP_SSL(SMTP_SERVER, SMTP_PORT, timeout=20) as server:
            server.login(SMTP_USERNAME, SMTP_PASSWORD)
            server.send_message(msg)
        status = "sent"
        print(f"[EMAIL] PPE alert {alert_id} sent to {ALERT_EMAIL_TO}")
    except Exception as exc:  # noqa: BLE001
        print(f"[EMAIL ERROR] PPE alert {alert_id}: {exc}")
    finally:
        try:
            person_store.set_alert_email_status(alert_id, status)
        except Exception as exc:  # noqa: BLE001
            print(f"[DB ERROR] {exc}")


def _on_work_not_authorized(result, person, frame, boxes):
    """PPE incomplete: capture the worker, store a PPE alert, queue the e-mail.

    Registration data is only read here (name / mobile / code); it is never modified.
    """
    evidence = frame.copy()
    h, w = evidence.shape[:2]
    for d in boxes:
        x1, y1, x2, y2 = [int(v * s) for v, s in zip(d["box"], (w, h, w, h))]
        cv2.rectangle(evidence, (x1, y1), (x2, y2), COLOR_INFO_BGR, 2)
        cv2.putText(evidence, f"{d['item'].upper()} {d['conf']:.2f}", (x1, max(16, y1 - 5)),
                    cv2.FONT_HERSHEY_SIMPLEX, .5, COLOR_INFO_BGR, 1, cv2.LINE_AA)
    missing_title = [m.title() for m in result["missing"]]
    cv2.putText(evidence, f"PPE incomplete {result['ppe_percentage']}% - missing: {', '.join(missing_title) or 'PPE'}",
                (10, 24), cv2.FONT_HERSHEY_SIMPLEX, .65, (0, 60, 255), 2, cv2.LINE_AA)

    # 1) PPE alert (separate table + separate image folder from the worker registration)
    alert_id = None
    try:
        image_name = f"{uuid.uuid4().hex}.jpg"
        if not cv2.imwrite(str(ALERT_DIR / image_name), evidence, [cv2.IMWRITE_JPEG_QUALITY, 90]):
            image_name = None
        alert = person_store.add_alert(
            person["code"], person["name"], person["mobile"], result["ppe_percentage"], result["missing"],
            image_name, "pending" if email_is_configured() else "not_configured")
        alert_id = alert["id"]
        result["alert_id"] = alert_id
    except Exception as exc:  # noqa: BLE001
        print(f"[ALERT STORE ERROR] {exc}")

    # 2) existing incident log / dashboard entry (no personal data; its own retention; no second e-mail)
    details = {
        "worker_id": person["code"], "missing": missing_title,
        "ppe_percentage": result["ppe_percentage"], "verification_id": result.get("verification_id"),
    }
    register_incident(
        "PPE_VIOLATION", f"PPE incomplete - missing: {', '.join(missing_title) or 'all items'}",
        "HIGH" if len(result["missing"]) > 1 else "MEDIUM", "verification", evidence, details,
        debounce=False, send_email=False,
    )
    if alert_id is None:
        return "error"

    # 3) e-mail with the captured image attached (status is written back to the alert)
    if not email_is_configured():
        return "not_configured"
    email_executor.submit(send_ppe_alert_email, alert_id)
    return "queued"


COLOR_INFO_BGR = (255, 180, 0)

verification_service = VerificationService(
    store=person_store, faces=face_service, ppe_detector=workflow_ppe_detect, ppe_ready=ppe_workflow_ready,
    settings=VerifySettings(
        face_confirm_frames=FACE_CONFIRM_FRAMES, face_max_frames=FACE_MAX_FRAMES,
        ppe_confidence=PPE_VERIFY_CONFIDENCE, ppe_confirm_frames=PPE_CONFIRM_FRAMES, ppe_max_frames=PPE_MAX_FRAMES,
        session_ttl=VERIFY_SESSION_TTL_SECONDS, min_frame_interval=VERIFY_MIN_FRAME_INTERVAL_SECONDS,
        guard_threshold=FACE_IDENTITY_GUARD_THRESHOLD, guard_frames=FACE_IDENTITY_GUARD_FRAMES,
        unknown_frames=FACE_UNKNOWN_FRAMES, associate_ppe=PPE_PERSON_ASSOCIATION,
    ),
    negative_classes=explicit_absence_classes(engine.ppe_app_map),
    on_unauthorized=_on_work_not_authorized,
)


def _workflow(call, *args):
    try:
        return call(*args)
    except WorkflowError as exc:
        raise api_error(exc.http_status, exc.code, exc.message)
    except FaceError as exc:
        raise api_error(503 if exc.code == "FACE_SERVICE_UNAVAILABLE" else 422, exc.code, exc.message)


@app.get("/api/workflow/status")
def workflow_status():
    face_ok, face_reason = face_service.ready()
    ppe_ok, ppe_reason = ppe_workflow_ready()
    return {
        "face_service": {"ready": face_ok, "reason": face_reason},
        "ppe_model": {
            "ready": ppe_ok, "reason": ppe_reason, "model_classes": list(engine.ppe_names.values()),
            "class_mapping": {engine.ppe_names[i]: a for i, a in engine.ppe_app_map.items()},
            "explicit_absence_classes": explicit_absence_classes(engine.ppe_app_map),
        },
        "required_items": list(REQUIRED_ITEMS),
        "email_configured": bool(ALERT_EMAIL_TO and SMTP_USERNAME and SMTP_PASSWORD),
        "registered_people": person_store.count(),
        "settings": {
            "face_match_threshold": FACE_MATCH_THRESHOLD, "face_confirm_frames": FACE_CONFIRM_FRAMES,
            "ppe_confidence": PPE_VERIFY_CONFIDENCE, "ppe_confirm_frames": PPE_CONFIRM_FRAMES,
            "ppe_max_frames": PPE_MAX_FRAMES,
        },
    }


@app.post("/api/persons/register")
def register_person(
    name: str = Form(...), mobile: str = Form(...), photo: UploadFile = File(...),
    confirm_duplicate_face: bool = Form(False),
):
    try:
        clean_name = normalize_name(name)
        mobile_display, mobile_key = normalize_mobile(mobile)
    except ValueError as exc:
        raise api_error(422, "INVALID_INPUT", str(exc))
    if person_store.find_by_mobile_key(mobile_key):
        raise api_error(409, "DUPLICATE_MOBILE", "This mobile number is already registered. Nothing was changed.")
    if Path(photo.filename or "").suffix.lower() not in ALLOWED_IMAGE_EXTENSIONS:
        raise api_error(400, "INVALID_IMAGE", "Photo must be a JPG, PNG or WebP image.")
    img = decode_image(read_limited(photo, REGISTRATION_PHOTO_MAX_MB * 1024 * 1024, "photo"), "photo")

    embedding, _ = _workflow(face_service.registration_embedding, img)

    if not confirm_duplicate_face:
        for other in person_store.all_embeddings():
            if other["embedder"] == face_service.embedder_name and \
                    cosine_similarity(embedding, other["embedding"]) >= FACE_DUPLICATE_THRESHOLD:
                raise api_error(409, "DUPLICATE_FACE",
                                f"This face looks already registered (ID {other['code']}). Nothing was changed.")

    h, w = img.shape[:2]
    scale = 1024 / max(h, w)
    stored = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA) if scale < 1 else img
    photo_file = f"{uuid.uuid4().hex}.jpg"           # re-encoded: strips EXIF/metadata, random name
    photo_path = FACE_DIR / photo_file
    if not cv2.imwrite(str(photo_path), stored, [cv2.IMWRITE_JPEG_QUALITY, 92]):
        raise api_error(500, "STORAGE_ERROR", "Could not store the face photo.")
    try:
        person = person_store.create_person(clean_name, mobile_display, mobile_key, photo_file,
                                            embedding, face_service.embedder_name)
    except DuplicateMobileError:
        photo_path.unlink(missing_ok=True)
        raise api_error(409, "DUPLICATE_MOBILE", "This mobile number is already registered. Nothing was changed.")
    except Exception:
        photo_path.unlink(missing_ok=True)
        raise
    return {"status": "registered", "person": verification_service.person_public(person, full=True)}


@app.get("/api/persons")
def list_persons():
    """Registered Workers page: every permanently registered worker (never the embeddings)."""
    return {"workers": [
        {"id": p["id"], "code": p["code"], "name": p["name"], "mobile": p["mobile"],
         "image": verification_service.photo_url(p["photo_file"]), "created_at": p["created_at"]}
        for p in person_store.list_persons()]}


@app.delete("/api/persons/{person_id}")
def delete_person(person_id: int):
    """The ONLY way a registration disappears: the administrator's explicit Delete."""
    person = person_store.delete_person(person_id)
    if not person:
        raise api_error(404, "UNKNOWN_PERSON", "No registered worker found.")
    verification_service.drop_person_sessions(person_id)
    if PHOTO_NAME_RE.match(person["photo_file"]):
        (FACE_DIR / person["photo_file"]).unlink(missing_ok=True)
    return {"status": "deleted", "name": person["name"], "message": f"{person['name']} removed from registered workers."}


@app.get("/api/persons/lookup")
def lookup_person(mobile: str):
    try:
        _, key = normalize_mobile(mobile)
    except ValueError as exc:
        raise api_error(422, "INVALID_INPUT", str(exc))
    person = person_store.find_by_mobile_key(key)
    if not person:
        raise api_error(404, "UNKNOWN_PERSON", "No registered person with this mobile number. Register first.")
    return {"person": verification_service.person_public(person)}


@app.get("/api/persons/{person_id}")
def get_person(person_id: int):
    person = person_store.get_person(person_id)
    if not person:
        raise api_error(404, "UNKNOWN_PERSON", "No registered person found.")
    return {"person": verification_service.person_public(person)}


@app.get("/api/person-photos/{filename}")
def person_photo(filename: str):
    # Private store (not under the public /uploads mount); names are random 128-bit tokens.
    if not PHOTO_NAME_RE.match(filename) or not (FACE_DIR / filename).is_file():
        raise HTTPException(status_code=404, detail="Photo not found")
    return FileResponse(FACE_DIR / filename, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


class StartVerificationBody(BaseModel):
    person_id: Optional[int] = None   # omitted -> live 1:N identification against all registered workers


@app.post("/api/verify/start")
def verify_start(body: StartVerificationBody):
    return _workflow(verification_service.start, body.person_id)


@app.post("/api/verify/frame")
def verify_frame(session_id: str = Form(...), file: UploadFile = File(...)):
    frame = decode_image(read_limited(file, FRAME_MAX_BYTES, "frame"), "camera frame")
    return _workflow(verification_service.process_frame, session_id, frame)


@app.get("/api/verify/session/{session_id}")
def verify_session(session_id: str):
    return _workflow(verification_service.get_state, session_id)


@app.post("/api/ppe/check")
def ppe_check(file: UploadFile = File(...)):
    """Stateless single-image PPE check. Informational only - it can NEVER authorize work."""
    ok, reason = ppe_workflow_ready()
    if not ok:
        raise api_error(503, "PPE_MODEL_UNAVAILABLE", reason)
    img = decode_image(read_limited(file, 10 * 1024 * 1024, "image"), "image")
    detections = [d for d in workflow_ppe_detect(img) if d["conf"] >= PPE_VERIFY_CONFIDENCE]
    seen = {d["item"] for d in detections}
    ppe = {item: item in seen and f"no_{item}" not in seen for item in REQUIRED_ITEMS}
    return {
        "detections": [{"item": d["item"], "model_class": d["model_class"], "conf": round(d["conf"], 3), "box": d["box"]}
                       for d in detections],
        "ppe": ppe, **compute_compliance(ppe),
        "single_frame": True, "work_allowed": False,
        "note": "Single-frame check only. Work authorization requires a face-verified, multi-frame session.",
    }


# ===========================================================================
# PPE alerts (violation history; separate from worker registration data)
# ===========================================================================
@app.get("/api/alerts")
def list_ppe_alerts(limit: int = 200):
    purge_expired_ppe_alerts()
    return {"alerts": [public_alert(a) for a in person_store.list_alerts(max(1, min(int(limit), 1000)))],
            "retention_hours": PPE_ALERT_RETENTION_HOURS}


@app.get("/api/alert-images/{filename}")
def alert_image(filename: str):
    if not ALERT_IMAGE_RE.match(filename) or not (ALERT_DIR / filename).is_file():
        raise HTTPException(status_code=404, detail="Image not found")
    return FileResponse(ALERT_DIR / filename, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})


# ===========================================================================
# Live verification: backend camera -> face identification (1:N) -> PPE -> alert
# ===========================================================================
live_verifier = LiveVerifier(verification_service, face_service, LIVE_RESULT_MIN_HOLD_SECONDS, LIVE_LEAVE_SECONDS)
live_meta = {"active": False, "last_frame_at": 0.0, "camera_error": None}
live_meta_lock = threading.Lock()
CAMERA_UNAVAILABLE = "Camera unavailable. Please check your camera connection."


def live_stream_busy():
    return live_meta["active"] and time.time() - live_meta["last_frame_at"] < 10


def live_verify_frames():
    """MJPEG generator: camera frame -> LiveVerifier -> annotated JPEG. One viewer at a time."""
    cap = None
    interval = max(1.0 / LIVE_FPS, VERIFY_MIN_FRAME_INTERVAL_SECONDS + 0.02)
    try:
        live_verifier.reset()
        cap = open_rtsp_camera()
        last_emit, failures = 0.0, 0
        while True:
            ok, frame = cap.read()
            if not ok or frame is None:
                failures += 1
                if failures >= 20:
                    raise RuntimeError("Camera stopped delivering frames.")
                time.sleep(0.05)
                continue
            failures = 0
            now = time.perf_counter()
            if now - last_emit < interval:
                continue
            last_emit = now
            live_meta["last_frame_at"] = time.time()
            live_meta["camera_error"] = None
            try:
                live_verifier.step(frame)
            except Exception as exc:  # noqa: BLE001 - one bad frame must not stop the stream
                print(f"[LIVE VERIFY ERROR] {exc}")
            ok, buf = cv2.imencode(".jpg", annotate_live_frame(frame, live_verifier.snapshot),
                                   [cv2.IMWRITE_JPEG_QUALITY, LIVE_JPEG_QUALITY])
            if ok:
                yield b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + buf.tobytes() + b"\r\n"
    except GeneratorExit:
        pass
    except Exception as exc:  # noqa: BLE001
        print(f"[LIVE VERIFY CAMERA ERROR] {exc}")
        live_meta["camera_error"] = CAMERA_UNAVAILABLE
        live_meta["camera_detail"] = str(exc)
    finally:
        if cap is not None:
            cap.release()
        live_meta["active"] = False


@app.get("/api/live-verify/stream")
def live_verify_stream():
    if not CAMERA_RTSP_URL:
        live_meta["camera_error"] = CAMERA_UNAVAILABLE
        raise api_error(503, "CAMERA_UNAVAILABLE", CAMERA_UNAVAILABLE)
    with live_meta_lock:
        if live_stream_busy():
            raise api_error(409, "STREAM_IN_USE", "Live verification is already running in another window.")
        live_meta.update(active=True, last_frame_at=time.time(), camera_error=None)
    return StreamingResponse(live_verify_frames(), media_type="multipart/x-mixed-replace; boundary=frame",
                             headers={"Cache-Control": "no-cache", "Pragma": "no-cache"})


@app.get("/api/live-verify/state")
def live_verify_state():
    state = copy.deepcopy(live_verifier.public_state())
    for holder in (state.get("snapshot"), state.get("last_result")):
        result = (holder or {}).get("result")
        if result and result.get("alert_id"):          # late information: the e-mail finishes after the result
            alert = person_store.get_alert(result["alert_id"])
            if alert:
                result["alert"] = public_alert(alert)
                result["email_status"] = alert["email_status"]
    state["camera"] = {"active": live_stream_busy(), "configured": bool(CAMERA_RTSP_URL),
                       "error": live_meta.get("camera_error") or (None if CAMERA_RTSP_URL else CAMERA_UNAVAILABLE)}
    state["registered_workers"] = person_store.count()
    return state


@app.post("/api/live-verify/next")
def live_verify_next():
    live_verifier.request_next()
    return {"status": "ok"}
