import asyncio
import functools
import gzip
import hmac
import html
import json
import logging
import os as _os
import re as _re_mod
import subprocess
import sys
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import requests as http_requests
from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import (
    FileResponse,
    HTMLResponse,
    JSONResponse,
    RedirectResponse,
    Response,
)
from pydantic import BaseModel, Field

from jam_session_processor.auth import (
    burn_password_check,
    create_jwt,
    decode_jwt,
    hash_password,
    verify_password,
)
from jam_session_processor.config import get_config
from jam_session_processor.db import Database
from jam_session_processor.email import send_access_request_email as _send_access_request_email

logger = logging.getLogger(__name__)

# --- Background job lifecycle ---
# Processing runs in executor threads. A restart (e.g. a deploy) kills those threads,
# which used to leave jobs "processing" forever. On startup we fail any such leftovers;
# on shutdown we wait for in-flight jobs to finish first (docker-compose gives the
# container a matching stop_grace_period).

_active_jobs = 0
_active_jobs_lock = threading.Lock()


def _tracked_job(fn):
    """Count a background job as in flight while it runs."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        global _active_jobs
        with _active_jobs_lock:
            _active_jobs += 1
        try:
            return fn(*args, **kwargs)
        finally:
            with _active_jobs_lock:
                _active_jobs -= 1

    return wrapper


def active_job_count() -> int:
    with _active_jobs_lock:
        return _active_jobs


async def _wait_for_jobs(grace_seconds: float, poll: float = 1.0) -> bool:
    """Wait until no background job is running, up to `grace_seconds`. True if drained."""
    deadline = time.monotonic() + grace_seconds
    logged = False
    while active_job_count() > 0:
        if time.monotonic() >= deadline:
            logger.warning("Shutting down with %d job(s) still running", active_job_count())
            return False
        if not logged:
            logger.info("Waiting for %d processing job(s) to finish", active_job_count())
            logged = True
        await asyncio.sleep(poll)
    return True


# --- Automatic song tagging runs ---
# Speech-to-text needs ~0.8 GB while it runs, so it lives in its own process
# (`jam-session identify-songs`) that gives the memory back when it exits. The server
# starts one nightly (everything pending) and one after each upload or re-split (that
# recording only). One runs at a time; the rest wait in a queue. Work is saved per
# track, so killing a run loses nothing.

_identify_lock = threading.Lock()
_identify_proc: subprocess.Popen | None = None
_identify_current: int | None = None  # recording of the running run; None = full run
_identify_pending: list[int | None] = []


def _identify_hour() -> int | None:
    """Hour of day (UTC) for the nightly run; None when automatic runs are off."""
    raw = _os.environ.get("JAM_IDENTIFY_HOUR", "8").strip().lower()
    if raw in ("", "off", "none", "false", "no"):
        return None
    try:
        return int(raw) % 24
    except ValueError:
        return None


def _seconds_until_hour(hour: int, now: datetime | None = None) -> float:
    now = now or datetime.now(timezone.utc)
    target = now.replace(hour=hour, minute=0, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return (target - now).total_seconds()


def _identify_running() -> bool:
    return _identify_proc is not None and _identify_proc.poll() is None


def _launch_identify(session_id: int | None) -> None:
    """Start a run in a child process (call with the lock held)."""
    global _identify_proc, _identify_current
    cmd = [sys.executable, "-c", "from jam_session_processor.cli import cli; cli()"]
    cmd.append("identify-songs")
    if session_id is not None:
        cmd += ["--session", str(session_id)]
    _identify_proc = subprocess.Popen(cmd)
    _identify_current = session_id
    threading.Thread(target=_after_identify, args=(_identify_proc,), daemon=True).start()


def _after_identify(proc: subprocess.Popen) -> None:
    """When a run ends, start the next queued one."""
    proc.wait()
    with _identify_lock:
        if _identify_proc is proc and _identify_pending:
            _launch_identify(_identify_pending.pop(0))


def _request_identify(session_id: int | None = None) -> bool:
    """Start a tagging run (for one recording, or everything), or queue it behind the
    running one. False when the same run is already running or queued."""
    with _identify_lock:
        if session_id in _identify_pending:
            return False
        if _identify_running():
            if _identify_current == session_id:
                return False
            _identify_pending.append(session_id)
        else:
            _launch_identify(session_id)
        return True


def _tag_after_processing(session_id: int) -> None:
    """A recording was just split into tracks: try to tag them right away."""
    from jam_session_processor import transcribe

    try:
        if _identify_hour() is not None and transcribe.is_available():
            _request_identify(session_id)
    except Exception:
        # Never fail the upload over this; the nightly run picks the recording up
        logger.exception("Could not start song tagging for recording %s", session_id)


async def _identify_scheduler(hour: int):
    while True:
        await asyncio.sleep(_seconds_until_hour(hour))
        try:
            _request_identify(None)
        except Exception:
            logger.exception("Nightly song identification failed to run")
        await asyncio.sleep(60)  # never start twice within the same minute


@asynccontextmanager
async def _lifespan(app: FastAPI):
    try:
        n = get_db().fail_interrupted_jobs()
        if n:
            logger.warning("Marked %d job(s) interrupted by the last restart as failed", n)
    except Exception:
        logger.exception("Could not clean up interrupted jobs")
    from jam_session_processor import transcribe

    scheduler = None
    hour = _identify_hour()
    if hour is not None and transcribe.is_available():
        scheduler = asyncio.create_task(_identify_scheduler(hour))
    yield
    if scheduler:
        scheduler.cancel()
    with _identify_lock:
        _identify_pending.clear()
        if _identify_running():
            _identify_proc.terminate()
    await _wait_for_jobs(float(_os.environ.get("JAM_SHUTDOWN_GRACE_SEC", "270")))


app = FastAPI(title="Jam Session Processor", version="0.1.0", lifespan=_lifespan)

# --- Request field length limits ---
# Applied to every string field in request models so oversized input is rejected
# with a 422 before it reaches the database.
ShortStr = Annotated[str, Field(max_length=64)]  # enums, dates, times, ids
NameStr = Annotated[str, Field(max_length=200)]
EmailStr_ = Annotated[str, Field(max_length=254)]
PasswordStr = Annotated[str, Field(max_length=128)]
TokenStr = Annotated[str, Field(max_length=256)]
FilenameStr = Annotated[str, Field(max_length=255)]
TextStr = Annotated[str, Field(max_length=5_000)]
NotesStr = Annotated[str, Field(max_length=20_000)]
SheetStr = Annotated[str, Field(max_length=100_000)]


@app.get("/health")
def health():
    try:
        get_db().ping()
    except Exception:
        logger.exception("Health check: database unreachable")
        return JSONResponse(status_code=503, content={"status": "error", "db": "unreachable"})
    return {"status": "ok", "db": "ok"}


class JSONGzipMiddleware:
    """Gzip JSON responses when the client accepts it.

    Deliberately limited to application/json: audio is streamed with Range
    requests, which compressing would break.
    """

    def __init__(self, app, minimum_size: int = 1024):
        self.app = app
        self.minimum_size = minimum_size

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        accepts = any(
            k == b"accept-encoding" and b"gzip" in v.lower() for k, v in scope.get("headers", [])
        )
        if not accepts:
            return await self.app(scope, receive, send)

        start: dict | None = None
        chunks: list[bytes] = []
        passthrough = False

        async def wrapped(message):
            nonlocal start, passthrough
            if message["type"] == "http.response.start":
                headers = {k.lower(): v for k, v in message.get("headers", [])}
                ctype = headers.get(b"content-type", b"")
                if ctype.startswith(b"application/json") and b"content-encoding" not in headers:
                    start = message
                    return
                passthrough = True
                return await send(message)
            if passthrough or start is None:
                return await send(message)
            chunks.append(message.get("body", b""))
            if message.get("more_body"):
                return
            body = b"".join(chunks)
            headers = [
                (k, v) for k, v in start.get("headers", []) if k.lower() != b"content-length"
            ]
            if len(body) >= self.minimum_size:
                body = gzip.compress(body, compresslevel=6)
                headers += [(b"content-encoding", b"gzip"), (b"vary", b"Accept-Encoding")]
            headers.append((b"content-length", str(len(body)).encode()))
            await send({**start, "headers": headers})
            await send({"type": "http.response.body", "body": body})

        await self.app(scope, receive, wrapped)


cfg = get_config()
app.add_middleware(JSONGzipMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=cfg.cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

_db: Database | None = None


def get_db() -> Database:
    global _db
    if _db is None:
        _db = Database()
    return _db


# --- Rate limiting ---


def _get_client_ip(request: Request) -> str:
    """Client IP for rate limiting.

    Production runs behind a single Caddy reverse proxy (Cloudflare DNS-only, not
    proxied). Caddy appends the address it saw to X-Forwarded-For, so the *last*
    entry is trustworthy; earlier entries and headers like CF-Connecting-IP are
    client-controlled and would let an attacker rotate IPs to dodge rate limits.
    If another proxy hop is ever added in front of Caddy, revisit this.
    """
    forwarded = request.headers.get("x-forwarded-for", "")
    last_hop = forwarded.rsplit(",", 1)[-1].strip()
    if last_hop:
        return last_hop
    return request.client.host if request.client else "unknown"


class RateLimiter:
    """In-memory per-IP rate limiter with sliding window."""

    # Sweep stale keys once the table grows past this many entries
    _SWEEP_THRESHOLD = 10_000

    def __init__(self, max_attempts: int, window_seconds: int):
        self.max_attempts = max_attempts
        self.window = window_seconds
        self._attempts: dict[str, list[float]] = {}

    def is_blocked(self, key: str) -> bool:
        now = time.monotonic()
        attempts = [t for t in self._attempts.get(key, []) if now - t < self.window]
        if attempts:
            self._attempts[key] = attempts
        else:
            self._attempts.pop(key, None)
        return len(attempts) >= self.max_attempts

    def record(self, key: str):
        now = time.monotonic()
        if len(self._attempts) > self._SWEEP_THRESHOLD:
            self._attempts = {
                k: v for k, v in self._attempts.items() if v and now - v[-1] < self.window
            }
        self._attempts.setdefault(key, []).append(now)

    def hit(self, key: str) -> bool:
        """Record an attempt and return True if the caller is over the limit."""
        if self.is_blocked(key):
            return True
        self.record(key)
        return False

    def reset(self, key: str):
        self._attempts.pop(key, None)


_login_limiter = RateLimiter(max_attempts=5, window_seconds=60)
_access_request_limiter = RateLimiter(max_attempts=3, window_seconds=3600)
# Unauthenticated endpoints that send email or accept secret tokens
_forgot_password_limiter = RateLimiter(max_attempts=5, window_seconds=3600)
_token_limiter = RateLimiter(max_attempts=20, window_seconds=600)


def _enforce_rate_limit(limiter: RateLimiter, key: str, detail: str) -> None:
    if limiter.hit(key):
        raise HTTPException(status_code=429, detail=detail)


_TOO_MANY = "Too many requests. Please try again later."


# --- Auth middleware ---

_PUBLIC_PATHS = {
    "/health",
    "/api/auth/login",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
    "/api/auth/reset-password/validate",
    "/api/access-request",
}
_last_active_cache: dict[int, float] = {}


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    cfg = get_config()

    # Public endpoints
    if path in _PUBLIC_PATHS:
        return await call_next(request)

    # Public share endpoints
    if path.startswith("/share/") or path.startswith("/api/share/"):
        return await call_next(request)

    # Public invite endpoints
    if path.startswith("/api/invite/"):
        return await call_next(request)

    # Non-API paths (SPA static files)
    if not path.startswith("/api"):
        return await call_next(request)

    # API key auth (for CLI upload)
    api_key = request.headers.get("x-api-key")
    if api_key:
        if not cfg.api_key:
            return JSONResponse(status_code=401, content={"detail": "API key auth not configured"})
        if not hmac.compare_digest(api_key.encode(), cfg.api_key.encode()):
            return JSONResponse(status_code=401, content={"detail": "Invalid API key"})
        request.state.auth_type = "api_key"
        request.state.user = None
        request.state.group_ids = None  # API key has no group scoping — caller must specify
        return await call_next(request)

    # Cookie auth (for browser)
    token = request.cookies.get("jam_session")
    if token:
        try:
            payload = decode_jwt(token)
        except Exception:
            return JSONResponse(status_code=401, content={"detail": "Invalid or expired token"})
        db = get_db()
        user = db.get_user(int(payload["sub"]))
        if not user:
            return JSONResponse(status_code=401, content={"detail": "User not found"})
        request.state.auth_type = "cookie"
        request.state.user = user
        request.state.group_ids = db.get_group_ids_for_user(user.id)
        now = time.monotonic()
        if now - _last_active_cache.get(user.id, 0) > 300:
            db.update_last_active(user.id)
            _last_active_cache[user.id] = now
        return await call_next(request)

    return JSONResponse(status_code=401, content={"detail": "Authentication required"})


# --- Helper: get group_id for the current request's session/track ---


def _require_group_access(request: Request, group_id: int):
    """Raise 404 if user doesn't have access to this group."""
    if request.state.auth_type == "api_key":
        return  # API key has full access
    if group_id not in request.state.group_ids:
        raise HTTPException(status_code=404, detail="Not found")


def _get_group_ids(request: Request) -> list[int]:
    """Get the group_ids for list-filtering. API key returns None (all groups)."""
    if request.state.auth_type == "api_key":
        return None
    return request.state.group_ids


_ROLE_LEVEL = {"readonly": 0, "editor": 1, "admin": 2, "superadmin": 3}


def _require_role(request: Request, min_role: str):
    """Raise 403 if the current user lacks the required role level."""
    if request.state.auth_type == "api_key":
        return  # API key = full access
    user = request.state.user
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    if _ROLE_LEVEL.get(user.role, 0) < _ROLE_LEVEL[min_role]:
        raise HTTPException(status_code=403, detail="Insufficient permissions")


# --- Auth endpoints ---


class LoginRequest(BaseModel):
    email: EmailStr_
    password: PasswordStr


class AuthUserGroup(BaseModel):
    id: int
    name: str
    features: list[str] = []


class AuthUserResponse(BaseModel):
    id: int
    email: str
    name: str
    role: str
    groups: list[AuthUserGroup]


@app.post("/api/auth/login")
def login(req: LoginRequest, request: Request):
    ip = _get_client_ip(request)
    if _login_limiter.is_blocked(ip):
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Try again in a minute.",
        )
    db = get_db()
    user = db.get_user_by_email(req.email)
    if not user or not user.password_hash:
        burn_password_check(req.password)
    if not user or not user.password_hash or not verify_password(req.password, user.password_hash):
        _login_limiter.record(ip)
        raise HTTPException(status_code=401, detail="Invalid username or password")
    _login_limiter.reset(ip)
    token = create_jwt(user.id, user.email)
    groups = db.get_user_groups(user.id)
    db.log_activity(user.id, None, "login")
    response = JSONResponse(
        content={
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "groups": [{"id": g.id, "name": g.name} for g in groups],
        }
    )
    response.set_cookie(
        key="jam_session",
        value=token,
        httponly=True,
        secure=get_config().app_url.startswith("https"),
        samesite="lax",
        max_age=7 * 24 * 3600,
        path="/",
    )
    return response


@app.get("/api/auth/me", response_model=AuthUserResponse)
def get_me(request: Request):
    user = request.state.user
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    db = get_db()
    groups = db.get_user_groups(user.id)
    return AuthUserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        groups=[
            AuthUserGroup(
                id=g.id,
                name=g.name,
                features=[f for f in (g.features or "").split(",") if f],
            )
            for g in groups
        ],
    )


class ChangePasswordRequest(BaseModel):
    current_password: PasswordStr
    new_password: PasswordStr


@app.put("/api/auth/password")
def change_password(req: ChangePasswordRequest, request: Request):
    user = request.state.user
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    if _login_limiter.is_blocked(f"user:{user.id}"):
        raise HTTPException(status_code=429, detail=_TOO_MANY)
    if not verify_password(req.current_password, user.password_hash):
        _login_limiter.record(f"user:{user.id}")
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if len(req.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    db = get_db()
    db.update_user_password(user.id, hash_password(req.new_password))
    return {"ok": True}


@app.post("/api/auth/logout")
def logout():
    response = JSONResponse(content={"ok": True})
    response.delete_cookie(key="jam_session", path="/")
    return response


class ForgotPasswordRequest(BaseModel):
    email: EmailStr_


@app.post("/api/auth/forgot-password")
def forgot_password(req: ForgotPasswordRequest, request: Request):
    _enforce_rate_limit(_forgot_password_limiter, _get_client_ip(request), _TOO_MANY)
    from jam_session_processor.email import send_password_reset_email

    db = get_db()
    user = db.get_user_by_email(req.email)
    # Always return success to avoid email enumeration
    if user and user.password_hash:
        token = db.create_password_reset_token(user.id)
        send_password_reset_email(user.email, token, user.name)
    return {"ok": True}


class ResetPasswordValidateRequest(BaseModel):
    token: TokenStr


@app.post("/api/auth/reset-password/validate")
def reset_password_validate(req: ResetPasswordValidateRequest, request: Request):
    _enforce_rate_limit(_token_limiter, _get_client_ip(request), _TOO_MANY)
    from datetime import datetime, timezone

    db = get_db()
    row = db.get_password_reset_token(req.token)
    if not row:
        raise HTTPException(status_code=404, detail="Invalid reset link")
    if row.used_at is not None:
        raise HTTPException(status_code=410, detail="This reset link has already been used")
    expires_at = datetime.strptime(row.expires_at, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires_at:
        raise HTTPException(status_code=410, detail="This reset link has expired")
    user = db.get_user(row.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User no longer exists")
    return {"email": user.email}


class ResetPasswordRequest(BaseModel):
    token: TokenStr
    password: PasswordStr


@app.post("/api/auth/reset-password")
def reset_password(req: ResetPasswordRequest, request: Request):
    _enforce_rate_limit(_token_limiter, _get_client_ip(request), _TOO_MANY)
    from datetime import datetime, timezone

    if not req.password or len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    db = get_db()
    row = db.get_password_reset_token(req.token)
    if not row:
        raise HTTPException(status_code=404, detail="Invalid reset link")
    if row.used_at is not None:
        raise HTTPException(status_code=410, detail="This reset link has already been used")
    expires_at = datetime.strptime(row.expires_at, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires_at:
        raise HTTPException(status_code=410, detail="This reset link has expired")
    user = db.get_user(row.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User no longer exists")
    db.update_user_password(user.id, hash_password(req.password))
    db.consume_password_reset_token(req.token)
    token = create_jwt(user.id, user.email)
    groups = db.get_user_groups(user.id)
    response = JSONResponse(
        {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "groups": [{"id": g.id, "name": g.name} for g in groups],
        }
    )
    response.set_cookie(
        key="jam_session",
        value=token,
        httponly=True,
        secure=get_config().app_url.startswith("https"),
        samesite="lax",
        max_age=7 * 24 * 3600,
        path="/",
    )
    return response


# --- Access Request (public) ---


class AccessRequest(BaseModel):
    email: EmailStr_
    band_name: NameStr
    message: TextStr


@app.post("/api/access-request")
async def request_access(body: AccessRequest, request: Request):
    import re

    email = body.email.strip()
    band_name = body.band_name.strip()
    message = body.message.strip()

    if not email or not band_name or not message:
        raise HTTPException(422, "All fields are required")
    if not re.match(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise HTTPException(422, "Invalid email address")

    ip = _get_client_ip(request)
    if _access_request_limiter.is_blocked(ip):
        raise HTTPException(429, "Too many requests. Please try again later.")
    _access_request_limiter.record(ip)

    cfg = get_config()
    recipient = cfg.access_request_email or cfg.smtp_from
    if recipient:
        _send_access_request_email(recipient, email, band_name, message)
    else:
        logger.warning(
            "No access request email configured — request from %s (%s) logged only",
            email,
            band_name,
        )

    return {"ok": True, "message": "Thanks! We'll be in touch."}


# --- Response models ---


class SessionResponse(BaseModel):
    id: int
    group_id: int
    group_name: str = ""
    name: str
    date: str | None
    source_file: str
    duration_sec: float | None = None
    notes: str
    track_count: int
    tagged_count: int
    song_names: str = ""
    active_job_id: str | None = None
    created_at: str = ""
    created_by_name: str | None = None
    updated_by_name: str | None = None
    updated_at: str | None = None
    kind: str = ""


class TrackResponse(BaseModel):
    id: int
    session_id: int
    song_id: int | None
    song_name: str | None
    track_number: int
    start_sec: float
    end_sec: float
    duration_sec: float
    notes: str
    # True when the song tag was set by the nightly identification run, not by a person
    auto_tagged: bool = False


class SongGroup(BaseModel):
    id: int
    name: str
    notes: str = ""


class SongLinkResponse(BaseModel):
    id: int
    kind: str
    url: str
    title: str = ""
    created_by_name: str | None = None


class BackgroundSource(BaseModel):
    title: NameStr
    url: Annotated[str, Field(max_length=500)]


class SongBackground(BaseModel):
    # Paragraph with [n] markers that refer to sources[n-1]
    text: str
    sources: list[BackgroundSource]


class SongResponse(BaseModel):
    id: int
    # Home group (kept for compatibility); `groups` lists every group of the
    # caller's that plays this song.
    group_id: int
    group_name: str = ""
    groups: list[SongGroup] = []
    name: str
    artist: str = ""
    sheet: str = ""
    notes: str = ""
    take_count: int
    first_date: str | None
    last_date: str | None
    created_by_name: str | None = None
    updated_by_name: str | None = None
    updated_at: str | None = None
    has_sheet: bool = False
    # Guitar tablature (intros, riffs, solos), separate from the chords/lyrics chart
    tab: str = ""
    has_tab: bool = False
    # Notated sheet music (an uploaded MusicXML file): "mxl" | "musicxml", or null.
    # `score_version` is the file's content hash and changes when it is replaced.
    score_format: str | None = None
    score_version: str | None = None
    # When the song was added to the catalog (UTC "YYYY-MM-DD HH:MM:SS")
    created_at: str | None = None
    links: list[SongLinkResponse] = []
    # Short written history of the song ("About" tab); null when there is none
    background: SongBackground | None = None
    # The caller's own activity (UTC "YYYY-MM-DD HH:MM:SS"); null for API-key callers
    last_opened_at: str | None = None
    last_performed_at: str | None = None


class SongTrackResponse(BaseModel):
    id: int
    session_id: int
    track_number: int
    start_sec: float
    end_sec: float
    duration_sec: float
    notes: str
    session_date: str | None
    source_file: str
    session_name: str
    session_kind: str = ""


class TagRequest(BaseModel):
    song_name: NameStr


class NotesRequest(BaseModel):
    notes: NotesStr


class NameRequest(BaseModel):
    name: NameStr


class MergeRequest(BaseModel):
    other_track_id: int


class SplitRequest(BaseModel):
    split_at_sec: float


class TrimRequest(BaseModel):
    start_delta: float = 0.0
    end_delta: float = 0.0


class SongDetailsRequest(BaseModel):
    artist: NameStr = ""
    sheet: SheetStr = ""
    notes: NotesStr = ""


class DateRequest(BaseModel):
    date: ShortStr | None


class KindRequest(BaseModel):
    kind: Literal["", "jam", "gig", "demo", "studio"]


class MergeSessionsRequest(BaseModel):
    session_ids: list[int] = Field(min_length=1, max_length=50)


class GroupRequest(BaseModel):
    group_id: int


class JobResponse(BaseModel):
    id: str
    type: str
    group_id: int
    status: str
    progress: str
    session_id: int | None
    error: str | None


class ReprocessRequest(BaseModel):
    threshold: float = -20.0
    min_duration: int = 120
    single: bool = False
    # Manual split: explicit [start_sec, end_sec] songs instead of detection
    segments: list[tuple[float, float]] | None = Field(default=None, max_length=200)


class UploadInitRequest(BaseModel):
    filename: FilenameStr
    group_id: int | None = None
    threshold: float | None = None
    single: bool = False
    force: bool = False


class UploadInitResponse(BaseModel):
    upload_url: str | None
    r2_key: str | None
    job: JobResponse
    session_id: int


class UploadCompleteRequest(BaseModel):
    job_id: ShortStr
    session_id: int
    threshold: float | None = None
    single: bool = False
    force: bool = False


# --- Response helpers ---


def _strip_to_basename(path: str) -> str:
    """Strip a path to just its filename (no directory components)."""
    return Path(path).name if path else path


def _session_response(session) -> SessionResponse:
    db = get_db()
    group = db.get_group(session.group_id)
    group_name = group.name if group else ""
    d = session.__dict__.copy()
    d["source_file"] = _strip_to_basename(d.get("source_file", ""))
    d["group_name"] = group_name
    d["created_by_name"] = db.get_user_name(d.pop("created_by", None))
    d["updated_by_name"] = db.get_user_name(d.pop("updated_by", None))
    return SessionResponse(**d)


def _track_response(track, auto_tagged: set[int] | None = None) -> TrackResponse:
    d = track.__dict__.copy()
    d.pop("audio_path", None)
    return TrackResponse(**d, auto_tagged=bool(auto_tagged and track.id in auto_tagged))


def _song_response(
    song, request: Request | None = None, activity: dict[int, dict] | None = None
) -> SongResponse:
    db = get_db()
    if activity is None and request is not None and request.state.user:
        activity = db.get_song_activity(request.state.user.id)
    groups = db.get_song_groups(song.id)
    visible = _get_group_ids(request) if request is not None else None
    if visible is not None:
        groups = [g for g in groups if g["id"] in visible]
    d = song.__dict__.copy()
    d["groups"] = groups
    # Report a home group the caller can see (falls back to the stored home group)
    home = next((g for g in groups if g["id"] == song.group_id), groups[0] if groups else None)
    if home:
        d["group_id"], d["group_name"] = home["id"], home["name"]
    else:
        group = db.get_group(song.group_id)
        d["group_name"] = group.name if group else ""
    d["created_by_name"] = db.get_user_name(d.pop("created_by", None))
    d["updated_by_name"] = db.get_user_name(d.pop("updated_by", None))
    bg_text, bg_sources = d.pop("background", ""), d.pop("background_sources", "")
    d["background"] = (
        SongBackground(text=bg_text, sources=json.loads(bg_sources or "[]")) if bg_text else None
    )
    d["has_sheet"] = bool((song.sheet or "").strip())
    d["has_tab"] = bool((song.tab or "").strip())
    score_path = d.pop("score_path", None)
    d["score_format"] = Path(score_path).suffix.lstrip(".") if score_path else None
    d["score_version"] = Path(score_path).stem.rpartition("-")[2] if score_path else None
    d["links"] = [
        SongLinkResponse(
            id=link["id"],
            kind=link["kind"],
            url=link["url"],
            title=link["title"],
            created_by_name=db.get_user_name(link["created_by"]),
        )
        for link in db.list_song_links(song.id)
    ]
    d.update((activity or {}).get(song.id, {}))
    return SongResponse(**d)


def _song_track_response(row: dict) -> SongTrackResponse:
    row = dict(row)
    row.pop("audio_path", None)
    row["source_file"] = _strip_to_basename(row.get("source_file", ""))
    return SongTrackResponse(**row)


# --- Session endpoints ---


@app.get("/api/sessions", response_model=list[SessionResponse])
def list_sessions(request: Request):
    db = get_db()
    group_ids = _get_group_ids(request)
    return [_session_response(s) for s in db.list_sessions(group_ids)]


@app.get("/api/sessions/{session_id}", response_model=SessionResponse)
def get_session(session_id: int, request: Request):
    db = get_db()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    _require_group_access(request, session.group_id)
    return _session_response(session)


@app.put("/api/sessions/{session_id}/name", response_model=SessionResponse)
def update_session_name(session_id: int, req: NameRequest, request: Request):
    db = get_db()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    _require_group_access(request, session.group_id)
    _require_role(request, "editor")
    user_id = request.state.user.id if request.state.user else None
    db.update_session_name(session_id, req.name, updated_by=user_id)
    session = db.get_session(session_id)
    return _session_response(session)


@app.put("/api/sessions/{session_id}/notes", response_model=SessionResponse)
def update_session_notes(session_id: int, req: NotesRequest, request: Request):
    db = get_db()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    _require_group_access(request, session.group_id)
    _require_role(request, "editor")
    user_id = request.state.user.id if request.state.user else None
    db.update_session_notes(session_id, req.notes, updated_by=user_id)
    session = db.get_session(session_id)
    return _session_response(session)


@app.put("/api/sessions/{session_id}/date", response_model=SessionResponse)
def update_session_date(session_id: int, req: DateRequest, request: Request):
    db = get_db()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    _require_group_access(request, session.group_id)
    _require_role(request, "editor")
    user_id = request.state.user.id if request.state.user else None
    db.update_session_date(session_id, req.date, updated_by=user_id)
    session = db.get_session(session_id)
    return _session_response(session)


@app.put("/api/sessions/{session_id}/kind", response_model=SessionResponse)
def update_session_kind(session_id: int, req: KindRequest, request: Request):
    """Set what a recording is: jam, gig, demo or studio ('' clears it)."""
    db = get_db()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    _require_group_access(request, session.group_id)
    _require_role(request, "editor")
    user_id = request.state.user.id if request.state.user else None
    db.update_session_kind(session_id, req.kind, updated_by=user_id)
    return _session_response(db.get_session(session_id))


@_tracked_job
def _process_session_merge(job_id: str, session_id: int, other_ids: list[int], user_id: int | None):
    """Merge recordings into one in a background thread."""
    from jam_session_processor.track_ops import merge_sessions

    db = get_db()
    try:
        merge_sessions(
            db,
            session_id,
            other_ids,
            on_progress=lambda msg: db.update_job_progress(job_id, msg),
            updated_by=user_id,
        )
        db.complete_job(job_id, session_id)
    except Exception as e:
        logger.exception("Merging recordings failed")
        db.fail_job(job_id, str(e))


@app.post("/api/sessions/{session_id}/merge", response_model=JobResponse, status_code=202)
async def merge_sessions_endpoint(session_id: int, req: MergeSessionsRequest, request: Request):
    """Merge other recordings of the same band into this one, in the order given.
    Tracks keep their tags, notes and share links. Returns a job to poll."""
    db = get_db()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    _require_group_access(request, session.group_id)
    _require_role(request, "admin")
    if session_id in req.session_ids or len(set(req.session_ids)) != len(req.session_ids):
        raise HTTPException(status_code=400, detail="List each other recording once")
    for s in [session, *(db.get_session(sid) for sid in req.session_ids)]:
        if not s:
            raise HTTPException(status_code=404, detail="Session not found")
        if s.group_id != session.group_id:
            raise HTTPException(status_code=400, detail="Recordings must belong to the same band")
        if s.active_job_id:
            raise HTTPException(
                status_code=409, detail="One of the recordings is still being processed"
            )

    job_id = uuid4().hex[:16]
    job = db.create_job(job_id, session.group_id, job_type="merge", session_id=session_id)
    user_id = request.state.user.id if request.state.user else None
    if user_id:
        db.log_activity(user_id, session.group_id, "merge_sessions", session.name)

    loop = asyncio.get_event_loop()
    loop.run_in_executor(
        None, _process_session_merge, job.id, session_id, list(req.session_ids), user_id
    )
    return JobResponse(
        id=job.id,
        type=job.type,
        group_id=job.group_id,
        status=job.status,
        progress=job.progress,
        session_id=job.session_id,
        error=job.error,
    )


@app.put("/api/sessions/{session_id}/group", response_model=SessionResponse)
def update_session_group(session_id: int, req: GroupRequest, request: Request):
    db = get_db()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    _require_group_access(request, session.group_id)
    _require_group_access(request, req.group_id)
    _require_role(request, "admin")
    if not db.get_group(req.group_id):
        raise HTTPException(status_code=400, detail="Group not found")
    db.update_session_group(session_id, req.group_id)
    session = db.get_session(session_id)
    return _session_response(session)


class DeleteSessionRequest(BaseModel):
    delete_files: bool = False


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: int, request: Request, req: DeleteSessionRequest | None = None):
    from jam_session_processor.storage import get_storage

    db = get_db()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    _require_group_access(request, session.group_id)
    _require_role(request, "admin")

    if req and req.delete_files:
        storage = get_storage()
        tracks = db.get_tracks_for_session(session_id)
        for t in tracks:
            storage.delete(t.audio_path)
        if session.source_file:
            storage.delete(session.source_file)

    db.delete_session(session_id)
    return {"ok": True}


@app.get("/api/sessions/{session_id}/audio")
def stream_session_audio(session_id: int, request: Request):
    from jam_session_processor.storage import get_storage

    db = get_db()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    _require_group_access(request, session.group_id)

    storage = get_storage()
    redirect_url = storage.url(session.source_file)
    if redirect_url:
        return RedirectResponse(redirect_url, status_code=307)

    cfg = get_config()
    audio_path = cfg.resolve_path(session.source_file)
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Source audio file not found")
    suffix = audio_path.suffix.lower()
    media_types = {".m4a": "audio/mp4", ".wav": "audio/wav", ".mp3": "audio/mpeg"}
    media_type = media_types.get(suffix, "application/octet-stream")
    return FileResponse(audio_path, media_type=media_type)


@app.get("/api/sessions/{session_id}/tracks", response_model=list[TrackResponse])
def get_session_tracks(session_id: int, request: Request):
    db = get_db()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    _require_group_access(request, session.group_id)
    auto = db.get_auto_tagged_track_ids(session_id)
    return [_track_response(t, auto) for t in db.get_tracks_for_session(session_id)]


@_tracked_job
def _process_reprocess(
    job_id: str,
    session_id: int,
    threshold: float,
    min_duration: int,
    single: bool,
    manual_segments: list[tuple[float, float]] | None = None,
):
    """Run reprocessing in a background thread."""
    from jam_session_processor.metadata import extract_metadata
    from jam_session_processor.output import export_segments
    from jam_session_processor.splitter import detect_songs
    from jam_session_processor.storage import get_storage

    db = get_db()
    cfg = get_config()
    storage = get_storage()
    exported = []
    source = None

    try:
        session = db.get_session(session_id)
        if not session:
            db.fail_job(job_id, "Session not found")
            return

        source = cfg.resolve_path(session.source_file)

        # Ensure source file is local if using remote storage
        if storage.is_remote:
            db.update_job_progress(job_id, "Downloading from storage...")
            source = storage.get(session.source_file, source)

        if not source.exists():
            db.fail_job(job_id, "Source audio file not found on disk")
            return

        # Determine output dir from existing tracks or default
        existing_tracks = db.get_tracks_for_session(session_id)
        if existing_tracks:
            output_dir = cfg.resolve_path(existing_tracks[0].audio_path).parent
        else:
            output_dir = cfg.output_dir_for_session(session_id)

        # Delete old tracks and their audio files
        db.update_job_progress(job_id, "Removing old tracks...")
        for track in existing_tracks:
            storage.delete(track.audio_path)
            db.delete_track(track.id)

        # Re-detect songs (or use full duration for single-song mode)
        meta = extract_metadata(source)
        if manual_segments:
            # Clamp to the recording's real length
            segments = [
                (max(0.0, a), min(b, meta.duration_seconds))
                for a, b in manual_segments
                if min(b, meta.duration_seconds) - max(0.0, a) >= 1
            ]
        elif single:
            segments = [(0.0, meta.duration_seconds)]
        else:
            db.update_job_progress(job_id, "Detecting songs...")
            result = detect_songs(
                source,
                energy_threshold_db=threshold,
                min_song_duration_sec=min_duration,
            )
            segments = result.segments if result.segments else []

        if segments:
            db.update_job_progress(job_id, "Exporting tracks...")
            exported = export_segments(source, segments, output_dir)

            for i, ((start, end), audio_path) in enumerate(zip(segments, exported), start=1):
                db.update_job_progress(job_id, f"Saving track {i} of {len(segments)}...")
                rel_path = cfg.make_relative(audio_path.resolve())
                db.create_track(
                    session_id,
                    track_number=i,
                    start_sec=start,
                    end_sec=end,
                    audio_path=rel_path,
                )
                if storage.is_remote:
                    storage.put(rel_path, audio_path.resolve())

        db.complete_job(job_id, session_id)
        _tag_after_processing(session_id)
    except Exception as e:
        logger.exception("Reprocess failed")
        db.fail_job(job_id, str(e))
    finally:
        if storage.is_remote:
            for audio_path in exported:
                audio_path.resolve().unlink(missing_ok=True)
            if source:
                source.unlink(missing_ok=True)


@app.post(
    "/api/sessions/{session_id}/reprocess",
    response_model=JobResponse,
    status_code=202,
)
async def reprocess_session(session_id: int, req: ReprocessRequest, request: Request):
    """Re-run song detection on a session with new parameters. Returns a job to poll."""
    db = get_db()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    _require_group_access(request, session.group_id)
    _require_role(request, "admin")

    segments = None
    if req.segments is not None:
        segments = sorted((float(a), float(b)) for a, b in req.segments)
        if not segments:
            raise HTTPException(status_code=400, detail="Mark at least one song")
        for i, (a, b) in enumerate(segments):
            if a < 0 or b - a < 5:
                raise HTTPException(status_code=400, detail="Each song must be at least 5 seconds")
            if i and a < segments[i - 1][1]:
                raise HTTPException(status_code=400, detail="Songs can't overlap")

    job_id = uuid4().hex[:16]
    job = db.create_job(job_id, session.group_id, job_type="reprocess", session_id=session_id)

    if request.state.user:
        db.log_activity(request.state.user.id, session.group_id, "reprocess", session.source_file)

    loop = asyncio.get_event_loop()
    loop.run_in_executor(
        None,
        _process_reprocess,
        job.id,
        session_id,
        req.threshold,
        req.min_duration,
        req.single,
        segments,
    )

    return JobResponse(
        id=job.id,
        type=job.type,
        group_id=job.group_id,
        status=job.status,
        progress=job.progress,
        session_id=job.session_id,
        error=job.error,
    )


ALLOWED_EXTENSIONS = {".m4a", ".wav", ".mp3", ".flac", ".ogg"}


# --- Job endpoints ---


@app.get("/api/jobs/{job_id}", response_model=JobResponse)
def get_job(job_id: str, request: Request):
    db = get_db()
    job = db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    _require_group_access(request, job.group_id)
    return JobResponse(
        id=job.id,
        type=job.type,
        group_id=job.group_id,
        status=job.status,
        progress=job.progress,
        session_id=job.session_id,
        error=job.error,
    )


@_tracked_job
def _process_upload(
    job_id: str,
    session_id: int,
    source: Path,
    group_id: int,
    threshold: float,
    single: bool,
    r2_key: str | None = None,
    force: bool = False,
):
    """Run the processing pipeline in a background thread."""
    from jam_session_processor.metadata import extract_metadata
    from jam_session_processor.output import export_segments
    from jam_session_processor.splitter import detect_songs
    from jam_session_processor.storage import get_storage

    db = get_db()
    cfg = get_config()
    storage = get_storage()
    exported = []

    try:
        # If file was uploaded directly to R2, download it locally first
        if r2_key:
            db.update_job_progress(job_id, "Downloading from storage...")
            source.parent.mkdir(parents=True, exist_ok=True)
            storage.get(r2_key, source)

        db.update_job_progress(job_id, "Analyzing audio...")
        meta = extract_metadata(source)

        # Save duration for duplicate detection
        if meta.duration_seconds:
            db.update_session_duration(session_id, meta.duration_seconds)

        # Duration-based duplicate detection (for presigned uploads where
        # we couldn't check before the file was uploaded)
        if r2_key and not force and meta.duration_seconds:
            dup = db.find_duplicate_session(
                group_id, meta.duration_seconds, exclude_session_id=session_id
            )
            if dup:
                # Clean up: remove R2 file and session record
                storage.delete(r2_key)
                db.delete_session(session_id)
                db.fail_job(
                    job_id,
                    f"Possible duplicate: a session with the same duration"
                    f" already exists ('{dup.name}', {dup.date})",
                )
                return

        # Update session date from audio metadata if not already set from filename
        session_obj = db.get_session(session_id)
        if session_obj and not session_obj.date and meta.recording_date:
            db.update_session_date(session_id, meta.recording_date.strftime("%Y-%m-%d"))

        # Upload full recording to R2 early so session audio is streamable immediately
        source_ext = source.suffix
        new_source_rel = f"recordings/{session_id}{source_ext}"
        if storage.is_remote and not r2_key:
            # Only upload if the file isn't already in R2
            db.update_job_progress(job_id, "Uploading recording...")
            storage.put(new_source_rel, source)
            db.update_session_source_file(session_id, new_source_rel)
        elif r2_key:
            # File is already in R2 at r2_key — rename to canonical path if different
            if r2_key != new_source_rel:
                storage.rename(r2_key, new_source_rel)
            db.update_session_source_file(session_id, new_source_rel)

        if single:
            segments = [(0.0, meta.duration_seconds)]
        else:
            db.update_job_progress(job_id, "Detecting songs...")
            result = detect_songs(source, energy_threshold_db=threshold)
            segments = result.segments

        if segments:
            db.update_job_progress(job_id, "Exporting tracks...")
            output_dir = cfg.output_dir_for_session(session_id)
            exported = export_segments(
                source,
                segments,
                output_dir,
            )
            for i, ((start, end), audio_path) in enumerate(zip(segments, exported), start=1):
                db.update_job_progress(job_id, f"Saving track {i} of {len(segments)}...")
                rel_path = cfg.make_relative(audio_path.resolve())
                db.create_track(
                    session_id,
                    track_number=i,
                    start_sec=start,
                    end_sec=end,
                    audio_path=rel_path,
                )
                if storage.is_remote:
                    storage.put(rel_path, audio_path.resolve())

        db.complete_job(job_id, session_id)
        _tag_after_processing(session_id)
    except Exception as e:
        logger.exception("Background upload processing failed")
        db.fail_job(job_id, str(e))
    finally:
        if storage.is_remote:
            for audio_path in exported:
                audio_path.resolve().unlink(missing_ok=True)
            source.unlink(missing_ok=True)


def _resolve_upload_group(request: Request, group_id_param: int | None) -> int:
    """Resolve and validate group_id for upload endpoints."""
    db = get_db()
    if request.state.auth_type == "api_key":
        if group_id_param is None:
            raise HTTPException(
                status_code=400,
                detail="group_id required for API key uploads",
            )
        if not db.get_group(group_id_param):
            raise HTTPException(status_code=400, detail="Group not found")
        return group_id_param

    group_ids = request.state.group_ids
    if len(group_ids) == 1:
        return group_ids[0]
    if group_id_param is None:
        raise HTTPException(
            status_code=400,
            detail="group_id required when user belongs to multiple groups",
        )
    if group_id_param not in group_ids:
        raise HTTPException(status_code=400, detail="Not a member of that group")
    return group_id_param


@app.post("/api/sessions/upload/init", response_model=UploadInitResponse, status_code=200)
def upload_init(req: UploadInitRequest, request: Request):
    """Initialize an upload: create session + job, return presigned PUT URL if remote."""
    from jam_session_processor.metadata import parse_date_from_filename
    from jam_session_processor.storage import get_storage

    _require_role(request, "admin")
    group_id = _resolve_upload_group(request, req.group_id)

    # Validate extension
    ext = Path(req.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    db = get_db()
    cfg = get_config()
    storage = get_storage()

    # Create session record using original filename for name derivation
    filename_date = parse_date_from_filename(Path(req.filename).stem)
    date_str = filename_date.strftime("%Y-%m-%d") if filename_date else None
    user_id = request.state.user.id if request.state.user else None
    session_id = db.create_session(
        req.filename, group_id=group_id, date=date_str, created_by=user_id
    )

    # Update source_file to canonical path using session_id
    source_rel = f"recordings/{session_id}{ext}"
    db.update_session_source_file(session_id, source_rel)

    # Check for filename-based duplicates
    source_name = Path(req.filename).name
    existing = db.find_session_by_source(cfg.make_relative(cfg.input_dir / source_name), group_id)
    if existing:
        db.delete_session(session_id)
        raise HTTPException(
            status_code=409,
            detail=f"A session with the filename '{source_name}' already exists",
        )

    # Create job
    job_id = uuid4().hex[:16]
    job = db.create_job(job_id, group_id, session_id=session_id)

    # Generate presigned URL if remote storage
    upload_url = None
    r2_key = None
    if storage.is_remote:
        content_types = {
            ".m4a": "audio/mp4",
            ".wav": "audio/wav",
            ".mp3": "audio/mpeg",
            ".flac": "audio/flac",
            ".ogg": "audio/ogg",
        }
        content_type = content_types.get(ext, "application/octet-stream")
        r2_key = source_rel
        upload_url = storage.presigned_put_url(r2_key, content_type)

    db.update_job_progress(job_id, "Waiting for upload...")
    # Set status back to pending (update_job_progress sets it to processing)
    db.update_job_status(job_id, "pending")

    job = db.get_job(job_id)
    return UploadInitResponse(
        upload_url=upload_url,
        r2_key=r2_key,
        job=JobResponse(
            id=job.id,
            type=job.type,
            group_id=job.group_id,
            status=job.status,
            progress=job.progress,
            session_id=job.session_id,
            error=job.error,
        ),
        session_id=session_id,
    )


@app.post("/api/sessions/upload/complete", response_model=JobResponse, status_code=202)
async def upload_complete(req: UploadCompleteRequest, request: Request):
    """Signal that a presigned upload to R2 is complete. Starts background processing."""
    _require_role(request, "admin")

    db = get_db()
    job = db.get_job(req.job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if job.status != "pending":
        raise HTTPException(status_code=400, detail=f"Job is not pending (status: {job.status})")

    session = db.get_session(req.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    _require_group_access(request, session.group_id)

    from jam_session_processor.storage import get_storage

    storage = get_storage()
    r2_key = session.source_file
    if not storage.exists(r2_key):
        raise HTTPException(status_code=400, detail="File not found in storage")

    cfg = get_config()
    source = cfg.resolve_path(r2_key)
    threshold = req.threshold if req.threshold is not None else -20.0
    single = req.single
    force = req.force

    if request.state.user:
        db.log_activity(request.state.user.id, session.group_id, "upload", session.source_file)

    loop = asyncio.get_event_loop()
    loop.run_in_executor(
        None,
        _process_upload,
        job.id,
        session.id,
        source,
        session.group_id,
        threshold,
        single,
        r2_key,
        force,
    )

    return JobResponse(
        id=job.id,
        type=job.type,
        group_id=job.group_id,
        status="processing",
        progress="Starting...",
        session_id=job.session_id,
        error=job.error,
    )


@app.post("/api/sessions/upload", response_model=JobResponse, status_code=202)
async def upload_session(request: Request, file: UploadFile):
    """Upload an audio file and start background processing. Returns a job to poll."""
    _require_role(request, "admin")

    # Determine group_id
    if request.state.auth_type == "api_key":
        # API key uploads must specify group_id as a query param or form field
        group_id_str = request.query_params.get("group_id")
        if not group_id_str:
            raise HTTPException(
                status_code=400,
                detail="group_id query parameter required for API key uploads",
            )
        try:
            group_id = int(group_id_str)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid group_id")
        db = get_db()
        if not db.get_group(group_id):
            raise HTTPException(status_code=400, detail="Group not found")
    else:
        # Cookie auth — auto-assign if 1 group, otherwise require group_id
        group_ids = request.state.group_ids
        if len(group_ids) == 1:
            group_id = group_ids[0]
        else:
            group_id_str = request.query_params.get("group_id")
            if not group_id_str:
                raise HTTPException(
                    status_code=400,
                    detail="group_id required when user belongs to multiple groups",
                )
            try:
                group_id = int(group_id_str)
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid group_id")
            if group_id not in group_ids:
                raise HTTPException(status_code=400, detail="Not a member of that group")

    # Validate extension
    ext = Path(file.filename).suffix.lower() if file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    cfg = get_config()
    max_bytes = cfg.max_upload_mb * 1024 * 1024

    # Early rejection if Content-Length header is present and too large
    if file.size is not None and file.size > max_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum upload size is {cfg.max_upload_mb} MB.",
        )

    # Save to input directory (strip directory components to prevent path traversal)
    safe_filename = Path(file.filename).name if file.filename else "upload"
    cfg.input_dir.mkdir(parents=True, exist_ok=True)
    dest = cfg.input_dir / safe_filename
    if dest.exists():
        raise HTTPException(
            status_code=409,
            detail=f"File '{safe_filename}' already exists in input/",
        )

    # Stream file to disk in chunks, enforcing size limit
    try:
        bytes_written = 0
        chunk_size = 1024 * 1024  # 1 MB
        with open(dest, "wb") as f:
            while chunk := await file.read(chunk_size):
                bytes_written += len(chunk)
                if bytes_written > max_bytes:
                    f.close()
                    dest.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=413,
                        detail=f"File too large. Maximum upload size is {cfg.max_upload_mb} MB.",
                    )
                f.write(chunk)
    except HTTPException:
        raise
    except Exception as e:
        dest.unlink(missing_ok=True)
        raise HTTPException(status_code=500, detail=f"Failed to save file: {e}")

    source = dest.resolve()

    # Parse optional threshold and single-song mode
    threshold_str = request.query_params.get("threshold")
    threshold = float(threshold_str) if threshold_str else -20.0
    single = request.query_params.get("single") == "true"
    force = request.query_params.get("force") == "true"

    # Create session and job synchronously so the page is immediately viewable
    from jam_session_processor.metadata import extract_metadata, parse_date_from_filename

    db = get_db()
    cfg = get_config()
    source_rel = cfg.make_relative(source)

    existing = db.find_session_by_source(source_rel, group_id)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"A session with the filename '{safe_filename}' already exists",
        )

    # Duration-based duplicate detection
    if not force:
        try:
            meta_check = extract_metadata(source)
            if meta_check.duration_seconds:
                dup = db.find_duplicate_session(group_id, meta_check.duration_seconds)
                if dup:
                    dest.unlink(missing_ok=True)
                    raise HTTPException(
                        status_code=409,
                        detail=(
                            f"Possible duplicate: a session with the same duration"
                            f" already exists ('{dup.name}', {dup.date})"
                        ),
                    )
        except HTTPException:
            raise
        except Exception:
            pass  # If metadata extraction fails here, let the background job handle it

    filename_date = parse_date_from_filename(source.stem)
    date_str = filename_date.strftime("%Y-%m-%d") if filename_date else None
    upload_user_id = request.state.user.id if request.state.user else None
    session_id = db.create_session(
        source_rel, group_id=group_id, date=date_str, created_by=upload_user_id
    )

    job_id = uuid4().hex[:16]
    job = db.create_job(job_id, group_id, session_id=session_id)

    if request.state.user:
        db.log_activity(request.state.user.id, group_id, "upload", safe_filename)

    loop = asyncio.get_event_loop()
    loop.run_in_executor(
        None, _process_upload, job_id, session_id, source, group_id, threshold, single
    )

    return JobResponse(
        id=job.id,
        type=job.type,
        group_id=job.group_id,
        status=job.status,
        progress=job.progress,
        session_id=job.session_id,
        error=job.error,
    )


# --- Google Drive import ---


class DriveFolderRequest(BaseModel):
    url: Annotated[str, Field(max_length=500)]
    group_id: int | None = None


class DriveFolderGroupRequest(BaseModel):
    group_id: int | None = None


class DriveImportRequest(BaseModel):
    file_id: ShortStr
    group_id: int
    name: NameStr | None = None
    date: ShortStr | None = None
    single: bool = False
    force: bool = False
    threshold: float | None = None


class DriveSkipRequest(BaseModel):
    file_id: ShortStr
    file_name: NameStr = ""
    skipped: bool = True


def _drive_client_or_503():
    from jam_session_processor.gdrive import get_drive_client

    client = get_drive_client()
    if not client:
        raise HTTPException(
            status_code=503,
            detail="Google Drive import is not set up (JAM_GOOGLE_SERVICE_ACCOUNT is missing)",
        )
    return client


def _drive_http_error(e) -> HTTPException:
    if e.status in (403, 404):
        email = _drive_client_or_503().email
        return HTTPException(
            status_code=400,
            detail=f"JamJar can't see that in Google Drive. Share it with {email} and try again.",
        )
    return HTTPException(status_code=502, detail=str(e))


def _visible_drive_folder(request: Request, folder_pk: int) -> dict:
    folder = get_db().get_drive_folder(folder_pk)
    if not folder:
        raise HTTPException(status_code=404, detail="Folder not found")
    group_ids = _get_group_ids(request)
    if group_ids is not None and folder["group_id"] is not None:
        if folder["group_id"] not in group_ids:
            raise HTTPException(status_code=404, detail="Folder not found")
    return folder


@app.get("/api/drive")
def drive_info(request: Request):
    """Whether Drive import is configured, and the address to share folders with."""
    _require_role(request, "admin")
    from jam_session_processor.gdrive import get_drive_client

    client = get_drive_client()
    return {
        "configured": client is not None,
        "service_account_email": client.email if client else None,
    }


@app.get("/api/drive/folders")
def list_drive_folders(request: Request):
    _require_role(request, "admin")
    group_ids = _get_group_ids(request)
    folders = get_db().list_drive_folders()
    if group_ids is not None:
        folders = [f for f in folders if f["group_id"] is None or f["group_id"] in group_ids]
    return folders


@app.post("/api/drive/folders")
def add_drive_folder(req: DriveFolderRequest, request: Request):
    """Link a Drive folder (shared with the service account) so its recordings can be imported."""
    _require_role(request, "admin")
    from jam_session_processor.gdrive import FOLDER_MIME, DriveError, parse_folder_id

    client = _drive_client_or_503()
    folder_id = parse_folder_id(req.url)
    if not folder_id:
        raise HTTPException(
            status_code=400, detail="That doesn't look like a Google Drive folder link"
        )
    if req.group_id is not None:
        _require_group_access(request, req.group_id)
    db = get_db()
    if any(f["folder_id"] == folder_id for f in db.list_drive_folders()):
        raise HTTPException(status_code=409, detail="That folder is already linked")
    try:
        meta = client.get_file(folder_id)
    except DriveError as e:
        raise _drive_http_error(e)
    if meta.get("mimeType") != FOLDER_MIME:
        raise HTTPException(status_code=400, detail="That link is a file, not a folder")
    user_id = request.state.user.id if request.state.user else None
    pk = db.add_drive_folder(folder_id, meta.get("name", ""), req.group_id, user_id)
    return db.get_drive_folder(pk)


@app.put("/api/drive/folders/{folder_pk}/group")
def set_drive_folder_group(folder_pk: int, req: DriveFolderGroupRequest, request: Request):
    _require_role(request, "admin")
    _visible_drive_folder(request, folder_pk)
    if req.group_id is not None:
        _require_group_access(request, req.group_id)
    db = get_db()
    db.update_drive_folder_group(folder_pk, req.group_id)
    return db.get_drive_folder(folder_pk)


@app.delete("/api/drive/folders/{folder_pk}")
def remove_drive_folder(folder_pk: int, request: Request):
    """Unlink a folder. Recordings already imported from it are kept."""
    _require_role(request, "admin")
    _visible_drive_folder(request, folder_pk)
    get_db().delete_drive_folder(folder_pk)
    return {"ok": True}


@app.get("/api/drive/folders/{folder_pk}/files")
def list_drive_folder_files(folder_pk: int, request: Request):
    """Audio files in a linked folder (and its subfolders), newest first, with import status."""
    _require_role(request, "admin")
    from jam_session_processor.gdrive import DriveError
    from jam_session_processor.metadata import parse_date_from_filename

    folder = _visible_drive_folder(request, folder_pk)
    client = _drive_client_or_503()
    try:
        files = client.list_audio(folder["folder_id"])
    except DriveError as e:
        raise _drive_http_error(e)
    db = get_db()
    imports = db.get_drive_imports([f["id"] for f in files])
    group_ids = _get_group_ids(request)
    out = []
    for f in files:
        imp = imports.get(f["id"])
        # Hide which recording another band's import became
        if imp and group_ids is not None and imp["group_id"] not in group_ids:
            imp = {**imp, "session_id": None, "session_name": None}
        parsed = parse_date_from_filename(Path(f["name"]).stem)
        out.append(
            {
                "id": f["id"],
                "name": f["name"],
                "path": f["path"],
                "size": f["size"],
                "created_time": f.get("createdTime"),
                "modified_time": f.get("modifiedTime"),
                "suggested_date": parsed.strftime("%Y-%m-%d") if parsed else None,
                "status": imp["status"] if imp else "new",
                "session_id": imp["session_id"] if imp else None,
                "session_name": imp["session_name"] if imp else None,
            }
        )
    out.sort(key=lambda f: f["created_time"] or "", reverse=True)
    return out


@_tracked_job
def _import_from_drive(
    job_id: str,
    session_id: int,
    file_id: str,
    file_name: str,
    dest: Path,
    group_id: int,
    threshold: float,
    single: bool,
    force: bool,
    user_id: int | None,
):
    """Background job: download a Drive file, check for duplicates, then process it."""
    from jam_session_processor.gdrive import get_drive_client
    from jam_session_processor.metadata import extract_metadata

    db = get_db()
    try:
        client = get_drive_client()
        if not client:
            raise RuntimeError("Google Drive import is not set up")
        db.update_job_progress(job_id, "Downloading from Google Drive...")
        last = [0]

        def progress(n: int):
            if n - last[0] >= 10 * 1024 * 1024:
                last[0] = n
                db.update_job_progress(
                    job_id, f"Downloading from Google Drive ({n // 1_000_000} MB)..."
                )

        client.download(file_id, dest, on_progress=progress)
        if not force:
            meta = extract_metadata(dest)
            dup = (
                db.find_duplicate_session(
                    group_id, meta.duration_seconds, exclude_session_id=session_id
                )
                if meta.duration_seconds
                else None
            )
            if dup:
                dest.unlink(missing_ok=True)
                db.delete_session(session_id)
                db.set_drive_import(file_id, "duplicate", file_name, dup.id, group_id, user_id)
                db.fail_job(
                    job_id,
                    "Already in JamJar: a recording with the same length exists"
                    f" ('{dup.name}', {dup.date})",
                )
                return
    except Exception as e:
        logger.exception("Drive import failed for %s", file_id)
        dest.unlink(missing_ok=True)
        db.delete_session(session_id)
        db.clear_drive_import(file_id)
        db.fail_job(job_id, f"Google Drive download failed: {e}")
        return
    _process_upload(job_id, session_id, dest, group_id, threshold, single)


@app.post("/api/drive/import", response_model=JobResponse, status_code=202)
async def import_from_drive(req: DriveImportRequest, request: Request):
    """Import one Drive file as a recording. Returns a job to poll, like an upload."""
    _require_role(request, "admin")
    _require_group_access(request, req.group_id)
    from jam_session_processor.gdrive import DriveError
    from jam_session_processor.metadata import parse_date_from_filename

    client = _drive_client_or_503()
    db = get_db()
    if not db.get_group(req.group_id):
        raise HTTPException(status_code=400, detail="Group not found")
    existing = db.get_drive_imports([req.file_id]).get(req.file_id)
    if existing and existing["status"] == "imported" and existing["session_id"] and not req.force:
        raise HTTPException(status_code=409, detail="That file has already been imported")
    try:
        meta = await asyncio.get_event_loop().run_in_executor(None, client.get_file, req.file_id)
    except DriveError as e:
        raise _drive_http_error(e)
    name = Path(meta.get("name") or "recording").name
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type '{ext}'")
    cfg = get_config()
    size = int(meta.get("size") or 0)
    if size > cfg.max_upload_mb * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"File is larger than {cfg.max_upload_mb} MB")

    dest = cfg.input_dir / "drive" / req.file_id / name
    source_rel = cfg.make_relative(dest)
    if req.date:
        date_str = req.date
    else:
        parsed = parse_date_from_filename(Path(name).stem)
        date_str = (
            parsed.strftime("%Y-%m-%d") if parsed else (meta.get("createdTime") or "")[:10] or None
        )
    user_id = request.state.user.id if request.state.user else None
    session_id = db.create_session(
        source_rel, group_id=req.group_id, date=date_str, created_by=user_id
    )
    if req.name:
        db.update_session_name(session_id, req.name, updated_by=user_id)
    db.set_drive_import(req.file_id, "imported", name, session_id, req.group_id, user_id)
    job_id = uuid4().hex[:16]
    job = db.create_job(job_id, req.group_id, session_id=session_id)
    if user_id:
        db.log_activity(user_id, req.group_id, "upload", f"Google Drive: {name}")

    threshold = req.threshold if req.threshold is not None else -20.0
    asyncio.get_event_loop().run_in_executor(
        None,
        _import_from_drive,
        job_id,
        session_id,
        req.file_id,
        name,
        dest,
        req.group_id,
        threshold,
        req.single,
        req.force,
        user_id,
    )
    return JobResponse(
        id=job.id,
        type=job.type,
        group_id=job.group_id,
        status=job.status,
        progress=job.progress,
        session_id=job.session_id,
        error=job.error,
    )


@app.post("/api/drive/skip")
def skip_drive_file(req: DriveSkipRequest, request: Request):
    """Hide (or un-hide) a Drive file from the import list without importing it."""
    _require_role(request, "admin")
    db = get_db()
    existing = db.get_drive_imports([req.file_id]).get(req.file_id)
    if existing and existing["status"] == "imported":
        raise HTTPException(status_code=409, detail="That file has already been imported")
    if req.skipped:
        user_id = request.state.user.id if request.state.user else None
        db.set_drive_import(req.file_id, "skipped", req.file_name, created_by=user_id)
    else:
        db.clear_drive_import(req.file_id)
    return {"ok": True}


# --- Track endpoints ---


def _get_track_with_access(db: Database, track_id: int, request: Request):
    """Get a track and verify group access through its session."""
    track = db.get_track(track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    session = db.get_session(track.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Track not found")
    _require_group_access(request, session.group_id)
    return track, session


@app.post("/api/tracks/{track_id}/tag", response_model=TrackResponse)
def tag_track(track_id: int, req: TagRequest, request: Request):
    db = get_db()
    track, session = _get_track_with_access(db, track_id, request)
    _require_role(request, "editor")
    user_id = request.state.user.id if request.state.user else None
    db.tag_track(
        track_id,
        req.song_name,
        session.group_id,
        user_id=user_id,
        visible_group_ids=_get_group_ids(request),
    )
    if request.state.user:
        db.log_activity(request.state.user.id, session.group_id, "tag", req.song_name)
    track = db.get_track(track_id)
    return _track_response(track)


@app.delete("/api/tracks/{track_id}/tag")
def untag_track(track_id: int, request: Request):
    db = get_db()
    _get_track_with_access(db, track_id, request)
    _require_role(request, "editor")
    db.untag_track(track_id)
    return {"ok": True}


@app.put("/api/tracks/{track_id}/notes", response_model=TrackResponse)
def update_track_notes(track_id: int, req: NotesRequest, request: Request):
    db = get_db()
    _get_track_with_access(db, track_id, request)
    _require_role(request, "editor")
    db.update_track_notes(track_id, req.notes)
    track = db.get_track(track_id)
    return _track_response(track)


@app.post("/api/tracks/{track_id}/merge", response_model=list[TrackResponse])
def merge_tracks_endpoint(track_id: int, req: MergeRequest, request: Request):
    from jam_session_processor.track_ops import merge_tracks

    db = get_db()
    _get_track_with_access(db, track_id, request)
    _require_role(request, "admin")
    try:
        tracks = merge_tracks(db, track_id, req.other_track_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Merge failed")
        raise HTTPException(status_code=500, detail=f"Merge failed: {e}")
    return [_track_response(t) for t in tracks]


@app.post("/api/tracks/{track_id}/split", response_model=list[TrackResponse])
def split_track_endpoint(track_id: int, req: SplitRequest, request: Request):
    from jam_session_processor.track_ops import split_track

    db = get_db()
    _get_track_with_access(db, track_id, request)
    _require_role(request, "admin")
    try:
        tracks = split_track(db, track_id, req.split_at_sec)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Split failed")
    return [_track_response(t) for t in tracks]


@app.put("/api/tracks/{track_id}/trim", response_model=TrackResponse)
def trim_track_endpoint(track_id: int, req: TrimRequest, request: Request):
    from jam_session_processor.track_ops import trim_track

    db = get_db()
    _get_track_with_access(db, track_id, request)
    _require_role(request, "admin")
    try:
        track = trim_track(db, track_id, start_delta=req.start_delta, end_delta=req.end_delta)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Trim failed")
        raise HTTPException(status_code=500, detail="Trim failed")
    return _track_response(track)


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
        filename = filename.replace('"', "")

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


# --- Share link endpoints ---


@app.post("/api/tracks/{track_id}/share")
def create_share_link(track_id: int, request: Request):
    db = get_db()
    track, session = _get_track_with_access(db, track_id, request)
    user = request.state.user
    link = db.create_share_link(track_id, user.id if user else None)
    return {"token": link.token, "url": f"/share/{link.token}"}


@app.delete("/api/tracks/{track_id}/share")
def revoke_share_link(track_id: int, request: Request):
    db = get_db()
    track, session = _get_track_with_access(db, track_id, request)
    link = db.get_share_link_by_track(track_id)
    if not link:
        raise HTTPException(status_code=404, detail="No share link exists for this track")
    # Allow the link creator or any admin/superadmin
    user = request.state.user
    if user and link.created_by != user.id:
        if user.role not in ("admin", "superadmin"):
            raise HTTPException(
                status_code=403,
                detail="Only the link creator or an admin can revoke",
            )
    db.delete_share_link(track_id)
    return {"ok": True}


@app.get("/api/share/{token}/audio")
def public_share_audio(token: str, download: int = 0):
    from jam_session_processor.storage import get_storage

    db = get_db()
    link = db.get_share_link_by_token(token)
    if not link:
        raise HTTPException(status_code=404, detail="Share link not found")

    track = db.get_track(link.track_id)
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
        filename = filename.replace('"', "")

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


@app.get("/share/{token}")
def share_landing_page(token: str):
    db = get_db()
    link = db.get_share_link_by_token(token)
    if not link:
        raise HTTPException(status_code=404, detail="Share link not found")

    track = db.get_track(link.track_id)
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

    title = html.escape(track.song_name or f"Track {track.track_number}")
    session_name = html.escape(session_name)
    audio_url = f"/api/share/{token}/audio"
    download_url = f"/api/share/{token}/audio?download=1"

    page = f"""<!DOCTYPE html>
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
        .actions {{
            display: flex;
            gap: 0.5rem;
        }}
        .btn {{
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
        .btn:hover {{ background: #374151; color: #f9fafb; }}
        .btn.copied {{ background: #065f46; color: #6ee7b7; }}
    </style>
</head>
<body>
    <div class="card">
        <h1 class="title">{title}</h1>
        <p class="meta">{session_name}{(" &middot; " + date_display) if date_display else ""}</p>
        <audio controls preload="metadata" src="{audio_url}"></audio>
        <div class="actions">
            <a class="btn" href="{download_url}">
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24"
                     stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round"
                          d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2
                             M7 10l5 5 5-5M12 15V3"/>
                </svg>
                Download
            </a>
            <button class="btn" id="share-btn" onclick="shareTrack()">
                <svg width="16" height="16" fill="none" viewBox="0 0 24 24"
                     stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round"
                          stroke-linejoin="round"
                          d="M8.684 13.342C8.886 12.938
                             9 12.482 9 12c0-.482-.114
                             -.938-.316-1.342m0 2.684a3
                             3 0 110-2.684m0 2.684l6.632
                             3.316m-6.632-6l6.632-3.316
                             m0 0a3 3 0 105.367-2.684
                             3 3 0 00-5.367 2.684zm0
                             9.316a3 3 0 105.368 2.684
                             3 3 0 00-5.368-2.684z"/>
                </svg>
                <span id="share-label">Share</span>
            </button>
        </div>
        <a href="/" style="display: inline-flex; align-items: center; gap: 0.4rem;
            margin-top: 1.5rem; font-size: 0.8125rem; color: #6b7280;
            text-decoration: none;">
            <img src="/logo.png" alt="" style="width: 1rem; height: 1rem; border-radius: 3px;">
            Shared with <span style="color: #34d399;">JamJar</span>
        </a>
        <svg id="check-icon" style="display:none"
             width="16" height="16" fill="none"
             viewBox="0 0 24 24" stroke="currentColor"
             stroke-width="2">
            <path stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M5 13l4 4L19 7"/>
        </svg>
        <svg id="share-icon" style="display:none"
             width="16" height="16" fill="none"
             viewBox="0 0 24 24" stroke="currentColor"
             stroke-width="2">
            <path stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M8.684 13.342C8.886 12.938 9
                     12.482 9 12c0-.482-.114-.938
                     -.316-1.342m0 2.684a3 3 0
                     110-2.684m0 2.684l6.632 3.316
                     m-6.632-6l6.632-3.316m0 0a3 3
                     0 105.367-2.684 3 3 0
                     00-5.367 2.684zm0 9.316a3 3 0
                     105.368 2.684 3 3 0
                     00-5.368-2.684z"/>
        </svg>
        <script>
        function shareTrack() {{
            var btn = document.getElementById('share-btn');
            var label = document.getElementById('share-label');
            var iconSlot = btn.querySelector('svg');
            if (navigator.share) {{
                navigator.share({{ title: '{title}', url: window.location.href }});
            }} else {{
                navigator.clipboard.writeText(window.location.href).then(function() {{
                    btn.classList.add('copied');
                    label.textContent = 'Copied!';
                    iconSlot.replaceWith(document.getElementById('check-icon').cloneNode(true));
                    btn.querySelector('svg').style.display = '';
                    setTimeout(function() {{
                        btn.classList.remove('copied');
                        label.textContent = 'Share';
                        btn.querySelector('svg').replaceWith(document.getElementById('share-icon').cloneNode(true));
                        btn.querySelector('svg').style.display = '';
                    }}, 2000);
                }});
            }}
        }}
        </script>
    </div>
</body>
</html>"""
    return HTMLResponse(content=page)


# --- Song endpoints ---


def _get_song_with_access(db: Database, song_id: int, request: Request):
    """Get a song the caller can see (one of their groups plays it). Take counts
    are limited to the caller's groups."""
    group_ids = _get_group_ids(request)
    song = db.get_song(song_id, group_ids)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    if group_ids is not None:
        linked = {g["id"] for g in db.get_song_groups(song_id)}
        if not linked & set(group_ids):
            raise HTTPException(status_code=404, detail="Song not found")
    return song


@app.get("/api/songs", response_model=list[SongResponse])
def list_songs(request: Request, group_id: int | None = None, summary: bool = False):
    """All songs the caller can see. `summary=true` leaves out the chart text and
    written history (the bulk of the payload) for list views; `has_sheet` still says
    whether a chart exists."""
    db = get_db()
    group_ids = _get_group_ids(request)
    if group_id is not None:
        if group_ids is not None and group_id not in group_ids:
            raise HTTPException(status_code=403, detail="No access to this group")
        group_ids = [group_id]
    activity = db.get_song_activity(request.state.user.id) if request.state.user else {}
    out = []
    for s in db.list_songs(group_ids):
        r = _song_response(s, request, activity)
        if summary:
            r.sheet = ""
            r.tab = ""
            r.background = None
        out.append(r)
    return out


@app.get("/api/songs/search")
def search_song_lyrics(request: Request, q: str = ""):
    """Songs whose chart/lyrics contain `q` (case-insensitive), with the first matching line."""
    q = q.strip().lower()
    if len(q) < 2:
        return []
    group_ids = _get_group_ids(request)
    out = []
    for s in get_db().list_songs(group_ids):
        for line in (s.sheet or "").split("\n"):
            if q in line.lower():
                out.append({"id": s.id, "line": line.strip()[:200]})
                break
    return out


class CreateSongRequest(BaseModel):
    name: NameStr
    group_id: int
    artist: NameStr = ""


@app.post("/api/songs", response_model=SongResponse)
def create_song(req: CreateSongRequest, request: Request):
    db = get_db()
    _require_group_access(request, req.group_id)
    _require_role(request, "editor")
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Song name cannot be empty")
    if db.song_exists_in_group(name, req.group_id):
        raise HTTPException(status_code=409, detail="Song already exists in this group")
    user_id = request.state.user.id if request.state.user else None
    song_id = db._get_or_create_song(
        name, req.group_id, created_by=user_id, visible_group_ids=_get_group_ids(request)
    )
    song = db.get_song(song_id)
    artist = req.artist.strip()
    if artist and not song.artist:
        db.update_song_details(song_id, song.sheet, song.notes, artist, updated_by=user_id)
    song = db.get_song(song_id, _get_group_ids(request))
    return _song_response(song, request)


@app.get("/api/songs/{song_id}", response_model=SongResponse)
def get_song(song_id: int, request: Request):
    db = get_db()
    song = _get_song_with_access(db, song_id, request)
    return _song_response(song, request)


@app.put("/api/songs/{song_id}/details", response_model=SongResponse)
def update_song_details(song_id: int, req: SongDetailsRequest, request: Request):
    db = get_db()
    song = _get_song_with_access(db, song_id, request)
    _require_role(request, "editor")
    user_id = request.state.user.id if request.state.user else None
    db.update_song_details(song_id, req.sheet, req.notes, req.artist, updated_by=user_id)
    if request.state.user:
        db.log_activity(request.state.user.id, song.group_id, "song_edit", song.name)
    song = db.get_song(song_id, _get_group_ids(request))
    return _song_response(song, request)


@app.post("/api/songs/{song_id}/fetch-lyrics")
def fetch_lyrics(song_id: int, request: Request):
    db = get_db()
    song = _get_song_with_access(db, song_id, request)
    _require_role(request, "editor")
    if not song.artist:
        raise HTTPException(status_code=400, detail="Song has no artist set")
    try:
        resp = http_requests.get(
            "https://lrclib.net/api/search",
            params={"track_name": song.name, "artist_name": song.artist},
            timeout=10,
        )
    except http_requests.Timeout:
        raise HTTPException(status_code=502, detail="Lyrics service timed out")
    except http_requests.RequestException:
        raise HTTPException(status_code=502, detail="Failed to reach lyrics service")
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail="Lyrics service returned an error")
    results = resp.json()
    if not results:
        raise HTTPException(status_code=404, detail="Lyrics not found")
    # Pick the first result that has plain lyrics
    lyrics = ""
    for result in results:
        if result.get("plainLyrics"):
            lyrics = result["plainLyrics"]
            break
    if not lyrics:
        raise HTTPException(status_code=404, detail="Lyrics not found")
    # Append to existing sheet content
    # Exactly one blank line between the chart and the lyrics, however either ends
    new_sheet = (
        f"{song.sheet.rstrip()}\n\n{lyrics.strip()}" if song.sheet.strip() else lyrics.strip()
    )
    lyrics_user_id = request.state.user.id if request.state.user else None
    db.update_song_details(song.id, new_sheet, song.notes, song.artist, updated_by=lyrics_user_id)
    updated = db.get_song(song.id, _get_group_ids(request))
    return {"lyrics": lyrics, "song": _song_response(updated, request).model_dump()}


@app.delete("/api/songs/{song_id}")
def delete_song(song_id: int, request: Request):
    db = get_db()
    song = _get_song_with_access(db, song_id, request)
    _require_role(request, "admin")
    db.delete_song(song_id)
    if song.score_path:
        from jam_session_processor.storage import get_storage

        get_storage().delete(song.score_path)
    return {"ok": True}


@app.put("/api/songs/{song_id}/name", response_model=SongResponse)
def rename_song(song_id: int, req: NameRequest, request: Request):
    db = get_db()
    song = _get_song_with_access(db, song_id, request)
    _require_role(request, "editor")
    user_id = request.state.user.id if request.state.user else None
    try:
        db.rename_song(song_id, req.name.strip(), updated_by=user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if request.state.user:
        db.log_activity(request.state.user.id, song.group_id, "song_edit", req.name.strip())
    song = db.get_song(song_id, _get_group_ids(request))
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    return _song_response(song, request)


@app.put("/api/songs/{song_id}/group", response_model=SongResponse)
def update_song_group(song_id: int, req: GroupRequest, request: Request):
    db = get_db()
    _get_song_with_access(db, song_id, request)
    _require_group_access(request, req.group_id)
    _require_role(request, "admin")
    if not db.get_group(req.group_id):
        raise HTTPException(status_code=400, detail="Group not found")
    try:
        db.update_song_group(song_id, req.group_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    song = db.get_song(song_id, _get_group_ids(request))
    return _song_response(song, request)


@app.get("/api/songs/{song_id}/tracks", response_model=list[SongTrackResponse])
def get_song_tracks(song_id: int, request: Request):
    db = get_db()
    _get_song_with_access(db, song_id, request)
    rows = db.get_tracks_for_song(song_id, _get_group_ids(request))
    return [_song_track_response(r) for r in rows]


class SongGroupNotesRequest(BaseModel):
    notes: NotesStr


@app.post("/api/songs/{song_id}/groups", response_model=SongResponse)
def link_song_group(song_id: int, req: GroupRequest, request: Request):
    """Mark that another of the caller's groups also plays this song."""
    db = get_db()
    _get_song_with_access(db, song_id, request)
    _require_group_access(request, req.group_id)
    _require_role(request, "editor")
    if not db.get_group(req.group_id):
        raise HTTPException(status_code=400, detail="Group not found")
    try:
        db.link_song_to_group(song_id, req.group_id)
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))
    return _song_response(db.get_song(song_id, _get_group_ids(request)), request)


@app.delete("/api/songs/{song_id}/groups/{group_id}", response_model=SongResponse)
def unlink_song_group(song_id: int, group_id: int, request: Request):
    """Stop listing a song for a group (its recorded takes are kept)."""
    db = get_db()
    _get_song_with_access(db, song_id, request)
    _require_group_access(request, group_id)
    _require_role(request, "admin")
    try:
        db.unlink_song_from_group(song_id, group_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _song_response(db.get_song(song_id, _get_group_ids(request)), request)


@app.put("/api/songs/{song_id}/groups/{group_id}/notes", response_model=SongResponse)
def set_song_group_notes(song_id: int, group_id: int, req: SongGroupNotesRequest, request: Request):
    """Notes about how one group plays a song (key, arrangement, ...)."""
    db = get_db()
    _get_song_with_access(db, song_id, request)
    _require_group_access(request, group_id)
    _require_role(request, "editor")
    if group_id not in {g["id"] for g in db.get_song_groups(song_id)}:
        raise HTTPException(status_code=404, detail="That group doesn't play this song")
    db.set_group_song_notes(song_id, group_id, req.notes.strip())
    return _song_response(db.get_song(song_id, _get_group_ids(request)), request)


SongLinkKind = Literal["lesson", "backing_track", "other"]


class AddSongLinkRequest(BaseModel):
    url: Annotated[str, Field(max_length=500)]
    kind: SongLinkKind = "lesson"
    title: NameStr = ""


def _youtube_title(url: str) -> str:
    """Best-effort video title via YouTube's oEmbed endpoint ("" on any failure)."""
    host = (urlparse(url).hostname or "").lower()
    if not (host == "youtu.be" or host.endswith("youtube.com")):
        return ""
    try:
        resp = http_requests.get(
            "https://www.youtube.com/oembed",
            params={"url": url, "format": "json"},
            timeout=5,
        )
        if resp.status_code == 200:
            return str(resp.json().get("title", ""))[:200]
    except (http_requests.RequestException, ValueError):
        pass
    return ""


def _video_key(url: str) -> str:
    """What identifies a video across URL shapes: the YouTube id, else the URL."""
    parsed = urlparse(url.strip())
    host = (parsed.hostname or "").lower()
    for prefix in ("www.", "m.", "music."):
        host = host.removeprefix(prefix)
    video_id = ""
    if host == "youtu.be":
        video_id = parsed.path.strip("/").split("/")[0]
    elif host in ("youtube.com", "youtube-nocookie.com"):
        if parsed.path == "/watch":
            video_id = parse_qs(parsed.query).get("v", [""])[0]
        else:
            parts = parsed.path.strip("/").split("/")
            if len(parts) >= 2 and parts[0] in ("embed", "shorts", "live", "v"):
                video_id = parts[1]
    return f"yt:{video_id}" if video_id else url.strip()


@app.post("/api/songs/{song_id}/links", response_model=SongResponse)
def add_song_link(song_id: int, req: AddSongLinkRequest, request: Request):
    """Attach a reference video (how-to lesson, backing track) to a song."""
    db = get_db()
    _get_song_with_access(db, song_id, request)
    _require_role(request, "editor")
    url = req.url.strip()
    if urlparse(url).scheme not in ("http", "https") or not urlparse(url).netloc:
        raise HTTPException(status_code=400, detail="Enter a full http(s) link")
    key = _video_key(url)
    if db.is_video_flagged(song_id, key):
        # The curation routine (API key) must not bring back a video someone
        # marked as bad; a person adding it again overrides the flag.
        if request.state.auth_type == "api_key":
            raise HTTPException(
                status_code=409, detail="This video was marked as bad for this song"
            )
        db.clear_video_flags(song_id, key)
    title = req.title.strip() or _youtube_title(url)
    user_id = request.state.user.id if request.state.user else None
    db.add_song_link(song_id, req.kind, url, title, created_by=user_id)
    return _song_response(db.get_song(song_id, _get_group_ids(request)), request)


@app.delete("/api/songs/{song_id}/links/{link_id}", response_model=SongResponse)
def delete_song_link(song_id: int, link_id: int, request: Request):
    db = get_db()
    _get_song_with_access(db, song_id, request)
    _require_role(request, "editor")
    link = db.get_song_link(link_id)
    if not link or link["song_id"] != song_id:
        raise HTTPException(status_code=404, detail="Link not found")
    db.delete_song_link(link_id)
    return _song_response(db.get_song(song_id, _get_group_ids(request)), request)


VideoFlagReason = Literal["wrong_song", "wrong_instrument", "poor_quality", "unavailable", "other"]


class FlagSongLinkRequest(BaseModel):
    reason: VideoFlagReason = "other"


@app.post("/api/songs/{song_id}/links/{link_id}/flag", response_model=SongResponse)
def flag_song_link(song_id: int, link_id: int, req: FlagSongLinkRequest, request: Request):
    """Mark a video as bad: it leaves the song at once, and the library-curation
    routine looks for a replacement on its next run."""
    db = get_db()
    _get_song_with_access(db, song_id, request)
    _require_role(request, "editor")
    link = db.get_song_link(link_id)
    if not link or link["song_id"] != song_id:
        raise HTTPException(status_code=404, detail="Link not found")
    user_id = request.state.user.id if request.state.user else None
    db.flag_song_link(link_id, _video_key(link["url"]), req.reason, flagged_by=user_id)
    return _song_response(db.get_song(song_id, _get_group_ids(request)), request)


class SetSongTabRequest(BaseModel):
    tab: SheetStr


@app.put("/api/songs/{song_id}/tab", response_model=SongResponse)
def set_song_tab(song_id: int, req: SetSongTabRequest, request: Request):
    """Set (or clear, with an empty string) a song's guitar tab."""
    db = get_db()
    _get_song_with_access(db, song_id, request)
    _require_role(request, "editor")
    user_id = request.state.user.id if request.state.user else None
    db.set_song_tab(song_id, req.tab.strip("\n"), updated_by=user_id)
    return _song_response(db.get_song(song_id, _get_group_ids(request)), request)


class SetSongBackgroundRequest(BaseModel):
    text: TextStr
    sources: list[BackgroundSource] = Field(max_length=20)


_BG_MARKER = _re_mod.compile(r"\[(\d+)\]")


@app.put("/api/songs/{song_id}/background", response_model=SongResponse)
def set_song_background(song_id: int, req: SetSongBackgroundRequest, request: Request):
    """Set a song's "About" background: a short paragraph whose [n] markers cite
    sources[n-1]. Every marker must point at a source and every source must be an
    http(s) link."""
    db = get_db()
    _get_song_with_access(db, song_id, request)
    _require_role(request, "editor")
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Background text is empty")
    if not req.sources:
        raise HTTPException(status_code=400, detail="Add at least one source")
    for src in req.sources:
        parsed = urlparse(src.url)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise HTTPException(status_code=400, detail=f"Not a web link: {src.url}")
    markers = {int(m) for m in _BG_MARKER.findall(text)}
    if not markers:
        raise HTTPException(status_code=400, detail="Cite sources with [1], [2], ... markers")
    if max(markers) > len(req.sources) or min(markers) < 1:
        raise HTTPException(status_code=400, detail="A [n] marker has no matching source")
    db.set_song_background(song_id, text, json.dumps([src.model_dump() for src in req.sources]))
    return _song_response(db.get_song(song_id, _get_group_ids(request)), request)


@app.delete("/api/songs/{song_id}/background", response_model=SongResponse)
def clear_song_background(song_id: int, request: Request):
    db = get_db()
    _get_song_with_access(db, song_id, request)
    _require_role(request, "editor")
    db.set_song_background(song_id, "", "")
    return _song_response(db.get_song(song_id, _get_group_ids(request)), request)


class SongActivityRequest(BaseModel):
    event: Literal["opened", "performed"]


@app.post("/api/songs/{song_id}/activity", status_code=204)
def record_song_activity(song_id: int, req: SongActivityRequest, request: Request):
    """Record that the caller opened a song or performed it (Perform mode)."""
    db = get_db()
    _get_song_with_access(db, song_id, request)
    if request.state.user:  # API-key callers have no per-user activity
        db.record_song_activity(request.state.user.id, song_id, req.event)
    return Response(status_code=204)


class MergeSongsRequest(BaseModel):
    keep_id: int
    merge_id: int


@app.post("/api/songs/merge", response_model=SongResponse)
def merge_songs(req: MergeSongsRequest, request: Request):
    """Fold a duplicate song into another: takes, setlist entries and group links
    move to `keep_id`, which keeps its own chart/artist unless empty."""
    db = get_db()
    keep = _get_song_with_access(db, req.keep_id, request)
    merged = _get_song_with_access(db, req.merge_id, request)
    _require_role(request, "admin")
    try:
        db.merge_songs(req.keep_id, req.merge_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if keep.score_path and merged.score_path:
        # The kept song's score won; the merged song's file has no owner now
        from jam_session_processor.storage import get_storage

        get_storage().delete(merged.score_path)
    return _song_response(db.get_song(req.keep_id, _get_group_ids(request)), request)


# --- Song score (notated sheet music) endpoints ---

MAX_SCORE_BYTES = 20 * 1024 * 1024
SCORE_MEDIA_TYPES = {
    ".mxl": "application/vnd.recordare.musicxml",
    ".musicxml": "application/vnd.recordare.musicxml+xml",
}


def _score_format(filename: str, data: bytes) -> str:
    """Return the stored extension for an uploaded score, or raise 400 if it isn't MusicXML."""
    import io
    import zipfile

    ext = Path(filename).suffix.lower()
    if ext == ".mxl":
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as zf:
                ok = "META-INF/container.xml" in zf.namelist()
        except zipfile.BadZipFile:
            ok = False
        if not ok:
            raise HTTPException(status_code=400, detail="Not a valid compressed MusicXML file")
        return ".mxl"
    if ext in (".musicxml", ".xml"):
        if b"<score-partwise" not in data and b"<score-timewise" not in data:
            raise HTTPException(status_code=400, detail="Not a valid MusicXML file")
        return ".musicxml"
    raise HTTPException(
        status_code=400,
        detail=f"Invalid file type '{ext}'. Allowed: .mxl, .musicxml, .xml",
    )


@app.put("/api/songs/{song_id}/score", response_model=SongResponse)
async def upload_song_score(song_id: int, request: Request, file: UploadFile):
    """Attach (or replace) a MusicXML score on a song."""
    import hashlib

    from jam_session_processor.storage import get_storage

    db = get_db()
    song = _get_song_with_access(db, song_id, request)
    _require_role(request, "editor")

    if file.size is not None and file.size > MAX_SCORE_BYTES:
        raise HTTPException(status_code=413, detail="Score too large. Maximum size is 20 MB.")
    data = await file.read(MAX_SCORE_BYTES + 1)
    if len(data) > MAX_SCORE_BYTES:
        raise HTTPException(status_code=413, detail="Score too large. Maximum size is 20 MB.")
    ext = _score_format(file.filename or "", data)

    # Content hash in the key: a replaced score never collides with a cached copy.
    digest = hashlib.sha256(data).hexdigest()[:16]
    cfg = get_config()
    dest = cfg.data_dir / "scores" / f"{song_id}-{digest}{ext}"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    key = cfg.make_relative(dest)
    storage = get_storage()
    storage.put(key, dest)

    user_id = request.state.user.id if request.state.user else None
    db.set_song_score(song_id, key, updated_by=user_id)
    if song.score_path and song.score_path != key:
        storage.delete(song.score_path)
    return _song_response(db.get_song(song_id, _get_group_ids(request)), request)


@app.get("/api/songs/{song_id}/score")
def get_song_score(song_id: int, request: Request):
    """Return the song's MusicXML score file. Rendered client-side."""
    from jam_session_processor.storage import get_storage

    db = get_db()
    song = _get_song_with_access(db, song_id, request)
    if not song.score_path:
        raise HTTPException(status_code=404, detail="Song has no score")
    cfg = get_config()
    local = cfg.resolve_path(song.score_path)
    try:
        local = get_storage().get(song.score_path, local)
    except Exception:
        logger.exception("Failed to fetch score %s", song.score_path)
        raise HTTPException(status_code=404, detail="Score file not found")
    if not local.exists():
        raise HTTPException(status_code=404, detail="Score file not found")
    # Scores are user-supplied XML: never let a browser render one as a document.
    return FileResponse(
        local,
        media_type=SCORE_MEDIA_TYPES.get(local.suffix, "application/octet-stream"),
        headers={
            "Content-Disposition": f'attachment; filename="score{local.suffix}"',
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "Cache-Control": "private, max-age=0, must-revalidate",
        },
    )


@app.delete("/api/songs/{song_id}/score", response_model=SongResponse)
def delete_song_score(song_id: int, request: Request):
    from jam_session_processor.storage import get_storage

    db = get_db()
    song = _get_song_with_access(db, song_id, request)
    _require_role(request, "editor")
    if song.score_path:
        user_id = request.state.user.id if request.state.user else None
        db.set_song_score(song_id, None, updated_by=user_id)
        get_storage().delete(song.score_path)
    return _song_response(db.get_song(song_id, _get_group_ids(request)), request)


# --- Setlist endpoints ---


class SetlistResponse(BaseModel):
    id: int
    group_id: int
    group_name: str = ""
    name: str
    date: str | None
    notes: str
    song_count: int
    created_by_name: str | None = None
    updated_by_name: str | None = None
    updated_at: str | None = None


class SetlistSongResponse(BaseModel):
    position: int
    song_id: int
    song_name: str
    artist: str
    sheet: str
    added_by_name: str | None = None


class CreateSetlistRequest(BaseModel):
    name: NameStr
    group_id: int
    date: ShortStr | None = None
    notes: NotesStr = ""


class SetlistSongsRequest(BaseModel):
    song_ids: list[int] = Field(max_length=1000)


class AddSetlistSongRequest(BaseModel):
    song_id: int
    position: int | None = None


def _setlist_response(setlist) -> SetlistResponse:
    db = get_db()
    group = db.get_group(setlist.group_id)
    d = setlist.__dict__.copy()
    d["group_name"] = group.name if group else ""
    d["created_by_name"] = db.get_user_name(d.pop("created_by", None))
    d["updated_by_name"] = db.get_user_name(d.pop("updated_by", None))
    return SetlistResponse(**d)


def _setlist_songs_response(setlist_id: int) -> list[SetlistSongResponse]:
    db = get_db()
    songs = db.get_setlist_songs(setlist_id)
    result = []
    for s in songs:
        d = s.__dict__.copy()
        d["added_by_name"] = db.get_user_name(d.pop("added_by", None))
        result.append(SetlistSongResponse(**d))
    return result


def _get_setlist_with_access(db, setlist_id: int, request):
    """Get a setlist and verify group access."""
    setlist = db.get_setlist(setlist_id)
    if not setlist:
        raise HTTPException(status_code=404, detail="Setlist not found")
    _require_group_access(request, setlist.group_id)
    return setlist


@app.get("/api/setlists", response_model=list[SetlistResponse])
def list_setlists(request: Request):
    db = get_db()
    group_ids = _get_group_ids(request)
    return [_setlist_response(sl) for sl in db.list_setlists(group_ids)]


@app.post("/api/setlists", response_model=SetlistResponse, status_code=201)
def create_setlist(req: CreateSetlistRequest, request: Request):
    db = get_db()
    _require_group_access(request, req.group_id)
    _require_role(request, "editor")
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Setlist name cannot be empty")
    if db.setlist_exists_in_group(name, req.group_id):
        raise HTTPException(status_code=409, detail="Setlist already exists in this group")
    user_id = request.state.user.id if request.state.user else None
    sl_id = db.create_setlist(
        name, req.group_id, date=req.date, notes=req.notes, created_by=user_id
    )
    if request.state.user:
        db.log_activity(request.state.user.id, req.group_id, "setlist_create", name)
    setlist = db.get_setlist(sl_id)
    return _setlist_response(setlist)


@app.get("/api/setlists/{setlist_id}", response_model=SetlistResponse)
def get_setlist(setlist_id: int, request: Request):
    db = get_db()
    setlist = _get_setlist_with_access(db, setlist_id, request)
    return _setlist_response(setlist)


@app.get("/api/setlists/{setlist_id}/songs", response_model=list[SetlistSongResponse])
def get_setlist_songs(setlist_id: int, request: Request):
    db = get_db()
    _get_setlist_with_access(db, setlist_id, request)
    return _setlist_songs_response(setlist_id)


@app.put("/api/setlists/{setlist_id}/name", response_model=SetlistResponse)
def update_setlist_name(setlist_id: int, req: NameRequest, request: Request):
    db = get_db()
    setlist = _get_setlist_with_access(db, setlist_id, request)
    _require_role(request, "editor")
    user_id = request.state.user.id if request.state.user else None
    try:
        db.update_setlist_name(setlist_id, req.name.strip(), updated_by=user_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if request.state.user:
        db.log_activity(request.state.user.id, setlist.group_id, "setlist_edit", req.name.strip())
    setlist = db.get_setlist(setlist_id)
    return _setlist_response(setlist)


@app.put("/api/setlists/{setlist_id}/date", response_model=SetlistResponse)
def update_setlist_date(setlist_id: int, req: DateRequest, request: Request):
    db = get_db()
    setlist = _get_setlist_with_access(db, setlist_id, request)
    _require_role(request, "editor")
    user_id = request.state.user.id if request.state.user else None
    db.update_setlist_date(setlist_id, req.date, updated_by=user_id)
    if request.state.user:
        db.log_activity(request.state.user.id, setlist.group_id, "setlist_edit", setlist.name)
    setlist = db.get_setlist(setlist_id)
    return _setlist_response(setlist)


@app.put("/api/setlists/{setlist_id}/notes", response_model=SetlistResponse)
def update_setlist_notes(setlist_id: int, req: NotesRequest, request: Request):
    db = get_db()
    setlist = _get_setlist_with_access(db, setlist_id, request)
    _require_role(request, "editor")
    user_id = request.state.user.id if request.state.user else None
    db.update_setlist_notes(setlist_id, req.notes, updated_by=user_id)
    if request.state.user:
        db.log_activity(request.state.user.id, setlist.group_id, "setlist_edit", setlist.name)
    setlist = db.get_setlist(setlist_id)
    return _setlist_response(setlist)


def _ensure_song_in_group(db: Database, song_id: int, group_id: int, request: Request):
    """Validate a song for a group's setlist, linking it to that group if needed."""
    try:
        _get_song_with_access(db, song_id, request)
    except HTTPException:
        raise HTTPException(status_code=400, detail=f"Song {song_id} not found")
    try:
        db.link_song_to_group(song_id, group_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/setlists/{setlist_id}/songs", response_model=list[SetlistSongResponse])
def set_setlist_songs(setlist_id: int, req: SetlistSongsRequest, request: Request):
    db = get_db()
    setlist = _get_setlist_with_access(db, setlist_id, request)
    _require_role(request, "editor")
    # Songs must be visible to the caller; they become linked to the setlist's group
    for sid in req.song_ids:
        _ensure_song_in_group(db, sid, setlist.group_id, request)
    user_id = request.state.user.id if request.state.user else None
    db.set_setlist_songs(setlist_id, req.song_ids, updated_by=user_id)
    if request.state.user:
        db.log_activity(request.state.user.id, setlist.group_id, "setlist_edit", setlist.name)
    return _setlist_songs_response(setlist_id)


@app.post("/api/setlists/{setlist_id}/songs", response_model=list[SetlistSongResponse])
def add_setlist_song(setlist_id: int, req: AddSetlistSongRequest, request: Request):
    db = get_db()
    setlist = _get_setlist_with_access(db, setlist_id, request)
    _require_role(request, "editor")
    _ensure_song_in_group(db, req.song_id, setlist.group_id, request)
    user_id = request.state.user.id if request.state.user else None
    db.add_song_to_setlist(setlist_id, req.song_id, req.position, added_by=user_id)
    if request.state.user:
        db.log_activity(request.state.user.id, setlist.group_id, "setlist_edit", setlist.name)
    return _setlist_songs_response(setlist_id)


@app.delete("/api/setlists/{setlist_id}/songs/{position}")
def remove_setlist_song(setlist_id: int, position: int, request: Request):
    db = get_db()
    _get_setlist_with_access(db, setlist_id, request)
    _require_role(request, "editor")
    db.remove_song_from_setlist(setlist_id, position)
    return {"ok": True}


@app.delete("/api/setlists/{setlist_id}")
def delete_setlist(setlist_id: int, request: Request):
    db = get_db()
    _get_setlist_with_access(db, setlist_id, request)
    _require_role(request, "admin")
    db.delete_setlist(setlist_id)
    return {"ok": True}


# --- Invite endpoints (public) ---


class InviteValidateRequest(BaseModel):
    token: TokenStr


class InviteAcceptRequest(BaseModel):
    token: TokenStr
    password: PasswordStr


def _validate_invite_token(db, token: str):
    """Validate an invite token. Returns (token_row, user) or raises HTTPException."""
    from datetime import datetime, timezone

    row = db.get_invite_token(token)
    if not row:
        raise HTTPException(status_code=404, detail="Invalid invite link")
    if row.used_at is not None:
        raise HTTPException(status_code=410, detail="This invite has already been used")
    expires_at = datetime.strptime(row.expires_at, "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires_at:
        raise HTTPException(status_code=410, detail="This invite has expired")
    user = db.get_user(row.user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User no longer exists")
    return row, user


@app.post("/api/invite/validate")
def invite_validate(req: InviteValidateRequest, request: Request):
    _enforce_rate_limit(_token_limiter, _get_client_ip(request), _TOO_MANY)
    db = get_db()
    _row, user = _validate_invite_token(db, req.token)
    return {"email": user.email, "name": user.name}


@app.post("/api/invite/accept")
def invite_accept(req: InviteAcceptRequest, request: Request):
    _enforce_rate_limit(_token_limiter, _get_client_ip(request), _TOO_MANY)
    if not req.password or len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    db = get_db()
    _row, user = _validate_invite_token(db, req.token)
    pw_hash = hash_password(req.password)
    db.update_user_password(user.id, pw_hash)
    db.consume_invite_token(req.token)
    token = create_jwt(user.id, user.email)
    groups = db.get_user_groups(user.id)
    response = JSONResponse(
        {
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "role": user.role,
            "groups": [{"id": g.id, "name": g.name} for g in groups],
        }
    )
    response.set_cookie(
        key="jam_session",
        value=token,
        httponly=True,
        secure=get_config().app_url.startswith("https"),
        samesite="lax",
        max_age=7 * 24 * 3600,
        path="/",
    )
    return response


# --- Admin endpoints ---


class AdminGroupBrief(BaseModel):
    id: int
    name: str


class AdminUserResponse(BaseModel):
    id: int
    email: str
    name: str
    role: str
    groups: list[AdminGroupBrief]


class AdminGroupResponse(BaseModel):
    id: int
    name: str
    member_count: int
    features: list[str] = []


class CreateUserRequest(BaseModel):
    email: EmailStr_
    password: PasswordStr = ""
    name: NameStr = ""
    role: ShortStr = "editor"
    group_ids: list[int] = Field(default=[], max_length=100)


class PasswordRequest(BaseModel):
    password: PasswordStr


class AssignGroupRequest(BaseModel):
    group_id: int


def _admin_user_response(db, user) -> AdminUserResponse:
    groups = db.get_user_groups(user.id)
    return AdminUserResponse(
        id=user.id,
        email=user.email,
        name=user.name,
        role=user.role,
        groups=[AdminGroupBrief(id=g.id, name=g.name) for g in groups],
    )


def _admin_group_response(db, group) -> AdminGroupResponse:
    count = db.get_group_member_count(group.id)
    features = [f for f in (group.features or "").split(",") if f]
    return AdminGroupResponse(
        id=group.id,
        name=group.name,
        member_count=count,
        features=features,
    )


@app.get("/api/admin/users", response_model=list[AdminUserResponse])
def admin_list_users(request: Request):
    _require_role(request, "superadmin")
    db = get_db()
    return [_admin_user_response(db, u) for u in db.list_users()]


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

    for gid in req.group_ids:
        if db.get_group(gid):
            db.assign_user_to_group(user_id, gid)

    user = db.get_user(user_id)

    if not req.password:
        token = db.create_invite_token(user_id)
        from jam_session_processor.email import send_invite_email

        send_invite_email(req.email, token, req.name)

    return _admin_user_response(db, user)


@app.post("/api/admin/users/{user_id}/resend-invite")
def admin_resend_invite(user_id: int, request: Request):
    _require_role(request, "superadmin")
    db = get_db()
    user = db.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete_invite_tokens_for_user(user_id)
    token = db.create_invite_token(user_id)
    from jam_session_processor.email import send_invite_email

    sent = send_invite_email(user.email, token, user.name)
    return {"ok": True, "email_sent": sent}


@app.delete("/api/admin/users/{user_id}")
def admin_delete_user(user_id: int, request: Request):
    _require_role(request, "superadmin")
    db = get_db()
    user = db.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.delete_user(user_id)
    return {"ok": True}


@app.put("/api/admin/users/{user_id}/password")
def admin_reset_password(user_id: int, req: PasswordRequest, request: Request):
    _require_role(request, "superadmin")
    db = get_db()
    user = db.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    pw_hash = hash_password(req.password)
    db.update_user_password(user_id, pw_hash)
    return {"ok": True}


@app.put("/api/admin/users/{user_id}/name", response_model=AdminUserResponse)
def admin_update_name(user_id: int, req: NameRequest, request: Request):
    _require_role(request, "superadmin")
    db = get_db()
    user = db.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.update_user_name(user_id, req.name.strip())
    user = db.get_user(user_id)
    return _admin_user_response(db, user)


class RoleRequest(BaseModel):
    role: ShortStr


@app.put("/api/admin/users/{user_id}/role", response_model=AdminUserResponse)
def admin_update_role(user_id: int, req: RoleRequest, request: Request):
    _require_role(request, "superadmin")
    db = get_db()
    user = db.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    from jam_session_processor.db import VALID_ROLES

    if req.role not in VALID_ROLES:
        valid = ", ".join(sorted(VALID_ROLES))
        raise HTTPException(status_code=400, detail=f"Invalid role. Must be one of: {valid}")
    db.update_user_role(user_id, req.role)
    user = db.get_user(user_id)
    return _admin_user_response(db, user)


@app.post("/api/admin/users/{user_id}/groups", response_model=AdminUserResponse)
def admin_assign_user_to_group(user_id: int, req: AssignGroupRequest, request: Request):
    _require_role(request, "superadmin")
    db = get_db()
    user = db.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not db.get_group(req.group_id):
        raise HTTPException(status_code=404, detail="Group not found")
    db.assign_user_to_group(user_id, req.group_id)
    user = db.get_user(user_id)
    return _admin_user_response(db, user)


@app.delete("/api/admin/users/{user_id}/groups/{group_id}", response_model=AdminUserResponse)
def admin_remove_user_from_group(user_id: int, group_id: int, request: Request):
    _require_role(request, "superadmin")
    db = get_db()
    user = db.get_user(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    db.remove_user_from_group(user_id, group_id)
    user = db.get_user(user_id)
    return _admin_user_response(db, user)


@app.get("/api/admin/groups", response_model=list[AdminGroupResponse])
def admin_list_groups(request: Request):
    _require_role(request, "superadmin")
    db = get_db()
    return [_admin_group_response(db, g) for g in db.list_groups()]


@app.post("/api/admin/groups", response_model=AdminGroupResponse, status_code=201)
def admin_create_group(req: NameRequest, request: Request):
    _require_role(request, "superadmin")
    db = get_db()
    if db.get_group_by_name(req.name):
        raise HTTPException(status_code=400, detail="Group name already exists")
    group_id = db.create_group(req.name)
    group = db.get_group(group_id)
    return _admin_group_response(db, group)


@app.delete("/api/admin/groups/{group_id}")
def admin_delete_group(group_id: int, request: Request):
    _require_role(request, "superadmin")
    db = get_db()
    group = db.get_group(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    scores_before = db.score_paths()
    db.delete_group(group_id)
    # Songs only this group played went with it: remove their score files too
    removed = scores_before - db.score_paths()
    if removed:
        from jam_session_processor.storage import get_storage

        storage = get_storage()
        for path in removed:
            storage.delete(path)
    return {"ok": True}


class UpdateGroupFeaturesRequest(BaseModel):
    features: list[ShortStr] = Field(max_length=50)


@app.put(
    "/api/admin/groups/{group_id}/features",
    response_model=AdminGroupResponse,
)
def admin_update_group_features(group_id: int, req: UpdateGroupFeaturesRequest, request: Request):
    _require_role(request, "superadmin")
    db = get_db()
    group = db.get_group(group_id)
    if not group:
        raise HTTPException(status_code=404, detail="Group not found")
    db.update_group_features(group_id, ",".join(req.features))
    group = db.get_group(group_id)
    return _admin_group_response(db, group)


# --- Admin stats endpoint ---


@app.get("/api/admin/stats")
def admin_get_stats(request: Request):
    _require_role(request, "superadmin")
    db = get_db()
    return db.get_activity_stats()


@app.get("/api/admin/users/{user_id}/song-activity")
def admin_get_song_activity(user_id: int, request: Request):
    """One user's per-song opened/performed timestamps, newest first (read-only)."""
    _require_role(request, "superadmin")
    db = get_db()
    if not db.get_user(user_id):
        raise HTTPException(status_code=404, detail="User not found")
    rows = [{"song_id": sid, **a} for sid, a in db.get_song_activity(user_id).items()]
    rows.sort(
        key=lambda r: max(r["last_opened_at"] or "", r["last_performed_at"] or ""), reverse=True
    )
    return rows


class CurationItem(BaseModel):
    song_id: int | None = None
    song_name: NameStr
    action: ShortStr


class CurationRunRequest(BaseModel):
    summary: TextStr = ""
    items: list[CurationItem] = Field(default_factory=list, max_length=500)


class CurationRunResponse(BaseModel):
    id: int
    summary: str
    items: list[CurationItem]
    created_at: str


def _curation_run_response(row: dict) -> CurationRunResponse:
    return CurationRunResponse(**{**row, "items": json.loads(row["items"] or "[]")})


@app.post("/api/admin/curation-runs", response_model=CurationRunResponse)
def admin_log_curation_run(req: CurationRunRequest, request: Request):
    """Record what one run of the library-curation routine changed."""
    _require_role(request, "superadmin")
    db = get_db()
    items = json.dumps([i.model_dump() for i in req.items])
    run_id = db.add_curation_run(req.summary, items)
    return _curation_run_response(next(r for r in db.list_curation_runs(1) if r["id"] == run_id))


class VideoFlagResponse(BaseModel):
    id: int
    song_id: int
    song_name: str
    song_artist: str
    kind: str
    url: str
    title: str
    reason: str
    flagged_by_name: str | None
    created_at: str
    resolved_at: str | None


@app.get("/api/admin/video-flags", response_model=list[VideoFlagResponse])
def admin_list_video_flags(request: Request, include_resolved: bool = False):
    """Videos marked as bad, oldest first: the ones still waiting for the
    library-curation routine, or all of them with `include_resolved`."""
    _require_role(request, "superadmin")
    return get_db().list_video_flags(include_resolved)


@app.post("/api/admin/video-flags/{flag_id}/resolve", status_code=204)
def admin_resolve_video_flag(flag_id: int, request: Request):
    """The routine is done with a flagged video (replaced, or no replacement found)."""
    _require_role(request, "superadmin")
    db = get_db()
    if not db.get_video_flag(flag_id):
        raise HTTPException(status_code=404, detail="Flag not found")
    db.resolve_video_flag(flag_id)


class VideoMiss(BaseModel):
    song_id: int
    kind: SongLinkKind
    reason: Literal["not_found", "not_applicable"] = "not_found"


class VideoMissResponse(VideoMiss):
    created_at: str


@app.get("/api/admin/video-misses", response_model=list[VideoMissResponse])
def admin_list_video_misses(request: Request):
    """Kinds of video the library-curation routine should not search for now:
    it found nothing recently, or the kind doesn't apply to the song."""
    _require_role(request, "superadmin")
    return get_db().list_video_misses()


@app.post("/api/admin/video-misses", status_code=204)
def admin_set_video_misses(
    misses: Annotated[list[VideoMiss], Field(max_length=500)], request: Request
):
    """Record what a run of the routine searched for and couldn't get."""
    _require_role(request, "superadmin")
    db = get_db()
    for miss in misses:
        if db.get_song(miss.song_id):
            db.set_video_miss(miss.song_id, miss.kind, miss.reason)


@app.delete("/api/admin/video-misses/{song_id}/{kind}", status_code=204)
def admin_delete_video_miss(song_id: int, kind: SongLinkKind, request: Request):
    """Let the routine search for this kind of video again."""
    _require_role(request, "superadmin")
    get_db().delete_video_miss(song_id, kind)


@app.get("/api/admin/song-identification")
def admin_song_identification(request: Request):
    """State of automatic song tagging (speech-to-text + matching)."""
    _require_role(request, "superadmin")
    from jam_session_processor import transcribe

    return {
        "available": transcribe.is_available(),
        "model": transcribe.model_name(),
        "nightly_hour_utc": _identify_hour(),
        "running": _identify_running(),
        "queued": len(_identify_pending),
        **get_db().get_identification_stats(),
    }


@app.post("/api/admin/song-identification/run", status_code=202)
def admin_run_song_identification(request: Request):
    """Start an identification run now instead of waiting for the nightly one."""
    _require_role(request, "superadmin")
    from jam_session_processor import transcribe

    if not transcribe.is_available():
        raise HTTPException(status_code=503, detail="Speech-to-text is not installed")
    if not _request_identify(None):
        raise HTTPException(status_code=409, detail="A run is already in progress")
    return {"started": True}


@app.get("/api/admin/curation-runs", response_model=list[CurationRunResponse])
def admin_list_curation_runs(request: Request, limit: int = 50):
    _require_role(request, "superadmin")
    return [_curation_run_response(r) for r in get_db().list_curation_runs(min(max(limit, 1), 200))]


# --- Server health endpoint ---

_app_start_time = time.time()


def _read_proc_file(path: str) -> str | None:
    try:
        return Path(path).read_text()
    except OSError:
        return None


def _get_memory_info() -> dict:
    """Read memory info from /proc/meminfo (Linux) or fallback."""
    content = _read_proc_file("/proc/meminfo")
    if not content:
        return {"total_mb": 0, "used_mb": 0, "percent": 0}
    info = {}
    for line in content.splitlines():
        parts = line.split()
        if len(parts) >= 2:
            info[parts[0].rstrip(":")] = int(parts[1])  # in kB
    total = info.get("MemTotal", 0)
    available = info.get("MemAvailable", info.get("MemFree", 0))
    used = total - available
    total_mb = total // 1024
    used_mb = used // 1024
    pct = round(used * 100 / total) if total else 0
    return {"total_mb": total_mb, "used_mb": used_mb, "percent": pct}


def _get_disk_info() -> list[dict]:
    """Get disk usage for key paths."""
    import shutil

    results = []
    seen = set()
    config = get_config()
    paths = {"/": "/", "data": str(config.data_dir)}
    for label, path in paths.items():
        try:
            usage = shutil.disk_usage(path)
            # Deduplicate by device (same total = same partition)
            key = usage.total
            if key in seen:
                continue
            seen.add(key)
            total_gb = round(usage.total / (1024**3), 1)
            used_gb = round(usage.used / (1024**3), 1)
            pct = round(usage.used * 100 / usage.total) if usage.total else 0
            results.append(
                {
                    "mount": label,
                    "total_gb": total_gb,
                    "used_gb": used_gb,
                    "percent": pct,
                }
            )
        except OSError:
            pass
    return results


def _get_uptime() -> dict:
    """Get system uptime from /proc/uptime."""
    content = _read_proc_file("/proc/uptime")
    if content:
        secs = float(content.split()[0])
        return {"seconds": int(secs)}
    return {"seconds": 0}


def _get_db_stats(db: Database) -> dict:
    """Get database size and record counts."""
    config = get_config()
    db_path = config.resolve_path(config.db_path)
    try:
        size_bytes = db_path.stat().st_size
    except OSError:
        size_bytes = 0

    size_mb = round(size_bytes / (1024 * 1024), 2)

    # Record counts via raw queries
    counts = {}
    for table in ["sessions", "tracks", "songs", "users", "groups", "setlists"]:
        try:
            row = db.conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()  # noqa: S608
            counts[table] = row[0] if row else 0
        except Exception:
            counts[table] = 0

    return {"size_mb": size_mb, "counts": counts}


def _get_storage_info() -> dict:
    """Get storage backend info."""
    config = get_config()
    backend = "r2" if config.r2_bucket else "local"
    return {"backend": backend}


_storage_usage_cache: dict = {}
_STORAGE_USAGE_TTL = 600  # listing a bucket is slow-ish; cache for 10 minutes


def _compute_storage_usage() -> dict:
    from jam_session_processor.storage import get_storage

    config = get_config()
    storage = get_storage()
    objects = dict(storage.list_objects())
    sessions, tracks = get_db().storage_references()

    prefixes: dict[str, dict] = {}
    for key, size in objects.items():
        top = key.split("/", 1)[0] if "/" in key else "(root)"
        p = prefixes.setdefault(top, {"prefix": top, "objects": 0, "bytes": 0})
        p["objects"] += 1
        p["bytes"] += size

    tracks_by_session: dict[int, list[str]] = {}
    for t in tracks:
        if t["audio_path"]:
            tracks_by_session.setdefault(t["session_id"], []).append(t["audio_path"])

    referenced: set[str] = set()
    missing = 0
    recordings = []
    for s in sessions:
        src = s["source_file"] or ""
        track_paths = tracks_by_session.get(s["id"], [])
        referenced.update([src, *track_paths])
        missing += sum(1 for k in [src, *track_paths] if k and k not in objects)
        source_bytes = objects.get(src)
        track_bytes = sum(objects.get(k, 0) for k in track_paths)
        recordings.append(
            {
                "id": s["id"],
                "name": s["name"],
                "date": s["date"],
                "group_name": s["group_name"],
                "duration_sec": s["duration_sec"],
                "source_bytes": source_bytes,
                "track_bytes": track_bytes,
                "track_count": len(track_paths),
                "total_bytes": (source_bytes or 0) + track_bytes,
            }
        )
    recordings.sort(key=lambda r: r["total_bytes"], reverse=True)
    referenced.update(get_db().score_paths())
    orphans = [(k, v) for k, v in objects.items() if k not in referenced]

    return {
        "backend": "r2" if storage.is_remote else "local",
        "bucket": config.r2_bucket or None,
        "total_objects": len(objects),
        "total_bytes": sum(objects.values()),
        "recordings_source_bytes": sum(r["source_bytes"] or 0 for r in recordings),
        "recordings_track_bytes": sum(r["track_bytes"] for r in recordings),
        "prefixes": sorted(prefixes.values(), key=lambda p: p["bytes"], reverse=True),
        "orphans": {"objects": len(orphans), "bytes": sum(v for _, v in orphans)},
        "missing_files": missing,
        "recordings": recordings,
        "computed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


@app.get("/api/admin/storage")
def admin_storage_usage(request: Request, refresh: bool = False):
    """File storage usage (R2 bucket or local disk), with a per-recording breakdown."""
    _require_role(request, "superadmin")
    cached = _storage_usage_cache.get("value")
    if refresh or not cached or time.time() - _storage_usage_cache["at"] > _STORAGE_USAGE_TTL:
        try:
            cached = _compute_storage_usage()
        except Exception as e:
            logger.warning("Storage usage listing failed", exc_info=True)
            raise HTTPException(status_code=502, detail=f"Could not list storage: {e}")
        _storage_usage_cache.update(value=cached, at=time.time())
    return cached


@app.get("/api/admin/server-health")
def admin_server_health(request: Request):
    _require_role(request, "superadmin")
    import platform
    import socket

    db = get_db()
    config = get_config()

    now = time.time()
    app_uptime_secs = int(now - _app_start_time)

    return {
        "system": {
            "hostname": socket.gethostname(),
            "platform": platform.platform(),
            "python_version": platform.python_version(),
            "time": time.strftime("%Y-%m-%d %H:%M:%S %Z"),
        },
        "app": {
            "uptime_seconds": app_uptime_secs,
            "port": config.port,
            "data_dir": str(config.data_dir),
        },
        "memory": _get_memory_info(),
        "disk": _get_disk_info(),
        "uptime": _get_uptime(),
        "database": _get_db_stats(db),
        "storage": _get_storage_info(),
    }


# --- SPA static file serving ---

_static_dir = _os.environ.get("JAM_STATIC_DIR")
if _static_dir:
    _static_path = Path(_static_dir)
    if _static_path.is_dir():
        # Files that must not be cached so the browser always picks up new versions
        _no_cache_files = {"sw.js", "index.html"}

        # Paths handled by dedicated server-side routes (not the SPA)
        _server_prefixes = ("/share/", "/api/")

        # Serve index.html for the root and any non-file paths (React Router)
        @app.get("/{full_path:path}")
        def spa_catch_all(full_path: str):
            prefixed = f"/{full_path}"
            if any(prefixed.startswith(p) for p in _server_prefixes):
                raise HTTPException(status_code=404)
            file = _static_path / full_path
            if (
                full_path
                and file.is_file()
                and file.resolve().is_relative_to(_static_path.resolve())
            ):
                resp = FileResponse(file)
                if file.name in _no_cache_files:
                    resp.headers["Cache-Control"] = "no-cache"
                return resp
            return FileResponse(
                _static_path / "index.html",
                headers={"Cache-Control": "no-cache"},
            )
