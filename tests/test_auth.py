"""Unit tests for backend/auth.py (stdlib unittest, no FastAPI needed).  Run:  python -m unittest discover tests -v"""
import sqlite3, tempfile, time, unittest
from pathlib import Path

import numpy as np

from backend.auth import (AuthError, AuthStore, DuplicateEmailError, hash_password, verify_password)
from backend.person_store import PersonStore

GOOD = dict(name="Asha Verma", email="Asha.Verma@Example.com", mobile="+91 98765 43210",
            password="Secret123", confirm_password="Secret123")


class AuthTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "safescan.db"
        self.store = AuthStore(self.db)

    def tearDown(self):
        self.tmp.cleanup()

    # ---- sign up
    def test_signup_stores_hashed_password(self):
        user = self.store.create_user(**GOOD)
        self.assertNotIn("password_hash", user)
        row = sqlite3.connect(self.db).execute("SELECT name,email,mobile,password_hash FROM users").fetchone()
        self.assertEqual(row[0], "Asha Verma")
        self.assertEqual(row[1], "asha.verma@example.com")          # normalised to lower-case
        self.assertEqual(row[2], "+919876543210")
        self.assertNotIn("Secret123", row[3])
        self.assertTrue(row[3].startswith("scrypt$"))

    def test_same_password_gets_different_hashes(self):
        self.assertNotEqual(hash_password("Secret123"), hash_password("Secret123"))
        self.assertTrue(verify_password("Secret123", hash_password("Secret123")))
        self.assertFalse(verify_password("Secret124", hash_password("Secret123")))
        self.assertFalse(verify_password("x", "garbage"))

    def test_duplicate_email_rejected_case_insensitive(self):
        self.store.create_user(**GOOD)
        with self.assertRaises(DuplicateEmailError) as cm:
            self.store.create_user(**{**GOOD, "email": "  ASHA.VERMA@example.COM "})
        self.assertEqual(cm.exception.status, 409)
        self.assertEqual(sqlite3.connect(self.db).execute("SELECT COUNT(*) FROM users").fetchone()[0], 1)

    def test_validation_reports_every_bad_field(self):
        with self.assertRaises(AuthError) as cm:
            self.store.create_user("", "not-an-email", "12", "short", "different")
        f = cm.exception.fields
        for k in ("name", "email", "mobile", "password"):
            self.assertIn(k, f, k)

    def test_password_rules_and_mismatch(self):
        for bad in ("abcdefgh", "12345678", "Ab1"):
            with self.assertRaises(AuthError) as cm:
                self.store.create_user(**{**GOOD, "password": bad, "confirm_password": bad})
            self.assertIn("password", cm.exception.fields)
        with self.assertRaises(AuthError) as cm:
            self.store.create_user(**{**GOOD, "confirm_password": "Secret124"})
        self.assertEqual(list(cm.exception.fields), ["confirm_password"])

    def test_bad_emails(self):
        for e in ("a@b", "a@@b.com", "a b@c.com", "a..b@c.com", "@c.com", "a@c..com", ""):
            with self.assertRaises(AuthError, msg=e):
                self.store.create_user(**{**GOOD, "email": e})

    def test_bad_mobiles(self):
        for m in ("abc", "12345", "98765-4321x", ""):
            with self.assertRaises(AuthError, msg=m):
                self.store.create_user(**{**GOOD, "mobile": m})

    # ---- sign in
    def test_signin_success_and_failures(self):
        self.store.create_user(**GOOD)
        user = self.store.authenticate("asha.verma@example.com", "Secret123")
        self.assertEqual(user["name"], "Asha Verma")
        with self.assertRaises(AuthError) as wrong_pw:
            self.store.authenticate("asha.verma@example.com", "Wrong1234")
        with self.assertRaises(AuthError) as no_user:
            self.store.authenticate("nobody@example.com", "Wrong1234")
        self.assertEqual(wrong_pw.exception.status, 401)
        self.assertEqual(wrong_pw.exception.message, no_user.exception.message)   # no account enumeration

    def test_brute_force_throttle(self):
        self.store.create_user(**GOOD)
        for _ in range(5):
            with self.assertRaises(AuthError):
                self.store.authenticate("asha.verma@example.com", "Wrong1234")
        with self.assertRaises(AuthError) as cm:
            self.store.authenticate("asha.verma@example.com", "Secret123")        # even the right password
        self.assertEqual(cm.exception.status, 429)

    # ---- sessions / logout
    def test_session_lifecycle(self):
        user = self.store.create_user(**GOOD)
        token, _ = self.store.create_session(user["id"])
        self.assertEqual(self.store.user_for_token(token)["email"], "asha.verma@example.com")
        raw = sqlite3.connect(self.db).execute("SELECT token_hash FROM user_sessions").fetchone()[0]
        self.assertNotEqual(raw, token)                                          # only a hash is stored
        self.store.delete_session(token)                                         # logout
        self.assertIsNone(self.store.user_for_token(token))
        self.assertIsNone(self.store.user_for_token(None))
        self.assertIsNone(self.store.user_for_token("forged"))

    def test_session_expiry(self):
        store = AuthStore(self.db, session_ttl=0.2)
        user = store.create_user(**GOOD)
        token, _ = store.create_session(user["id"])
        self.assertIsNotNone(store.user_for_token(token))
        time.sleep(0.3)
        self.assertIsNone(store.user_for_token(token))

    # ---- existing database is preserved
    def test_existing_database_untouched(self):
        db = Path(self.tmp.name) / "existing.db"
        persons = PersonStore(db)
        p = persons.create_person("Ravi", "9876500000", "9876500000", "x.jpg", np.ones(4, np.float32), "sface")
        before = {r[0] for r in sqlite3.connect(db).execute("SELECT name FROM sqlite_master")}
        AuthStore(db); AuthStore(db)                                              # twice = idempotent
        after = {r[0] for r in sqlite3.connect(db).execute("SELECT name FROM sqlite_master")}
        self.assertTrue(before <= after)
        self.assertEqual(after - before, {"users", "user_sessions", "idx_user_sessions_user",
                                          "sqlite_autoindex_users_1", "sqlite_autoindex_user_sessions_1"})
        self.assertEqual(PersonStore(db).get_person(p["id"])["name"], "Ravi")     # old data intact


if __name__ == "__main__":
    unittest.main()
