# Shareable Track Links Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to generate permanent public share links for individual tracks, with a branded landing page for unauthenticated recipients.

**Architecture:** New `share_links` DB table with token-based lookup. Two public endpoints bypass auth middleware: one serves a server-rendered HTML landing page, the other streams audio. Authenticated endpoints handle link creation/revocation. A download button is added to the AudioPlayer component app-wide.

**Tech Stack:** Python/FastAPI (backend), React/TypeScript/Tailwind (frontend), SQLite (database)

---

## Chunk 1: Backend — Database & Share Link CRUD

### Task 1: Add `share_links` table and DB methods

**Files:**
- Modify: `src/jam_session_processor/db.py`
- Test: `tests/test_db_share.py` (new)

- [ ] **Step 1: Write failing tests for share link DB methods**

Create `tests/test_db_share.py`:

```python
import pytest
from jam_session_processor.db import Database
from jam_session_processor.auth import hash_password


@pytest.fixture
def db(tmp_path):
    return Database(tmp_path / "test.db")


@pytest.fixture
def seeded_db(db):
    """DB with a user, group, session, and track."""
    uid = db.create_user("test@example.com", hash_password("pw"), name="Test")
    gid = db.create_group("TestBand")
    db.assign_user_to_group(uid, gid)
    sid = db.create_session("recording.m4a", gid, date="2026-01-01")
    tid = db.create_track(sid, track_number=1, start_sec=0, end_sec=300, audio_path="tracks/t1.m4a")
    return db, uid, gid, sid, tid


def test_create_share_link(seeded_db):
    db, uid, gid, sid, tid = seeded_db
    link = db.create_share_link(tid, uid)
    assert link["track_id"] == tid
    assert link["created_by"] == uid
    assert len(link["token"]) >= 16


def test_create_share_link_returns_existing(seeded_db):
    db, uid, gid, sid, tid = seeded_db
    link1 = db.create_share_link(tid, uid)
    link2 = db.create_share_link(tid, uid)
    assert link1["token"] == link2["token"]


def test_get_share_link_by_token(seeded_db):
    db, uid, gid, sid, tid = seeded_db
    link = db.create_share_link(tid, uid)
    fetched = db.get_share_link_by_token(link["token"])
    assert fetched is not None
    assert fetched["track_id"] == tid


def test_get_share_link_by_token_invalid(seeded_db):
    db, uid, gid, sid, tid = seeded_db
    assert db.get_share_link_by_token("nonexistent") is None


def test_get_share_link_by_track(seeded_db):
    db, uid, gid, sid, tid = seeded_db
    db.create_share_link(tid, uid)
    link = db.get_share_link_by_track(tid)
    assert link is not None
    assert link["track_id"] == tid


def test_get_share_link_by_track_none(seeded_db):
    db, uid, gid, sid, tid = seeded_db
    assert db.get_share_link_by_track(tid) is None


def test_delete_share_link(seeded_db):
    db, uid, gid, sid, tid = seeded_db
    db.create_share_link(tid, uid)
    db.delete_share_link(tid)
    assert db.get_share_link_by_track(tid) is None


def test_share_link_cascades_on_track_delete(seeded_db):
    db, uid, gid, sid, tid = seeded_db
    link = db.create_share_link(tid, uid)
    db.delete_track(tid)
    assert db.get_share_link_by_token(link["token"]) is None


def test_share_link_user_delete_sets_null(seeded_db):
    db, uid, gid, sid, tid = seeded_db
    link = db.create_share_link(tid, uid)
    db.delete_user(uid)
    fetched = db.get_share_link_by_token(link["token"])
    assert fetched is not None
    assert fetched["created_by"] is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_db_share.py -v`
Expected: FAIL — `Database` has no `create_share_link` method

- [ ] **Step 3: Add schema and DB methods**

In `db.py`, add to `SCHEMA` (after `activity_log` index lines):

```python
CREATE TABLE IF NOT EXISTS share_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    track_id INTEGER NOT NULL UNIQUE REFERENCES tracks(id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Add to `Database.reset()` method, add `DROP TABLE IF EXISTS share_links;` before the `DROP TABLE IF EXISTS tracks;` line.

Add these methods to the `Database` class (after the track methods section):

```python
# --- Share links ---

def create_share_link(self, track_id: int, created_by: int | None) -> dict:
    """Create a share link for a track. Returns existing link if one exists."""
    existing = self.get_share_link_by_track(track_id)
    if existing:
        return existing
    import secrets
    token = secrets.token_urlsafe(16)
    try:
        self.conn.execute(
            "INSERT INTO share_links (token, track_id, created_by) VALUES (?, ?, ?)",
            (token, track_id, created_by),
        )
        self.conn.commit()
    except sqlite3.IntegrityError:
        # Token collision (astronomically unlikely) — retry once
        token = secrets.token_urlsafe(16)
        self.conn.execute(
            "INSERT INTO share_links (token, track_id, created_by) VALUES (?, ?, ?)",
            (token, track_id, created_by),
        )
        self.conn.commit()
    return self.get_share_link_by_track(track_id)

def get_share_link_by_token(self, token: str) -> dict | None:
    row = self.conn.execute(
        "SELECT * FROM share_links WHERE token = ?", (token,)
    ).fetchone()
    return dict(row) if row else None

def get_share_link_by_track(self, track_id: int) -> dict | None:
    row = self.conn.execute(
        "SELECT * FROM share_links WHERE track_id = ?", (track_id,)
    ).fetchone()
    return dict(row) if row else None

def delete_share_link(self, track_id: int):
    self.conn.execute("DELETE FROM share_links WHERE track_id = ?", (track_id,))
    self.conn.commit()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_db_share.py -v`
Expected: All PASS

- [ ] **Step 5: Run full test suite for regressions**

Run: `pytest`
Expected: All existing tests still pass

- [ ] **Step 6: Lint**

Run: `ruff check src/jam_session_processor/db.py tests/test_db_share.py`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/jam_session_processor/db.py tests/test_db_share.py
git commit -m "feat: add share_links table and DB methods"
```

---

### Task 2: Add download support to existing track audio endpoint

**Files:**
- Modify: `src/jam_session_processor/api.py:1199-1217`
- Test: `tests/test_api.py` (add tests)

- [ ] **Step 1: Write failing test for download param**

Add to `tests/test_api.py`:

```python
def test_track_audio_download_content_disposition(seeded_client, tmp_path):
    """GET /api/tracks/{id}/audio?download=1 sets Content-Disposition: attachment."""
    client, uid, gid = seeded_client
    db = api._db
    tracks = db.get_tracks_for_session(1)
    track = tracks[0]

    # Create a real audio file at the path
    audio_path = Path(track.audio_path)
    audio_path.parent.mkdir(parents=True, exist_ok=True)
    audio_path.write_bytes(b"RIFF" + b"\x00" * 100)

    resp = client.get(f"/api/tracks/{track.id}/audio?download=1")
    assert resp.status_code == 200
    assert "attachment" in resp.headers.get("content-disposition", "")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_api.py::test_track_audio_download_content_disposition -v`
Expected: FAIL — no content-disposition header

- [ ] **Step 3: Add download param to track audio endpoint**

Modify the `stream_track_audio` function in `api.py`:

```python
@app.get("/api/tracks/{track_id}/audio")
def stream_track_audio(track_id: int, request: Request, download: int = 0):
    from jam_session_processor.storage import get_storage

    db = get_db()
    track, session = _get_track_with_access(db, track_id, request)

    # Build a download filename from song name or track number
    if download:
        name_parts = []
        if track.song_name:
            name_parts.append(track.song_name)
        else:
            name_parts.append(f"Track {track.track_number}")
        if session.name:
            name_parts.append(session.name)
        ext = Path(track.audio_path).suffix or ".m4a"
        filename = " - ".join(name_parts) + ext

    storage = get_storage()
    redirect_url = storage.url(track.audio_path)
    if redirect_url:
        return RedirectResponse(redirect_url, status_code=307)

    cfg = get_config()
    audio_path = cfg.resolve_path(track.audio_path)
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")
    media_types = {".ogg": "audio/ogg", ".m4a": "audio/mp4", ".wav": "audio/wav"}
    media_type = media_types.get(audio_path.suffix.lower(), "application/octet-stream")

    if download:
        return FileResponse(
            audio_path,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    return FileResponse(audio_path, media_type=media_type)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_api.py::test_track_audio_download_content_disposition -v`
Expected: PASS

- [ ] **Step 5: Run full test suite**

Run: `pytest`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/jam_session_processor/api.py tests/test_api.py
git commit -m "feat: add ?download=1 support to track audio endpoint"
```

---

## Chunk 2: Backend — Share API Endpoints & Landing Page

### Task 3: Add authenticated share link endpoints

**Files:**
- Modify: `src/jam_session_processor/api.py`
- Test: `tests/test_api_share.py` (new)

- [ ] **Step 1: Write failing tests for share endpoints**

Create `tests/test_api_share.py`:

```python
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from jam_session_processor import api
from jam_session_processor.auth import hash_password
from jam_session_processor.config import reset_config
from jam_session_processor.db import Database
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
    db = Database(tmp_path / "test.db")
    api._db = db
    yield TestClient(api.app)
    db.close()
    api._db = None
    reset_storage()
    reset_config()


@pytest.fixture
def auth_client(client, tmp_path):
    db = api._db
    uid = db.create_user("test@example.com", hash_password("password"), name="Test", role="admin")
    gid = db.create_group("TestBand")
    db.assign_user_to_group(uid, gid)
    sid = db.create_session("session.m4a", gid, date="2026-01-01")
    audio = tmp_path / "track1.m4a"
    audio.write_bytes(b"\x00" * 100)
    db.create_track(sid, track_number=1, start_sec=0, end_sec=300, audio_path=str(audio))
    resp = client.post("/api/auth/login", json={"email": "test@example.com", "password": "password"})
    assert resp.status_code == 200
    return client, uid, gid


def test_create_share_link(auth_client):
    client, uid, gid = auth_client
    db = api._db
    tracks = db.get_tracks_for_session(1)
    resp = client.post(f"/api/tracks/{tracks[0].id}/share")
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["url"].startswith("/share/")


def test_create_share_link_idempotent(auth_client):
    client, uid, gid = auth_client
    db = api._db
    tracks = db.get_tracks_for_session(1)
    resp1 = client.post(f"/api/tracks/{tracks[0].id}/share")
    resp2 = client.post(f"/api/tracks/{tracks[0].id}/share")
    assert resp1.json()["token"] == resp2.json()["token"]


def test_create_share_link_requires_auth(client):
    resp = client.post("/api/tracks/1/share")
    assert resp.status_code == 401


def test_delete_share_link(auth_client):
    client, uid, gid = auth_client
    db = api._db
    tracks = db.get_tracks_for_session(1)
    client.post(f"/api/tracks/{tracks[0].id}/share")
    resp = client.delete(f"/api/tracks/{tracks[0].id}/share")
    assert resp.status_code == 200


def test_delete_share_link_404_when_none(auth_client):
    client, uid, gid = auth_client
    db = api._db
    tracks = db.get_tracks_for_session(1)
    resp = client.delete(f"/api/tracks/{tracks[0].id}/share")
    assert resp.status_code == 404


def test_delete_share_link_requires_auth(client):
    resp = client.delete("/api/tracks/1/share")
    assert resp.status_code == 401


def test_readonly_can_create_share_link(client, tmp_path):
    """All roles including readonly can create share links."""
    db = api._db
    uid = db.create_user("ro@example.com", hash_password("password"), name="RO", role="readonly")
    gid = db.create_group("ROBand")
    db.assign_user_to_group(uid, gid)
    sid = db.create_session("session.m4a", gid)
    audio = tmp_path / "track_ro.m4a"
    audio.write_bytes(b"\x00" * 100)
    db.create_track(sid, track_number=1, start_sec=0, end_sec=300, audio_path=str(audio))
    client.post("/api/auth/login", json={"email": "ro@example.com", "password": "password"})
    tracks = db.get_tracks_for_session(sid)
    resp = client.post(f"/api/tracks/{tracks[0].id}/share")
    assert resp.status_code == 200
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_api_share.py -v`
Expected: FAIL — endpoints don't exist (404 or 405)

- [ ] **Step 3: Add share endpoints to api.py**

Add to `api.py` after the track audio endpoint (around line 1218):

```python
# --- Share link endpoints ---


@app.post("/api/tracks/{track_id}/share")
def create_share_link(track_id: int, request: Request):
    db = get_db()
    track, session = _get_track_with_access(db, track_id, request)
    user = request.state.user
    link = db.create_share_link(track_id, user.id if user else None)
    return {"token": link["token"], "url": f"/share/{link['token']}"}


@app.delete("/api/tracks/{track_id}/share")
def revoke_share_link(track_id: int, request: Request):
    db = get_db()
    track, session = _get_track_with_access(db, track_id, request)
    link = db.get_share_link_by_track(track_id)
    if not link:
        raise HTTPException(status_code=404, detail="No share link exists for this track")
    # Allow the link creator or any admin/superadmin
    user = request.state.user
    if user and link["created_by"] != user.id:
        if user.role not in ("admin", "superadmin"):
            raise HTTPException(status_code=403, detail="Only the link creator or an admin can revoke")
    db.delete_share_link(track_id)
    return {"ok": True}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pytest tests/test_api_share.py -v`
Expected: All PASS

- [ ] **Step 5: Run full test suite**

Run: `pytest`
Expected: All pass

- [ ] **Step 6: Commit**

```bash
git add src/jam_session_processor/api.py tests/test_api_share.py
git commit -m "feat: add POST/DELETE /api/tracks/{id}/share endpoints"
```

---

### Task 4: Add public share audio endpoint and landing page

**Files:**
- Modify: `src/jam_session_processor/api.py`
- Test: `tests/test_api_share.py` (add tests)

- [ ] **Step 1: Write failing tests for public endpoints**

Add to `tests/test_api_share.py`:

```python
def test_public_share_audio(auth_client, tmp_path):
    """Public audio endpoint streams audio without auth."""
    client, uid, gid = auth_client
    db = api._db
    tracks = db.get_tracks_for_session(1)
    link = db.create_share_link(tracks[0].id, uid)
    # Need to clear auth cookie to test public access
    client.cookies.clear()
    resp = client.get(f"/api/share/{link['token']}/audio")
    assert resp.status_code == 200


def test_public_share_audio_download(auth_client, tmp_path):
    client, uid, gid = auth_client
    db = api._db
    tracks = db.get_tracks_for_session(1)
    link = db.create_share_link(tracks[0].id, uid)
    client.cookies.clear()
    resp = client.get(f"/api/share/{link['token']}/audio?download=1")
    assert resp.status_code == 200
    assert "attachment" in resp.headers.get("content-disposition", "")


def test_public_share_audio_invalid_token(client):
    resp = client.get("/api/share/nonexistent/audio")
    assert resp.status_code == 404


def test_share_landing_page(auth_client):
    client, uid, gid = auth_client
    db = api._db
    tracks = db.get_tracks_for_session(1)
    link = db.create_share_link(tracks[0].id, uid)
    client.cookies.clear()
    resp = client.get(f"/share/{link['token']}")
    assert resp.status_code == 200
    assert "text/html" in resp.headers.get("content-type", "")
    assert "JamJar" in resp.text
    assert f"/api/share/{link['token']}/audio" in resp.text


def test_share_landing_page_invalid_token(client):
    resp = client.get("/share/nonexistent")
    assert resp.status_code == 404


def test_share_landing_page_shows_song_name(auth_client):
    client, uid, gid = auth_client
    db = api._db
    tracks = db.get_tracks_for_session(1)
    db.tag_track(tracks[0].id, "My Song", gid)
    link = db.create_share_link(tracks[0].id, uid)
    client.cookies.clear()
    resp = client.get(f"/share/{link['token']}")
    assert "My Song" in resp.text


def test_share_landing_page_has_download_link(auth_client):
    client, uid, gid = auth_client
    db = api._db
    tracks = db.get_tracks_for_session(1)
    link = db.create_share_link(tracks[0].id, uid)
    client.cookies.clear()
    resp = client.get(f"/share/{link['token']}")
    assert "download=1" in resp.text
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pytest tests/test_api_share.py::test_public_share_audio tests/test_api_share.py::test_share_landing_page -v`
Expected: FAIL — endpoints don't exist

- [ ] **Step 3: Update auth middleware to allow public share paths**

In `api.py`, modify the auth middleware. After the `_PUBLIC_PATHS` check (line 58-59), add:

```python
    # Public share endpoints
    if path.startswith("/share/") or path.startswith("/api/share/"):
        return await call_next(request)
```

- [ ] **Step 4: Add public share audio endpoint**

Add to `api.py` after the share link endpoints:

```python
@app.get("/api/share/{token}/audio")
def public_share_audio(token: str, download: int = 0):
    from jam_session_processor.storage import get_storage

    db = get_db()
    link = db.get_share_link_by_token(token)
    if not link:
        raise HTTPException(status_code=404, detail="Share link not found")

    track = db.get_track(link["track_id"])
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    session = db.get_session(track.session_id)

    # Build download filename
    if download:
        name_parts = []
        if track.song_name:
            name_parts.append(track.song_name)
        else:
            name_parts.append(f"Track {track.track_number}")
        if session and session.name:
            name_parts.append(session.name)
        ext = Path(track.audio_path).suffix or ".m4a"
        filename = " - ".join(name_parts) + ext

    storage = get_storage()
    redirect_url = storage.url(track.audio_path)
    if redirect_url:
        return RedirectResponse(redirect_url, status_code=307)

    cfg = get_config()
    audio_path = cfg.resolve_path(track.audio_path)
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")
    media_types = {".ogg": "audio/ogg", ".m4a": "audio/mp4", ".wav": "audio/wav"}
    media_type = media_types.get(audio_path.suffix.lower(), "application/octet-stream")

    if download:
        return FileResponse(
            audio_path,
            media_type=media_type,
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    return FileResponse(audio_path, media_type=media_type)
```

- [ ] **Step 5: Add share landing page endpoint**

Add to `api.py`:

```python
from fastapi.responses import HTMLResponse

@app.get("/share/{token}")
def share_landing_page(token: str):
    db = get_db()
    link = db.get_share_link_by_token(token)
    if not link:
        raise HTTPException(status_code=404, detail="Share link not found")

    track = db.get_track(link["track_id"])
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")

    session = db.get_session(track.session_id)
    session_name = session.name if session else ""
    session_date = session.date if session else ""

    # Format date for display
    date_display = ""
    if session_date:
        parts = session_date.split("-")
        if len(parts) == 3:
            date_display = f"{int(parts[1])}/{int(parts[2])}/{parts[0][2:]}"
        else:
            date_display = session_date

    import html as html_lib
    title = html_lib.escape(track.song_name or f"Track {track.track_number}")
    session_name = html_lib.escape(session_name)
    audio_url = f"/api/share/{token}/audio"
    download_url = f"/api/share/{token}/audio?download=1"

    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title} - JamJar</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{
            background: #030712;
            color: #d1d5db;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 2rem;
        }}
        .card {{
            max-width: 480px;
            width: 100%;
            background: #111827;
            border: 1px solid #1f2937;
            border-radius: 12px;
            padding: 2rem;
        }}
        .brand {{
            font-size: 0.75rem;
            font-weight: 600;
            letter-spacing: 0.05em;
            text-transform: uppercase;
            color: #6b7280;
            margin-bottom: 1.5rem;
        }}
        .title {{
            font-size: 1.25rem;
            font-weight: 700;
            color: #f9fafb;
            margin-bottom: 0.25rem;
        }}
        .meta {{
            font-size: 0.875rem;
            color: #6b7280;
            margin-bottom: 1.5rem;
        }}
        audio {{
            width: 100%;
            margin-bottom: 1rem;
        }}
        .download {{
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            background: #1f2937;
            color: #d1d5db;
            border: none;
            border-radius: 8px;
            padding: 0.625rem 1.25rem;
            font-size: 0.875rem;
            cursor: pointer;
            text-decoration: none;
            transition: background 0.15s;
        }}
        .download:hover {{ background: #374151; color: #f9fafb; }}
    </style>
</head>
<body>
    <div class="card">
        <p class="brand">JamJar</p>
        <h1 class="title">{title}</h1>
        <p class="meta">{session_name}{(' &middot; ' + date_display) if date_display else ''}</p>
        <audio controls preload="metadata" src="{audio_url}"></audio>
        <a class="download" href="{download_url}">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"/>
            </svg>
            Download
        </a>
    </div>
</body>
</html>"""
    return HTMLResponse(content=html)
```

Note: Import `HTMLResponse` at the top of `api.py` alongside the other response imports:
```python
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
```

**Important:** The `/share/{token}` route MUST be defined before the SPA catch-all route (`/{full_path:path}` at the bottom of `api.py`). FastAPI matches routes in registration order, so defining it earlier in the file ensures it takes priority. Place it near the other share endpoints.

- [ ] **Step 6: Run tests to verify they pass**

Run: `pytest tests/test_api_share.py -v`
Expected: All PASS

- [ ] **Step 7: Run full test suite**

Run: `pytest`
Expected: All pass

- [ ] **Step 8: Lint**

Run: `ruff check src/jam_session_processor/api.py tests/test_api_share.py`
Expected: No errors

- [ ] **Step 9: Commit**

```bash
git add src/jam_session_processor/api.py tests/test_api_share.py
git commit -m "feat: add public share landing page and audio endpoint"
```

---

## Chunk 3: Frontend — Download Button & Share UI

### Task 5: Add download button to AudioPlayer component

**Files:**
- Modify: `web/src/components/AudioPlayer.tsx`

- [ ] **Step 1: Add downloadUrl prop and download button**

Add `downloadUrl?: string` to the `Props` interface in `AudioPlayer.tsx`:

```typescript
interface Props {
  src: string;
  durationSec?: number;
  markers?: Marker[];
  downloadUrl?: string;
  onPlayStateChange?: (playing: boolean, currentTime: number) => void;
  onTimeUpdate?: (currentTime: number) => void;
}
```

Update the component signature to destructure `downloadUrl`:

```typescript
export default function AudioPlayer({ src, durationSec, markers, downloadUrl, onPlayStateChange, onTimeUpdate }: Props) {
```

Add the download button after the skip-ahead button (after the `</button>` at line ~186, before the time display `<span>`):

```tsx
      {/* Download button */}
      {downloadUrl && (
        <a
          href={downloadUrl}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gray-800 text-gray-400 transition hover:bg-gray-700 hover:text-white"
          title="Download"
          download
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" />
          </svg>
        </a>
      )}
```

- [ ] **Step 2: Pass downloadUrl from TrackRow**

In `web/src/components/TrackRow.tsx`, update the `AudioPlayer` usage (around line 194):

```tsx
      <AudioPlayer
        src={api.trackAudioUrl(track.id)}
        durationSec={track.duration_sec}
        downloadUrl={`${api.trackAudioUrl(track.id)}?download=1`}
        onPlayStateChange={(playing, time) => { setPlayerPlaying(playing); setPlayerTime(time); }}
        onTimeUpdate={(time) => setPlayerTime(time)}
      />
```

- [ ] **Step 3: Verify build compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add web/src/components/AudioPlayer.tsx web/src/components/TrackRow.tsx
git commit -m "feat: add download button to audio player"
```

---

### Task 6: Add share button to TrackRow

**Files:**
- Modify: `web/src/api.ts`
- Modify: `web/src/components/TrackRow.tsx`

- [ ] **Step 1: Add share API methods to api.ts**

Add to the `api` object in `web/src/api.ts`:

```typescript
  // Share links
  createShareLink: (trackId: number) =>
    fetchJson<{ token: string; url: string }>(`${BASE}/tracks/${trackId}/share`, {
      method: "POST",
    }),

  deleteShareLink: (trackId: number) =>
    fetchJson<{ ok: boolean }>(`${BASE}/tracks/${trackId}/share`, {
      method: "DELETE",
    }),
```

- [ ] **Step 2: Add share_token to Track interface**

The API doesn't return `share_token` on the track object yet, so the simplest approach is to manage share state locally in TrackRow. No changes to the Track interface needed.

- [ ] **Step 3: Add share button to TrackRow**

In `web/src/components/TrackRow.tsx`, add share state and handler:

After the existing state declarations (around line 33):

```typescript
  const [shareLoading, setShareLoading] = useState(false);
  const [shared, setShared] = useState(false);
```

Add the share handler:

```typescript
  const handleShare = async () => {
    setShareLoading(true);
    try {
      const result = await api.createShareLink(track.id);
      const fullUrl = `${window.location.origin}${result.url}`;
      await navigator.clipboard.writeText(fullUrl);
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch (err) {
      onError(`Share failed: ${err instanceof Error ? err.message : err}`);
    } finally {
      setShareLoading(false);
    }
  };
```

Add the share button in the header row, after the time/duration info spans and before the closing `</div>` of the header row (around line 191):

```tsx
        {!tagging && (
          <button
            onClick={handleShare}
            disabled={shareLoading}
            className="ml-auto flex items-center gap-1 rounded px-2 py-1.5 text-xs text-gray-600 transition hover:text-gray-300 disabled:opacity-50"
            title={shared ? "Link copied!" : "Copy share link"}
          >
            {shared ? (
              <>
                <svg className="h-3.5 w-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-green-400">Copied!</span>
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                </svg>
                Share
              </>
            )}
          </button>
        )}
```

- [ ] **Step 4: Verify build compiles**

Run: `cd web && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add web/src/api.ts web/src/components/TrackRow.tsx
git commit -m "feat: add share button to track rows with clipboard copy"
```

---

## Chunk 4: Documentation & Cleanup

### Task 7: Update CLAUDE.md and run final verification

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md database schema section**

Add `share_links` table to the schema diagram in CLAUDE.md:

```
share_links
──────────────
id (PK)
token (UNIQUE)
track_id (FK→tracks, UNIQUE)
created_by (FK→users, nullable)
created_at
```

- [ ] **Step 2: Update CLAUDE.md REST API section**

Add to the **Tracks** line:

```
| `POST /api/tracks/{id}/share` | `DELETE /api/tracks/{id}/share`
```

Add a new **Share (public)** line:

```
**Share (public):** `GET /share/{token}` | `GET /api/share/{token}/audio`
```

Add to the relationships section:

```
- `share_links → tracks`: one-to-one, CASCADE delete
- `share_links → users`: many-to-one (nullable), SET NULL on delete
```

- [ ] **Step 3: Run full test suite**

Run: `pytest`
Expected: All pass

- [ ] **Step 4: Run lint on all changed files**

Run: `ruff check src/ tests/`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with share_links schema and endpoints"
```
