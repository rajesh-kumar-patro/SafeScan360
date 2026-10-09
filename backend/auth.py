"""Sign Up / Sign In support for SafeScan360 (NEW module, additive).

Design notes
------------
* Uses the EXISTING SQLite database (``data/safescan.db``, ``config.DB_PATH``).  Only
  ``CREATE TABLE IF NOT EXISTS`` is executed, so existing tables/rows are never touched,
  dropped or recreated.
* No new Python packages: passwords are hashed with ``hashlib.scrypt`` (memory-hard KDF from
  the standard library) with a random per-user salt.  Plain-text passwords are never stored
  or logged.
* Sessions are server-side: the browser only holds a random opaque token in an HttpOnly
  cookie; the database stores just the SHA-256 of that token, so a leaked database cannot be
  used to log in.  Logout deletes the session row.
* This file has no FastAPI dependency so the logic can be unit-tested on its own.  The HTTP
  routes / access-control middleware live in ``backend/auth_routes.py``.
"""
from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import sqlite3
import threading
import time
from datetime import datetime
from typing import Dict, List, Optional, Tuple

# Reuse the project's existing name / mobile validation so both registration flows agree.
from backend.person_store import normalize_mobile, normalize_name

# --------------------------------------------------------------------------- settings
SESSION_COOKIE = "safescan_session"
SESSION_TTL_SECONDS = 12 * 3600           # a login lasts 12 hours (override via AUTH_SESSION_HOURS)
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128                 # bound the work an attacker can force the KDF to do

# scrypt cost parameters (N=2**14, r=8, p=1 ~= 16 MiB, tens of ms: strong yet fast enough for a login)
_SCRYPT_N, _SCRYPT_R, _SCRYPT_P, _SCRYPT_DKLEN = 2 ** 14, 8, 1, 32
_HASH_PREFIX = "scrypt"

_EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$")


class AuthError(Exception):
    """A user-correctable problem. ``fields`` maps form field -> message for the UI."""

    def __init__(self, message: str, fields: Optional[Dict[str, str]] = None, status: int = 400):
        super().__init__(message)
        self.message = message
        self.fields = fields or {}
        self.status = status


class DuplicateEmailError(AuthError):
    def __init__(self):
        super().__init__("An account with this email already exists. Please sign in.",
                         {"email": "This email is already registered."}, status=409)


# --------------------------------------------------------------------------- hashing
def hash_password(password: str) -> str:
    """Return ``scrypt$N$r$p$salt_hex$hash_hex`` for storage."""
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R,
                            p=_SCRYPT_P, dklen=_SCRYPT_DKLEN, maxmem=64 * 1024 * 1024)
    return f"{_HASH_PREFIX}${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    """Constant-time check of ``password`` against a hash made by :func:`hash_password`."""
    try:
        prefix, n, r, p, salt_hex, hash_hex = stored.split("$")
        if prefix != _HASH_PREFIX:
            return False
        expected = bytes.fromhex(hash_hex)
        digest = hashlib.scrypt(password.encode("utf-8"), salt=bytes.fromhex(salt_hex), n=int(n),
                                r=int(r), p=int(p), dklen=len(expected), maxmem=64 * 1024 * 1024)
        return hmac.compare_digest(digest, expected)
    except (ValueError, TypeError):
        return False


# A real hash of a random value, used so "unknown email" costs the same time as "wrong password".
_DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


# --------------------------------------------------------------------------- validation
def normalize_email(raw: str) -> str:
    email = (raw or "").strip().lower()
    if not email:
        raise AuthError("Email address is required.", {"email": "Email address is required."})
    if len(email) > 254 or not _EMAIL_RE.match(email) or ".." in email:
        raise AuthError("Enter a valid email address.", {"email": "Enter a valid email address."})
    return email


def validate_password(password: str) -> None:
    pw = password or ""
    if len(pw) < PASSWORD_MIN_LENGTH:
        raise AuthError(f"Password must be at least {PASSWORD_MIN_LENGTH} characters.",
                        {"password": f"Use at least {PASSWORD_MIN_LENGTH} characters."})
    if len(pw) > PASSWORD_MAX_LENGTH:
        raise AuthError("Password is too long.", {"password": f"Use at most {PASSWORD_MAX_LENGTH} characters."})
    if not re.search(r"[A-Za-z]", pw) or not re.search(r"\d", pw):
        raise AuthError("Password must contain at least one letter and one number.",
                        {"password": "Include at least one letter and one number."})


def validate_signup(name: str, email: str, mobile: str, password: str, confirm_password: str) -> Dict[str, str]:
    """Validate every field and report ALL problems at once (so the form can mark each field)."""
    errors: Dict[str, str] = {}
    cleaned: Dict[str, str] = {}
    try:
        cleaned["name"] = normalize_name(name)
    except ValueError as exc:
        errors["name"] = str(exc)
    try:
        cleaned["email"] = normalize_email(email)
    except AuthError as exc:
        errors["email"] = exc.fields.get("email", exc.message)
    try:
        cleaned["mobile"], _ = normalize_mobile(mobile)
    except ValueError as exc:
        errors["mobile"] = str(exc)
    try:
        validate_password(password)
    except AuthError as exc:
        errors["password"] = exc.fields.get("password", exc.message)
    if "password" not in errors and password != confirm_password:
        errors["confirm_password"] = "Passwords do not match."
    elif not confirm_password:
        errors["confirm_password"] = "Please confirm your password."
    if errors:
        raise AuthError("Please correct the highlighted fields.", errors)
    return cleaned


# --------------------------------------------------------------------------- storage
class AuthStore:
    """Users + login sessions in the existing SQLite database."""

    def __init__(self, db_path, session_ttl: float = SESSION_TTL_SECONDS):
        self.db_path = str(db_path)
        self.session_ttl = float(session_ttl)
        self._lock = threading.Lock()
        self._attempts: Dict[str, List[float]] = {}      # throttle: key -> recent failure times
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init_db(self) -> None:
        # CREATE ... IF NOT EXISTS only: the existing database and its tables are left untouched.
        with self._lock, self._conn() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    name          TEXT NOT NULL,
                    email         TEXT NOT NULL UNIQUE,
                    mobile        TEXT NOT NULL,
                    password_hash TEXT NOT NULL,
                    created_at    TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS user_sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    created_at REAL NOT NULL,
                    expires_at REAL NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_user_sessions_user ON user_sessions(user_id);
                """
            )

    @staticmethod
    def _public(row: sqlite3.Row) -> Dict:
        """User info that is safe to send to the browser (never the hash)."""
        return {"id": row["id"], "name": row["name"], "email": row["email"],
                "mobile": row["mobile"], "created_at": row["created_at"]}

    # ---- sign up
    def create_user(self, name: str, email: str, mobile: str, password: str, confirm_password: str) -> Dict:
        cleaned = validate_signup(name, email, mobile, password, confirm_password)
        pw_hash = hash_password(password)
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        try:
            with self._conn() as conn:
                cur = conn.execute(
                    "INSERT INTO users (name, email, mobile, password_hash, created_at) VALUES (?,?,?,?,?)",
                    (cleaned["name"], cleaned["email"], cleaned["mobile"], pw_hash, now),
                )
                row = conn.execute("SELECT * FROM users WHERE id=?", (cur.lastrowid,)).fetchone()
        except sqlite3.IntegrityError as exc:           # UNIQUE(email) - also covers a race between two requests
            raise DuplicateEmailError() from exc
        return self._public(row)

    # ---- sign in
    def _throttled(self, key: str, now: float, limit: int = 5, window: float = 300.0) -> bool:
        recent = [t for t in self._attempts.get(key, []) if now - t < window]
        self._attempts[key] = recent
        return len(recent) >= limit

    def authenticate(self, email: str, password: str) -> Dict:
        """Return the user dict or raise AuthError. Same message for unknown email / wrong password."""
        generic = AuthError("Invalid email or password.", status=401)
        try:
            key = normalize_email(email)
        except AuthError:
            verify_password(password or "", _DUMMY_HASH)
            raise generic
        now = time.time()
        with self._lock:
            if self._throttled(key, now):
                raise AuthError("Too many failed attempts. Please wait a few minutes and try again.", status=429)
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM users WHERE email=?", (key,)).fetchone()
        stored = row["password_hash"] if row else _DUMMY_HASH
        ok = verify_password(password or "", stored) and row is not None
        if not ok:
            with self._lock:
                self._attempts.setdefault(key, []).append(now)
            raise generic
        with self._lock:
            self._attempts.pop(key, None)
        return self._public(row)

    # ---- sessions
    @staticmethod
    def _token_hash(token: str) -> str:
        return hashlib.sha256(token.encode("utf-8")).hexdigest()

    def create_session(self, user_id: int) -> Tuple[str, float]:
        """Return (token, ttl_seconds). Only the token's hash is stored."""
        token = secrets.token_urlsafe(32)
        now = time.time()
        with self._conn() as conn:
            conn.execute("DELETE FROM user_sessions WHERE expires_at < ?", (now,))   # opportunistic clean-up
            conn.execute("INSERT INTO user_sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)",
                         (self._token_hash(token), user_id, now, now + self.session_ttl))
        return token, self.session_ttl

    def user_for_token(self, token: Optional[str]) -> Optional[Dict]:
        if not token:
            return None
        with self._conn() as conn:
            row = conn.execute(
                "SELECT u.* FROM user_sessions s JOIN users u ON u.id = s.user_id "
                "WHERE s.token_hash=? AND s.expires_at > ?",
                (self._token_hash(token), time.time()),
            ).fetchone()
        return self._public(row) if row else None

    def delete_session(self, token: Optional[str]) -> None:
        if not token:
            return
        with self._conn() as conn:
            conn.execute("DELETE FROM user_sessions WHERE token_hash=?", (self._token_hash(token),))
