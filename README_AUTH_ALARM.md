# SafeScan360 — Sign Up / Sign In + Live PPE Voice Alarm

Additive update. Detection, tracking, verification, email alerts, the models and the existing
SQLite database are unchanged.

## 1. Sign Up / Sign In

Flow: `Welcome` → `Sign In` / `Sign Up` → existing `Dashboard` → everything else. `Logout` (navbar) clears the
session and returns to Sign In.

* **Storage** — existing database `data/safescan.db`. Two tables are added with `CREATE TABLE IF NOT EXISTS`
  (existing tables/rows are never touched):
  * `users (id, name, email UNIQUE, mobile, password_hash, created_at)`
  * `user_sessions (token_hash, user_id, created_at, expires_at)`
* **Passwords** — salted `scrypt` hash (Python standard library, no new package). Plain text is never stored.
* **Session** — random token in an HttpOnly, SameSite=Lax cookie; only its SHA-256 is stored server-side.
  Valid for `AUTH_SESSION_HOURS` (default 12) or until Logout.
* **Access control** — `AuthMiddleware` (backend/auth_routes.py) rejects every endpoint with `401` unless the
  request carries a valid session; only `/api/auth/*` and `/api/health` are public. This covers the MJPEG
  camera stream, uploads and all existing APIs. In the React app, logged-out visitors can only reach
  `/welcome`, `/signin`, `/signup`.
* **Validation** — name, email format, mobile (7–15 digits, same rule as worker registration), password
  (≥ 8 chars, letter + number), confirm match, unique email (case-insensitive). Checked in the browser and again on
  the server. Wrong email/password give the same message (no account enumeration); 5 failures in 5 min lock
  that email for a few minutes.

## 2. Live PPE absence alarm

* The existing tracker already computes `missing` items per worker. `summarize_ppe_status()`
  (backend/ppe_workflow.py, called at the end of `MultiWorkerTracker.process`) adds `ppe_status` to every
  `/api/live-stats` reply: `status`, `missing`, `detected`, `announcement`, `signature`.
  Item names come from the project's own classes (helmet, vest, shoes ← model's "boots", gloves).
* The browser speaks the sentence with the Web Speech API (`src/utils/ppeAlarm.js`) after a short beep.
  Nothing runs in the video path, so FPS is unaffected.
* **No spam**: same warning repeats at most every 4 s; a *changed* set of missing items is announced at once
  (≥ 1.5 s after the previous one); a short missing→OK→missing flicker does not reset the cooldown; when all PPE
  is present speech stops and nothing is said; stale results (stream stopped / camera error) are ignored.
* With several workers in view the warning covers the union of what is missing, e.g.
  "Warning. Helmet and gloves are missing." The per-worker cards on the page still show who is missing what.
* UI: a **PPE ALERT** panel (Missing ❌ / Detected ✅, or **✅ ALL PPE DETECTED**) plus *Voice alarm ON/OFF* and
  *Test voice* buttons (the choice is remembered in the browser). Click *Test voice* once if a browser blocks
  audio until you interact with the page.

Scope: the alarm is on the **Live Detection** page. The Work Verification (`/verify`) flow is unchanged.

## Run

```
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt          # no new packages
python -m uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
cd frontend-react && npm install && npm run dev      # http://localhost:5173
```
Open http://localhost:5173 (use the Vite URL, not :8000, so the session cookie and `/api` proxy line up).

## Tests (no camera / models needed)

```
python -m unittest discover tests -v                  # auth + alarm message logic
cd frontend-react && node --test tests/ppeAlarm.test.mjs   # cooldown / voice controller
```
