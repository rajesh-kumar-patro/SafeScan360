"""SQLite storage for registered people and verification audit records."""
from __future__ import annotations

import re
import sqlite3
import threading
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np


class DuplicateMobileError(Exception):
    pass


def normalize_name(raw: str) -> str:
    name = re.sub(r"\s+", " ", (raw or "")).strip()
    if not (2 <= len(name) <= 80):
        raise ValueError("Full name must be between 2 and 80 characters.")
    if not re.search(r"[^\W\d_]", name):
        raise ValueError("Full name must contain letters.")
    if re.search(r"[\x00-\x1f\x7f<>]", name):
        raise ValueError("Full name contains invalid characters.")
    return name


def normalize_mobile(raw: str) -> Tuple[str, str]:
    """Return (display_value, uniqueness_key). Accepts spaces, dashes, brackets, leading +."""
    text = (raw or "").strip()
    digits = re.sub(r"\D", "", text)
    if re.search(r"[^\d\s+\-().]", text) or not (7 <= len(digits) <= 15):
        raise ValueError("Enter a valid mobile number (7-15 digits).")
    display = ("+" if text.startswith("+") else "") + digits
    key = digits[-10:] if len(digits) >= 10 else digits  # +91 98765 43210 == 9876543210
    return display, key


def mask_mobile(mobile: str) -> str:
    digits = re.sub(r"\D", "", mobile)
    return "•" * max(0, len(digits) - 4) + digits[-4:]


class PersonStore:
    def __init__(self, db_path):
        self.db_path = str(db_path)
        self._init_lock = threading.Lock()
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys=ON")
        return conn

    def _init_db(self):
        with self._init_lock, self._conn() as conn:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS persons (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    code TEXT UNIQUE,
                    name TEXT NOT NULL,
                    mobile TEXT NOT NULL,
                    mobile_key TEXT NOT NULL UNIQUE,
                    photo_file TEXT NOT NULL,
                    embedding BLOB NOT NULL,
                    embedder TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS verifications (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    person_id INTEGER NOT NULL REFERENCES persons(id),
                    session_id TEXT,
                    face_verified INTEGER NOT NULL,
                    face_score REAL,
                    ppe_json TEXT,
                    ppe_percentage REAL,
                    missing_json TEXT,
                    work_allowed INTEGER NOT NULL,
                    status TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );
                -- Detection / violation data. Deliberately has NO foreign key to persons:
                -- alerts keep a snapshot of the worker and survive a worker being deleted.
                CREATE TABLE IF NOT EXISTS ppe_alerts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    worker_id TEXT,
                    worker_name TEXT NOT NULL,
                    mobile TEXT,
                    timestamp TEXT NOT NULL,
                    created_ts REAL NOT NULL,
                    compliance_percentage REAL NOT NULL,
                    missing_ppe TEXT NOT NULL,
                    captured_image TEXT,
                    email_status TEXT NOT NULL DEFAULT 'pending'
                );
                -- Registration data under the name used in the requirements. The physical table keeps
                -- its original name (persons) so existing databases need no migration.
                CREATE VIEW IF NOT EXISTS workers AS
                    SELECT id, code AS worker_id, name, mobile, photo_file AS face_image,
                           embedding AS face_embedding, created_at FROM persons;
                """
            )

    @staticmethod
    def _person(row: sqlite3.Row, with_embedding=False) -> Dict:
        data = {
            "id": row["id"], "code": row["code"], "name": row["name"], "mobile": row["mobile"],
            "photo_file": row["photo_file"], "embedder": row["embedder"], "created_at": row["created_at"],
        }
        if with_embedding:
            data["embedding"] = np.frombuffer(row["embedding"], dtype=np.float32).copy()
        return data

    def create_person(self, name: str, mobile: str, mobile_key: str, photo_file: str,
                      embedding: np.ndarray, embedder: str) -> Dict:
        """Insert a new person. Never updates an existing row."""
        blob = np.asarray(embedding, dtype=np.float32).tobytes()
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        try:
            with self._conn() as conn:
                cur = conn.execute(
                    "INSERT INTO persons (name, mobile, mobile_key, photo_file, embedding, embedder, created_at) "
                    "VALUES (?,?,?,?,?,?,?)",
                    (name, mobile, mobile_key, photo_file, blob, embedder, now),
                )
                pid = cur.lastrowid
                conn.execute("UPDATE persons SET code=? WHERE id=?", (f"P-{pid:06d}", pid))
        except sqlite3.IntegrityError as exc:
            if "mobile_key" in str(exc):
                raise DuplicateMobileError() from exc
            raise
        return self.get_person(pid)

    def get_person(self, person_id: int, with_embedding=False) -> Optional[Dict]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM persons WHERE id=?", (person_id,)).fetchone()
        return self._person(row, with_embedding) if row else None

    def find_by_mobile_key(self, mobile_key: str) -> Optional[Dict]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM persons WHERE mobile_key=?", (mobile_key,)).fetchone()
        return self._person(row) if row else None

    def all_embeddings(self) -> List[Dict]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM persons").fetchall()
        return [self._person(r, with_embedding=True) for r in rows]

    def list_persons(self) -> List[Dict]:
        """All registered workers (no embeddings), oldest first."""
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM persons ORDER BY id").fetchall()
        return [self._person(r) for r in rows]

    def delete_person(self, person_id: int) -> Optional[Dict]:
        """Permanently remove a worker's registration row (and the audit rows that reference it).

        Only ever called from the administrator's Delete action. Returns the deleted person
        (so the caller can remove the photo file) or None if there was no such person.
        PPE alerts are kept: they hold their own snapshot of the worker's name / mobile.
        """
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM persons WHERE id=?", (person_id,)).fetchone()
            if not row:
                return None
            conn.execute("DELETE FROM verifications WHERE person_id=?", (person_id,))
            conn.execute("DELETE FROM persons WHERE id=?", (person_id,))
        return self._person(row)

    # -- PPE alerts (separate from registration data) -----------------------
    @staticmethod
    def _alert(row: sqlite3.Row) -> Dict:
        import json
        return {
            "id": row["id"], "worker_id": row["worker_id"], "worker_name": row["worker_name"],
            "mobile": row["mobile"], "timestamp": row["timestamp"],
            "compliance_percentage": row["compliance_percentage"],
            "missing_ppe": json.loads(row["missing_ppe"] or "[]"),
            "captured_image": row["captured_image"], "email_status": row["email_status"],
        }

    def add_alert(self, worker_id: Optional[str], worker_name: str, mobile: Optional[str],
                  compliance_percentage: float, missing_ppe: List[str], captured_image: Optional[str],
                  email_status: str = "pending") -> Dict:
        import json
        import time
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO ppe_alerts (worker_id, worker_name, mobile, timestamp, created_ts, "
                "compliance_percentage, missing_ppe, captured_image, email_status) VALUES (?,?,?,?,?,?,?,?,?)",
                (worker_id, worker_name, mobile, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), time.time(),
                 compliance_percentage, json.dumps(list(missing_ppe)), captured_image, email_status),
            )
            aid = cur.lastrowid
        return self.get_alert(aid)

    def get_alert(self, alert_id: int) -> Optional[Dict]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM ppe_alerts WHERE id=?", (alert_id,)).fetchone()
        return self._alert(row) if row else None

    def set_alert_email_status(self, alert_id: int, status: str) -> None:
        with self._conn() as conn:
            conn.execute("UPDATE ppe_alerts SET email_status=? WHERE id=?", (status, alert_id))

    def list_alerts(self, limit: int = 200) -> List[Dict]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM ppe_alerts ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [self._alert(r) for r in rows]

    def purge_alerts_older_than(self, cutoff_ts: float) -> List[str]:
        """Delete expired PPE alerts only (never registrations). Returns their image file names."""
        with self._conn() as conn:
            rows = conn.execute("SELECT id, captured_image FROM ppe_alerts WHERE created_ts < ?",
                                (cutoff_ts,)).fetchall()
            conn.execute("DELETE FROM ppe_alerts WHERE created_ts < ?", (cutoff_ts,))
        return [r["captured_image"] for r in rows if r["captured_image"]]

    def count(self) -> int:
        with self._conn() as conn:
            return conn.execute("SELECT COUNT(*) FROM persons").fetchone()[0]

    def add_verification(self, person_id: int, session_id: str, face_verified: bool, face_score: Optional[float],
                         ppe: Optional[Dict], ppe_percentage: Optional[float], missing: Optional[List[str]],
                         work_allowed: bool, status: str) -> int:
        import json
        with self._conn() as conn:
            cur = conn.execute(
                "INSERT INTO verifications (person_id, session_id, face_verified, face_score, ppe_json, "
                "ppe_percentage, missing_json, work_allowed, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (person_id, session_id, int(face_verified), face_score,
                 json.dumps(ppe) if ppe is not None else None, ppe_percentage,
                 json.dumps(missing) if missing is not None else None, int(work_allowed), status,
                 datetime.now().strftime("%Y-%m-%d %H:%M:%S")),
            )
            return cur.lastrowid

    def list_verifications(self, limit=50) -> List[Dict]:
        with self._conn() as conn:
            rows = conn.execute("SELECT * FROM verifications ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
        return [dict(r) for r in rows]
