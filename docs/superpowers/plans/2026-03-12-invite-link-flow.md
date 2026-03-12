# Invite Link Flow Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace password-based user creation with an invite link flow where admins create users without passwords, the system emails a time-limited invite link, and the user sets their own password on first visit.

**Architecture:** New `invite_tokens` DB table stores tokens with 7-day expiry. Two new public API endpoints validate and accept invites. A new `/invite/:token` frontend page lets users set their password. Email is sent via SMTP (Python's `smtplib`). The existing `add-user` CLI and admin API are modified to create password-less users and trigger invite emails. Users without a `password_hash` cannot log in until they accept their invite.

**Tech Stack:** Python `smtplib` + `email.mime` (stdlib, no new deps), FastAPI, React, SQLite

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/jam_session_processor/db.py` | Modify | Add `invite_tokens` table to schema, migration, CRUD methods |
| `src/jam_session_processor/config.py` | Modify | Add SMTP + app URL env vars |
| `src/jam_session_processor/email.py` | Create | `send_invite_email()` using smtplib |
| `src/jam_session_processor/api.py` | Modify | Add public invite endpoints, modify user creation to be password-optional |
| `src/jam_session_processor/cli.py` | Modify | `add-user` creates invite instead of prompting for password, add `invite-user` command |
| `web/src/pages/AcceptInvite.tsx` | Create | Set-password page for invite tokens |
| `web/src/App.tsx` | Modify | Add `/invite/:token` route (public) |
| `web/src/api.ts` | Modify | Add `validateInvite()` and `acceptInvite()` API methods |
| `web/src/pages/Admin.tsx` | Modify | Remove password field from Add User modal, add "Resend invite" action |
| `docker-compose.yml` | Modify | Add SMTP + APP_URL env vars |
| `tests/test_invite.py` | Create | Tests for invite token DB operations, API endpoints, email sending |
| `CLAUDE.md` | Modify | Document new schema, endpoints, env vars |

---

## Chunk 1: Database Layer

### Task 1: Add invite_tokens table and DB methods

**Files:**
- Modify: `src/jam_session_processor/db.py`
- Test: `tests/test_invite.py`

- [ ] **Step 1: Write failing tests for invite token CRUD**

```python
# tests/test_invite.py
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from jam_session_processor.auth import hash_password
from jam_session_processor.config import reset_config
from jam_session_processor.db import Database


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
    reset_config()
    d = Database(tmp_path / "test.db")
    yield d
    d.close()
    reset_config()


class TestInviteTokens:
    def test_create_invite_token(self, db):
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)
        assert token is not None
        assert len(token) > 20  # secrets.token_urlsafe(32) is ~43 chars

    def test_get_invite_token(self, db):
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)
        row = db.get_invite_token(token)
        assert row is not None
        assert row["user_id"] == uid
        assert row["used_at"] is None

    def test_get_invite_token_not_found(self, db):
        assert db.get_invite_token("nonexistent") is None

    def test_consume_invite_token(self, db):
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)
        db.consume_invite_token(token)
        row = db.get_invite_token(token)
        assert row["used_at"] is not None

    def test_delete_invite_tokens_for_user(self, db):
        uid = db.create_user("alice@example.com", "", name="Alice")
        db.create_invite_token(uid, expires_hours=168)
        db.create_invite_token(uid, expires_hours=168)
        db.delete_invite_tokens_for_user(uid)
        # Verify both are gone (create new ones to test)
        # Actually, just check that creating + deleting works
        token = db.create_invite_token(uid, expires_hours=168)
        assert db.get_invite_token(token) is not None
        db.delete_invite_tokens_for_user(uid)
        assert db.get_invite_token(token) is None

    def test_create_user_without_password(self, db):
        """Users can be created with empty password_hash for invite flow."""
        uid = db.create_user("alice@example.com", "", name="Alice")
        user = db.get_user(uid)
        assert user is not None
        assert user.password_hash == ""
        assert user.email == "alice@example.com"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_invite.py -v`
Expected: FAIL — `create_invite_token` method does not exist

- [ ] **Step 3: Add invite_tokens table to schema and migration**

In `db.py`, add to `SCHEMA` string after the `share_links` table:

```python
CREATE TABLE IF NOT EXISTS invite_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Add to `Database.reset()` method, before the `share_links` drop:
```python
DROP TABLE IF EXISTS invite_tokens;
```

- [ ] **Step 4: Add invite token CRUD methods to Database class**

Add to `Database` class after the share links section:

```python
# --- Invite tokens ---

def create_invite_token(self, user_id: int, expires_hours: int = 168) -> str:
    """Create an invite token for a user. Returns the token string."""
    import secrets
    from datetime import datetime, timedelta, timezone

    token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + timedelta(hours=expires_hours)).strftime(
        "%Y-%m-%d %H:%M:%S"
    )
    self.conn.execute(
        "INSERT INTO invite_tokens (token, user_id, expires_at) VALUES (?, ?, ?)",
        (token, user_id, expires_at),
    )
    self.conn.commit()
    return token

def get_invite_token(self, token: str) -> dict | None:
    """Get an invite token record. Returns None if not found."""
    row = self.conn.execute(
        "SELECT * FROM invite_tokens WHERE token = ?", (token,)
    ).fetchone()
    return dict(row) if row else None

def consume_invite_token(self, token: str):
    """Mark a token as used."""
    self.conn.execute(
        "UPDATE invite_tokens SET used_at = datetime('now') WHERE token = ?",
        (token,),
    )
    self.conn.commit()

def delete_invite_tokens_for_user(self, user_id: int):
    """Delete all invite tokens for a user (used when resending invites)."""
    self.conn.execute("DELETE FROM invite_tokens WHERE user_id = ?", (user_id,))
    self.conn.commit()
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_invite.py -v`
Expected: All 6 tests PASS

- [ ] **Step 6: Run full test suite for regressions**

Run: `pytest`
Expected: All existing tests still pass

- [ ] **Step 7: Lint**

Run: `ruff check src/jam_session_processor/db.py tests/test_invite.py`
Expected: No errors

- [ ] **Step 8: Commit**

```bash
git add src/jam_session_processor/db.py tests/test_invite.py
git commit -m "feat: add invite_tokens table and CRUD methods"
```

---

## Chunk 2: Config and Email

### Task 2: Add SMTP and app URL configuration

**Files:**
- Modify: `src/jam_session_processor/config.py`

- [ ] **Step 1: Add SMTP and app URL fields to Config dataclass**

Add these fields to the `Config` dataclass:

```python
smtp_host: str
smtp_port: int
smtp_user: str
smtp_password: str
smtp_from: str
app_url: str
```

Add to `_build_config()` return:

```python
smtp_host=os.environ.get("JAM_SMTP_HOST", ""),
smtp_port=int(os.environ.get("JAM_SMTP_PORT", "587")),
smtp_user=os.environ.get("JAM_SMTP_USER", ""),
smtp_password=os.environ.get("JAM_SMTP_PASSWORD", ""),
smtp_from=os.environ.get("JAM_SMTP_FROM", ""),
app_url=os.environ.get("JAM_APP_URL", "http://localhost:5173"),
```

- [ ] **Step 2: Run existing tests for regressions**

Run: `pytest`
Expected: All tests pass

- [ ] **Step 3: Lint**

Run: `ruff check src/jam_session_processor/config.py`

- [ ] **Step 4: Commit**

```bash
git add src/jam_session_processor/config.py
git commit -m "feat: add SMTP and app URL config vars"
```

### Task 3: Create email module

**Files:**
- Create: `src/jam_session_processor/email.py`
- Test: `tests/test_invite.py` (append)

- [ ] **Step 1: Write failing test for send_invite_email**

Append to `tests/test_invite.py`:

```python
from unittest.mock import patch, MagicMock

from jam_session_processor.email import send_invite_email


@pytest.fixture(autouse=True)
def _reset_config_after_test():
    """Ensure config singleton is cleared after each test."""
    yield
    reset_config()


class TestInviteEmail:
    def test_send_invite_email_builds_correct_message(self, monkeypatch):
        """Verify the email is constructed and sent via SMTP."""
        monkeypatch.setenv("JAM_SMTP_HOST", "smtp.example.com")
        monkeypatch.setenv("JAM_SMTP_PORT", "587")
        monkeypatch.setenv("JAM_SMTP_USER", "user@example.com")
        monkeypatch.setenv("JAM_SMTP_PASSWORD", "secret")
        monkeypatch.setenv("JAM_SMTP_FROM", "noreply@example.com")
        monkeypatch.setenv("JAM_APP_URL", "https://jam.example.com")
        reset_config()

        mock_smtp_instance = MagicMock()
        mock_smtp_class = MagicMock(return_value=mock_smtp_instance)
        mock_smtp_instance.__enter__ = MagicMock(return_value=mock_smtp_instance)
        mock_smtp_instance.__exit__ = MagicMock(return_value=False)

        with patch("jam_session_processor.email.smtplib.SMTP", mock_smtp_class):
            send_invite_email("alice@example.com", "test-token-abc", "Alice")

        # Verify SMTP was called correctly
        mock_smtp_class.assert_called_once_with("smtp.example.com", 587)
        mock_smtp_instance.starttls.assert_called_once()
        mock_smtp_instance.login.assert_called_once_with("user@example.com", "secret")
        mock_smtp_instance.send_message.assert_called_once()

        # Check the message content
        msg = mock_smtp_instance.send_message.call_args[0][0]
        assert msg["To"] == "alice@example.com"
        assert msg["From"] == "noreply@example.com"
        assert "invite" in msg["Subject"].lower()
        body = msg.get_payload()
        assert "https://jam.example.com/invite/test-token-abc" in body

    def test_send_invite_email_no_smtp_configured(self, monkeypatch):
        """When SMTP is not configured, log a warning but don't crash."""
        monkeypatch.setenv("JAM_SMTP_HOST", "")
        monkeypatch.setenv("JAM_APP_URL", "https://jam.example.com")
        reset_config()

        # Should not raise, just log
        result = send_invite_email("alice@example.com", "test-token", "Alice")
        assert result is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_invite.py::TestInviteEmail -v`
Expected: FAIL — module `email` does not exist

- [ ] **Step 3: Create the email module**

```python
# src/jam_session_processor/email.py
"""Email utilities for sending invite links."""

import logging
import smtplib
from email.mime.text import MIMEText

from jam_session_processor.config import get_config

logger = logging.getLogger(__name__)


def send_invite_email(to_email: str, token: str, name: str = "") -> bool:
    """Send an invite email with a link to set password.

    Returns True if sent, False if SMTP is not configured.
    """
    cfg = get_config()
    if not cfg.smtp_host:
        logger.warning("SMTP not configured — invite email not sent to %s", to_email)
        return False

    invite_url = f"{cfg.app_url.rstrip('/')}/invite/{token}"
    greeting = f"Hi {name},\n\n" if name else "Hi,\n\n"

    body = (
        f"{greeting}"
        f"You've been invited to JamJar! Click the link below to set your password "
        f"and get started:\n\n"
        f"{invite_url}\n\n"
        f"This link expires in 7 days.\n\n"
        f"— JamJar"
    )

    msg = MIMEText(body)
    msg["Subject"] = "You're invited to JamJar"
    msg["From"] = cfg.smtp_from or cfg.smtp_user
    msg["To"] = to_email

    try:
        with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port) as server:
            server.starttls()
            if cfg.smtp_user and cfg.smtp_password:
                server.login(cfg.smtp_user, cfg.smtp_password)
            server.send_message(msg)
        logger.info("Invite email sent to %s", to_email)
        return True
    except Exception:
        logger.exception("Failed to send invite email to %s", to_email)
        return False
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_invite.py -v`
Expected: All tests PASS

- [ ] **Step 5: Lint**

Run: `ruff check src/jam_session_processor/email.py tests/test_invite.py`

- [ ] **Step 6: Commit**

```bash
git add src/jam_session_processor/email.py tests/test_invite.py
git commit -m "feat: add email module for sending invite links"
```

---

## Chunk 3: API Endpoints

### Task 4: Add public invite validation and acceptance endpoints

**Files:**
- Modify: `src/jam_session_processor/api.py`
- Test: `tests/test_invite.py` (append)

- [ ] **Step 1: Write failing tests for invite API endpoints**

Append to `tests/test_invite.py`:

```python
from fastapi.testclient import TestClient

from jam_session_processor import api
from jam_session_processor.storage import reset_storage


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("JAM_JWT_SECRET", "test-secret")
    monkeypatch.setenv("JAM_API_KEY", "test-api-key")
    monkeypatch.delenv("JAM_R2_BUCKET", raising=False)
    monkeypatch.delenv("JAM_R2_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("JAM_R2_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("JAM_R2_SECRET_ACCESS_KEY", raising=False)
    reset_config()
    reset_storage()
    d = Database(tmp_path / "test.db")
    api._db = d
    yield TestClient(api.app)
    d.close()
    api._db = None
    reset_storage()
    reset_config()


class TestInviteAPI:
    def test_validate_invite_valid_token(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)

        resp = client.post("/api/invite/validate", json={"token": token})
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "alice@example.com"
        assert data["name"] == "Alice"

    def test_validate_invite_invalid_token(self, client):
        resp = client.post("/api/invite/validate", json={"token": "bad-token"})
        assert resp.status_code == 404

    def test_validate_invite_expired_token(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)
        # Manually expire the token
        db.conn.execute(
            "UPDATE invite_tokens SET expires_at = datetime('now', '-1 hour') WHERE token = ?",
            (token,),
        )
        db.conn.commit()

        resp = client.post("/api/invite/validate", json={"token": token})
        assert resp.status_code == 410  # Gone

    def test_validate_invite_already_used(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)
        db.consume_invite_token(token)

        resp = client.post("/api/invite/validate", json={"token": token})
        assert resp.status_code == 410

    def test_accept_invite_sets_password(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)

        resp = client.post(
            "/api/invite/accept",
            json={"token": token, "password": "mynewpassword"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "alice@example.com"
        # Token should be consumed
        row = db.get_invite_token(token)
        assert row["used_at"] is not None
        # User should now have a password
        user = db.get_user(uid)
        assert user.password_hash != ""
        # Response should set auth cookie
        assert "jam_session" in resp.cookies

    def test_accept_invite_invalid_token(self, client):
        resp = client.post(
            "/api/invite/accept",
            json={"token": "bad-token", "password": "test"},
        )
        assert resp.status_code == 404

    def test_accept_invite_expired_token(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)
        db.conn.execute(
            "UPDATE invite_tokens SET expires_at = datetime('now', '-1 hour') WHERE token = ?",
            (token,),
        )
        db.conn.commit()

        resp = client.post(
            "/api/invite/accept",
            json={"token": token, "password": "test"},
        )
        assert resp.status_code == 410

    def test_accept_invite_empty_password(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)

        resp = client.post(
            "/api/invite/accept",
            json={"token": token, "password": ""},
        )
        assert resp.status_code == 400

    def test_accept_invite_short_password(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)

        resp = client.post(
            "/api/invite/accept",
            json={"token": token, "password": "ab"},
        )
        assert resp.status_code == 400

    def test_login_blocked_without_password(self, client):
        """Users with no password_hash cannot log in."""
        db = api._db
        db.create_user("alice@example.com", "", name="Alice")

        resp = client.post(
            "/api/auth/login",
            json={"email": "alice@example.com", "password": "anything"},
        )
        assert resp.status_code == 401
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_invite.py::TestInviteAPI -v`
Expected: FAIL — endpoints don't exist yet

- [ ] **Step 3: Add invite endpoints to api.py**

Add these Pydantic models near the other request models:

```python
class InviteValidateRequest(BaseModel):
    token: str

class InviteAcceptRequest(BaseModel):
    token: str
    password: str
```

Add the public paths to `_PUBLIC_PATHS`:
```python
_PUBLIC_INVITE_PREFIXES = ("/api/invite/",)
```

In `auth_middleware`, add after the share endpoint check:
```python
# Public invite endpoints
if any(path.startswith(p) for p in _PUBLIC_INVITE_PREFIXES):
    return await call_next(request)
```

Add the endpoint implementations:

```python
def _validate_invite_token(db: Database, token: str) -> tuple[dict, "User"]:
    """Validate an invite token. Returns (token_row, user) or raises HTTPException."""
    row = db.get_invite_token(token)
    if not row:
        raise HTTPException(status_code=404, detail="Invalid invite link")
    if row["used_at"] is not None:
        raise HTTPException(status_code=410, detail="This invite has already been used")
    # Check expiry (stored as UTC)
    from datetime import datetime, timezone
    expires_at = datetime.strptime(row["expires_at"], "%Y-%m-%d %H:%M:%S").replace(
        tzinfo=timezone.utc
    )
    if datetime.now(timezone.utc) > expires_at:
        raise HTTPException(status_code=410, detail="This invite has expired")
    user = db.get_user(row["user_id"])
    if not user:
        raise HTTPException(status_code=404, detail="User no longer exists")
    return row, user


@app.post("/api/invite/validate")
def invite_validate(req: InviteValidateRequest):
    db = get_db()
    _row, user = _validate_invite_token(db, req.token)
    return {"email": user.email, "name": user.name}


@app.post("/api/invite/accept")
def invite_accept(req: InviteAcceptRequest):
    if not req.password:
        raise HTTPException(status_code=400, detail="Password cannot be empty")
    db = get_db()
    _row, user = _validate_invite_token(db, req.token)
    # Set the password
    pw_hash = hash_password(req.password)
    db.update_user_password(user.id, pw_hash)
    # Consume the token
    db.consume_invite_token(req.token)
    # Log them in
    token = create_jwt(user.id, user.email)
    groups = db.get_user_groups(user.id)
    response = JSONResponse({
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "groups": [{"id": g.id, "name": g.name} for g in groups],
    })
    response.set_cookie(
        key="jam_session",
        value=token,
        httponly=True,
        samesite="lax",
        max_age=7 * 24 * 3600,
        path="/",
    )
    return response
```

**Important:** Also fix the login endpoint to explicitly reject users without a password. Without this, `bcrypt.checkpw("anything", "")` raises a `ValueError` which becomes a 500 error instead of a 401. In the `login` endpoint, change the existing password check line to:

```python
if not user or not user.password_hash or not verify_password(req.password, user.password_hash):
```

And add a minimum password length check to `invite_accept`:

```python
if not req.password or len(req.password) < 4:
    raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_invite.py::TestInviteAPI -v`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite for regressions**

Run: `pytest`
Expected: All existing tests pass

- [ ] **Step 6: Lint**

Run: `ruff check src/jam_session_processor/api.py tests/test_invite.py`

- [ ] **Step 7: Commit**

```bash
git add src/jam_session_processor/api.py tests/test_invite.py
git commit -m "feat: add public invite validate/accept API endpoints"
```

---

### Task 5: Modify admin user creation to support invite flow

**Files:**
- Modify: `src/jam_session_processor/api.py`
- Test: `tests/test_invite.py` (append)

- [ ] **Step 1: Write failing tests for modified admin user creation**

Append to `tests/test_invite.py`:

```python
class TestAdminInviteFlow:
    def _superadmin_client(self, client):
        """Create a superadmin user, log in, return client."""
        db = api._db
        uid = db.create_user(
            "admin@example.com", hash_password("adminpass"), name="Admin", role="superadmin"
        )
        gid = db.create_group("TestBand")
        db.assign_user_to_group(uid, gid)
        resp = client.post(
            "/api/auth/login",
            json={"email": "admin@example.com", "password": "adminpass"},
        )
        assert resp.status_code == 200
        return client

    def test_create_user_without_password_sends_invite(self, client, monkeypatch):
        """POST /api/admin/users without password creates user + invite token."""
        c = self._superadmin_client(client)
        monkeypatch.setenv("JAM_APP_URL", "https://jam.example.com")
        reset_config()

        with patch("jam_session_processor.api.send_invite_email") as mock_email:
            mock_email.return_value = True
            resp = c.post(
                "/api/admin/users",
                json={"email": "newuser@example.com", "name": "New User", "role": "editor"},
            )
            assert resp.status_code == 201
            data = resp.json()
            assert data["email"] == "newuser@example.com"

            # Should have called send_invite_email
            mock_email.assert_called_once()
            call_args = mock_email.call_args
            assert call_args[0][0] == "newuser@example.com"  # to_email
            assert len(call_args[0][1]) > 20  # token
            assert call_args[0][2] == "New User"  # name

    def test_create_user_with_password_still_works(self, client):
        """Backwards compat: providing a password still creates a ready-to-login user."""
        c = self._superadmin_client(client)

        resp = c.post(
            "/api/admin/users",
            json={
                "email": "legacy@example.com",
                "password": "mypassword",
                "name": "Legacy",
                "role": "editor",
            },
        )
        assert resp.status_code == 201

        # User can log in immediately
        resp = client.post(
            "/api/auth/login",
            json={"email": "legacy@example.com", "password": "mypassword"},
        )
        assert resp.status_code == 200

    def test_resend_invite(self, client, monkeypatch):
        """POST /api/admin/users/{id}/resend-invite regenerates token and sends email."""
        c = self._superadmin_client(client)
        monkeypatch.setenv("JAM_APP_URL", "https://jam.example.com")
        reset_config()

        db = api._db
        uid = db.create_user("invited@example.com", "", name="Invited")

        with patch("jam_session_processor.api.send_invite_email") as mock_email:
            mock_email.return_value = True
            resp = c.post(f"/api/admin/users/{uid}/resend-invite")
            assert resp.status_code == 200
            mock_email.assert_called_once()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_invite.py::TestAdminInviteFlow -v`
Expected: FAIL

- [ ] **Step 3: Modify CreateUserRequest and admin_create_user**

Make password optional in the request model:

```python
class CreateUserRequest(BaseModel):
    email: str
    password: str = ""
    name: str = ""
    role: str = "editor"
```

Update `admin_create_user`:

```python
@app.post("/api/admin/users", response_model=AdminUserResponse, status_code=201)
def admin_create_user(req: CreateUserRequest, request: Request):
    _require_role(request, "superadmin")
    db = get_db()
    if db.get_user_by_email(req.email):
        raise HTTPException(status_code=400, detail="Username already exists")
    from jam_session_processor.db import VALID_ROLES

    if req.role not in VALID_ROLES:
        valid = ", ".join(sorted(VALID_ROLES))
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {valid}")

    if req.password:
        pw_hash = hash_password(req.password)
    else:
        pw_hash = ""

    user_id = db.create_user(req.email, pw_hash, req.name, role=req.role)
    user = db.get_user(user_id)

    # If no password provided, create invite token and send email
    if not req.password:
        token = db.create_invite_token(user_id)
        from jam_session_processor.email import send_invite_email
        send_invite_email(req.email, token, req.name)

    return _admin_user_response(db, user)
```

Add the resend-invite endpoint:

```python
@app.post("/api/admin/users/{user_id}/resend-invite")
def admin_resend_invite(user_id: int, request: Request):
    _require_role(request, "superadmin")
    db = get_db()
    user = db.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    # Delete existing tokens and create a new one
    db.delete_invite_tokens_for_user(user_id)
    token = db.create_invite_token(user_id)
    from jam_session_processor.email import send_invite_email
    sent = send_invite_email(user.email, token, user.name)
    return {"ok": True, "email_sent": sent}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_invite.py -v`
Expected: All tests PASS

- [ ] **Step 5: Run full test suite**

Run: `pytest`
Expected: All tests pass

- [ ] **Step 6: Lint**

Run: `ruff check src/jam_session_processor/api.py tests/test_invite.py`

- [ ] **Step 7: Commit**

```bash
git add src/jam_session_processor/api.py tests/test_invite.py
git commit -m "feat: admin user creation supports invite flow with optional password"
```

---

## Chunk 4: CLI Changes

### Task 6: Modify CLI add-user to use invite flow

**Files:**
- Modify: `src/jam_session_processor/cli.py`

- [ ] **Step 1: Update add-user command**

Replace the existing `add_user` command:

```python
@cli.command("add-user")
@click.argument("email")
@click.option("--name", default="", help="Display name for the user.")
@click.option(
    "--role",
    type=click.Choice(["superadmin", "admin", "editor", "readonly"]),
    default="editor",
    help="User role (default: editor).",
)
@click.option("--password", is_flag=True, help="Set password directly instead of sending invite.")
def add_user(email: str, name: str, role: str, password: bool):
    """Create a new user. Sends an invite email by default, or prompts for password with --password."""
    from jam_session_processor.auth import hash_password

    db = _get_db()
    existing = db.get_user_by_email(email)
    if existing:
        click.echo(f"Error: User '{email}' already exists")
        db.close()
        raise SystemExit(1)

    if password:
        pw = click.prompt("Password", hide_input=True, confirmation_prompt=True)
        if not pw:
            click.echo("Error: Password cannot be empty")
            db.close()
            raise SystemExit(1)
        pw_hash = hash_password(pw)
    else:
        pw_hash = ""

    user_id = db.create_user(email, pw_hash, name=name, role=role)

    if not password:
        token = db.create_invite_token(user_id)
        from jam_session_processor.email import send_invite_email

        sent = send_invite_email(email, token, name)
        if sent:
            click.echo(f"Created user '{email}' (id={user_id}, role={role}) — invite email sent")
        else:
            from jam_session_processor.config import get_config
            cfg = get_config()
            invite_url = f"{cfg.app_url.rstrip('/')}/invite/{token}"
            click.echo(f"Created user '{email}' (id={user_id}, role={role})")
            click.echo(f"SMTP not configured — share this invite link manually:")
            click.echo(f"  {invite_url}")
    else:
        click.echo(f"Created user '{email}' (id={user_id}, role={role})")

    db.close()
```

- [ ] **Step 2: Run full test suite**

Run: `pytest`
Expected: All tests pass

- [ ] **Step 3: Lint**

Run: `ruff check src/jam_session_processor/cli.py`

- [ ] **Step 4: Commit**

```bash
git add src/jam_session_processor/cli.py
git commit -m "feat: add-user CLI sends invite by default, --password for direct set"
```

---

## Chunk 5: Frontend

### Task 7: Add invite API methods to frontend

**Files:**
- Modify: `web/src/api.ts`

- [ ] **Step 1: Add invite API methods**

Add to the `api` object in `api.ts`:

```typescript
validateInvite: (token: string) =>
  fetchJson<{ email: string; name: string }>(`${BASE}/invite/validate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  }),

acceptInvite: (token: string, password: string) =>
  fetchJson<AuthUser>(`${BASE}/invite/accept`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  }),
```

Also update the `adminCreateUser` signature to make password optional:

```typescript
adminCreateUser: (email: string, name: string, role = "editor") =>
  fetchJson<AdminUser>(`${BASE}/admin/users`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, name, role }),
  }),
```

And add `adminResendInvite` to the admin methods:

```typescript
adminResendInvite: (userId: number) =>
  fetchJson<{ ok: boolean; email_sent: boolean }>(
    `${BASE}/admin/users/${userId}/resend-invite`,
    { method: "POST" }
  ),
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add web/src/api.ts
git commit -m "feat: add invite API methods to frontend client"
```

### Task 8: Create AcceptInvite page

**Files:**
- Create: `web/src/pages/AcceptInvite.tsx`
- Modify: `web/src/App.tsx`

- [ ] **Step 1: Create the AcceptInvite page**

```tsx
// web/src/pages/AcceptInvite.tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { api } from "../api";

export default function AcceptInvite() {
  const { token } = useParams<{ token: string }>();
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "expired">("loading");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setStatus("error");
      return;
    }
    api
      .validateInvite(token)
      .then((data) => {
        setEmail(data.email);
        setName(data.name);
        setStatus("ready");
      })
      .catch((err) => {
        if (err.status === 410) {
          setStatus("expired");
        } else {
          setStatus("error");
        }
      });
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (password.length < 4) {
      setError("Password must be at least 4 characters");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    setSubmitting(true);
    try {
      await api.acceptInvite(token!, password);
      window.location.href = "/";
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-2">
          <img src="/logo.png" alt="JamJar" className="h-20 w-20" />
          <h1 className="text-3xl font-bold text-white">JamJar</h1>
        </div>

        {status === "loading" && (
          <p className="text-center text-gray-400">Validating invite...</p>
        )}

        {status === "expired" && (
          <div className="rounded border border-yellow-800 bg-yellow-900/30 px-4 py-3 text-sm text-yellow-300">
            This invite link has expired or has already been used. Ask your admin to send a new one.
          </div>
        )}

        {status === "error" && (
          <div className="rounded border border-red-800 bg-red-900/30 px-4 py-3 text-sm text-red-300">
            Invalid invite link. Please check the URL or ask your admin for a new invite.
          </div>
        )}

        {status === "ready" && (
          <>
            <p className="mb-6 text-center text-sm text-gray-400">
              Welcome{name ? `, ${name}` : ""}! Set your password to get started.
            </p>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded border border-red-800 bg-red-900/30 px-3 py-2 text-sm text-red-300">
                  {error}
                </div>
              )}
              <div>
                <label className="mb-1 block text-sm text-gray-400">Username</label>
                <input
                  type="text"
                  value={email}
                  disabled
                  className="w-full rounded border border-gray-700 bg-gray-800/50 px-3 py-2 text-gray-400"
                />
              </div>
              <div>
                <label htmlFor="password" className="mb-1 block text-sm text-gray-400">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoFocus
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="confirm" className="mb-1 block text-sm text-gray-400">
                  Confirm password
                </label>
                <input
                  id="confirm"
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  required
                  className="w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-white placeholder-gray-500 focus:border-accent-500 focus:outline-none"
                />
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded bg-accent-600 px-4 py-2 font-medium text-white transition hover:bg-accent-500 disabled:opacity-50"
              >
                {submitting ? "Setting up..." : "Set password & sign in"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add route to App.tsx**

In `App.tsx`, add the import:
```tsx
import AcceptInvite from "./pages/AcceptInvite";
```

Add the route next to the `/login` route (before the `*` catch-all):
```tsx
<Route path="/invite/:token" element={<AcceptInvite />} />
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/AcceptInvite.tsx web/src/App.tsx
git commit -m "feat: add AcceptInvite page and route"
```

### Task 9: Update Admin page for invite flow

**Files:**
- Modify: `web/src/pages/Admin.tsx`

- [ ] **Step 1: Remove password field from Add User modal, add Resend Invite**

In the `Admin.tsx` component:

1. Remove `newPassword` state and its input from the Add User modal
2. Change `handleAddUser` to call: `api.adminCreateUser(newEmail, newName, newRole)`
3. Remove the `if (!newEmail || !newPassword) return` guard — change to `if (!newEmail) return`
4. Add a "Resend invite" button to each user row's Actions column (next to "Reset pw"):

```tsx
<button
  onClick={async () => {
    try {
      const result = await api.adminResendInvite(user.id);
      setToast({
        message: result.email_sent ? "Invite sent" : "Invite created (SMTP not configured)",
        variant: "success",
      });
    } catch (err: any) {
      setToast({ message: err.message, variant: "error" });
    }
  }}
  className="rounded px-2 py-1 text-xs text-gray-400 transition hover:bg-gray-800 hover:text-gray-200"
>
  Invite
</button>
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/Admin.tsx
git commit -m "feat: admin page uses invite flow, removes password field"
```

---

## Chunk 6: Backend Route for Invite Pages & Docker Config

### Task 10: Ensure /invite/:token is served by SPA catch-all

**Files:**
- Modify: `src/jam_session_processor/api.py` (if needed)

- [ ] **Step 1: Verify the SPA catch-all handles /invite paths**

The existing SPA catch-all in `api.py` should already serve `index.html` for unknown paths. Check that `/invite/` paths are not caught by auth middleware.

The `/invite/:token` route is a frontend route, not an API route. When served from the SPA, the browser loads `index.html` and React Router handles it. The auth middleware only intercepts `/api/` paths for auth (non-API paths pass through to static file serving or the SPA catch-all).

Verify by reading the auth middleware — it should already skip non-API paths. If the middleware checks all paths, add `/invite/` to the public path check.

- [ ] **Step 2: Run full test suite**

Run: `pytest`
Expected: All tests pass

- [ ] **Step 3: Commit (if changes needed)**

### Task 11: Add SMTP env vars to docker-compose.yml

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add SMTP and APP_URL env vars**

Add to the `environment` section:

```yaml
- JAM_SMTP_HOST=${JAM_SMTP_HOST:-}
- JAM_SMTP_PORT=${JAM_SMTP_PORT:-587}
- JAM_SMTP_USER=${JAM_SMTP_USER:-}
- JAM_SMTP_PASSWORD=${JAM_SMTP_PASSWORD:-}
- JAM_SMTP_FROM=${JAM_SMTP_FROM:-}
- JAM_APP_URL=${JAM_APP_URL:-}
```

- [ ] **Step 2: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add SMTP and APP_URL env vars to docker-compose"
```

---

## Chunk 7: Documentation

### Task 12: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update documentation**

Add to the database schema section:
```
invite_tokens
──────────────
id (PK)
token (UNIQUE)
user_id (FK→users)
expires_at
used_at (nullable)
created_at
```

Add to schema relationships:
```
- `invite_tokens → users`: many-to-one, CASCADE delete
```

Add to REST API section:
```
**Invite (public):** `POST /api/invite/validate` | `POST /api/invite/accept`
**Admin (additions):** `POST /api/admin/users/{id}/resend-invite` (superadmin)
```

Add to environment variables table:
```
| `JAM_SMTP_HOST` | *(empty)* | SMTP server hostname (enables invite emails) |
| `JAM_SMTP_PORT` | `587` | SMTP server port |
| `JAM_SMTP_USER` | *(empty)* | SMTP username |
| `JAM_SMTP_PASSWORD` | *(empty)* | SMTP password |
| `JAM_SMTP_FROM` | *(empty)* | From address for emails (falls back to SMTP_USER) |
| `JAM_APP_URL` | `http://localhost:5173` | Public URL of the app (used in invite links) |
```

Update CLI commands section — `add-user` description:
```
jam-session add-user EMAIL                 # create user + send invite (or --password to set directly)
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document invite flow schema, endpoints, and env vars"
```

- [ ] **Step 3: Run full test suite one final time**

Run: `pytest`
Expected: All tests pass

Run: `ruff check src/ tests/`
Expected: No lint errors
