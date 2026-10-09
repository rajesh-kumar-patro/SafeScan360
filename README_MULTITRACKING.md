# SafeScan360 — Multi-Worker Tracking Update

## Tracking fix (latest)

**Problem:** no tracking frame appeared on the live stream, for one person or many. `best.pt` only has
the classes helmet / vest / gloves / shoe — it has no `person` class — so the old tracker never found anyone.

**Fix:**
- New `backend/person_tracker.py`: a person detector (YOLO COCO `person`) + a tracker that gives every
  person a stable `Track #ID`. Works for one person or several, and keeps the frame for a few frames
  if the detector briefly misses someone.
- `backend/live_tracking.py` rewritten: draws a tracking frame (ID, name or UNKNOWN, PPE status) around
  every person, and assigns helmet/vest/gloves/shoe detections from `best.pt` to the right person.
- Fixed: the PPE model's tracker was being fed each frame twice; face crops were taken from an already
  drawn-on frame; faces are now matched from the head region (upscaled for small CCTV faces).
- The person model `yolov8n.pt` is downloaded automatically on the first run (needs internet once),
  or place `yolov8n.pt` in the project root. If it cannot be loaded, an OpenCV HOG fallback is used
  (less accurate) — check the backend console for the `[PERSON]` line.

This is an additive update to the existing SafeScan360 project.

## Added

- Persistent multi-worker tracking with YOLO + ByteTrack.
- Persistent `Track #ID` for every person in the live CP Plus stream.
- Read-only face identification against registered workers.
- Worker name/ID attached to the live track after face verification.
- Per-worker PPE state: helmet, vest, gloves, shoes.
- Temporal PPE-removal detection: if a required PPE item disappears for several consecutive live frames, the worker becomes unsafe and a PPE alert is generated.
- Unknown-person tracking.
- Relative camera-floor safety map at `/safety-map`.
- Worker position shown as normalized X/Y plus a 3x3 camera zone.
- Fire and smoke alarms continue using the existing `Fire_smoke.pt` model.
- Browser siren/visual alarm for hazards and PPE violations.
- Existing incident archive, PPE alerts, email alert system, worker registration, face verification and video/image detection remain in place.

## Important

Worker registration DOES NOT retrain the PPE model.

Registration stores the worker's face embedding. The live tracker periodically refreshes the registered-worker gallery and matches live faces against it.

## Required model files

The uploaded ZIPs did not contain the model weights. Put these files in the project root:

- `best.pt` — existing PPE/person YOLO model.
- `Fire_smoke.pt` — existing fire/smoke YOLO model.

The face ONNX models can be downloaded automatically by the existing face service, or placed in `models/`.

## Backend

From the project root:

```powershell
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

For NVIDIA GPU, install the CUDA-compatible PyTorch build appropriate for your machine if your existing environment does not already have it.

## Frontend

```powershell
cd frontend-react
npm install
npm run dev
```

Open:

`http://localhost:5173`

## Live workflow

1. Register workers at **Register Worker**.
2. Start **Live Detection**.
3. The CP Plus RTSP stream is processed by FastAPI.
4. YOLO assigns persistent Track IDs.
5. Each track is matched against registered face embeddings.
6. PPE is associated with that tracked person.
7. The worker's map position is calculated relative to the camera frame.
8. Missing PPE produces a safety violation and evidence/incident handling.
9. Fire/smoke detection produces a critical/high alert and siren.
10. Open **Safety Map** to see all active workers and their positions.

## Configuration

The following optional `.env` values control the new tracker:

```env
TRACK_PPE_ABSENCE_FRAMES=6
TRACK_IDENTITY_CONFIRM_FRAMES=2
TRACK_FACE_INTERVAL_FRAMES=3
```

Lower `TRACK_PPE_ABSENCE_FRAMES` makes removal alarms faster but can increase false alarms during occlusion. Increase it if workers frequently turn sideways or PPE is temporarily hidden.

Existing camera settings remain:

```env
CAMERA_RTSP_URL=rtsp://username:password@camera-ip:554/stream
RTSP_TRANSPORT=tcp
```

## Safety map limitation

The map is a **relative camera-floor map**, not GPS tracking. A worker's position is derived from the center of their bounding box in the camera image. This is appropriate for showing where a worker is inside a monitored camera area.

For real industrial floor coordinates, the next step is to define camera calibration/homography points or multiple camera zones.
