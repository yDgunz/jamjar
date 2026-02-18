import logging
import os as _os
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

from jam_session_processor.auth import create_jwt, decode_jwt, verify_password
from jam_session_processor.config import get_config
from jam_session_processor.db import Database

logger = logging.getLogger(__name__)

app = FastAPI(title="Jam Session Processor", version="0.1.0")


@app.get("/health")
def health():
    return {"status": "ok"}


cfg = get_config()
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


# --- Auth middleware ---

_PUBLIC_PATHS = {"/health", "/api/auth/login"}


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    path = request.url.path
    cfg = get_config()

    # Public endpoints
    if path in _PUBLIC_PATHS:
        return await call_next(request)

    # Non-API paths (SPA static files)
    if not path.startswith("/api"):
        return await call_next(request)

    # API key auth (for CLI upload)
    api_key = request.headers.get("x-api-key")
    if api_key:
        if not cfg.api_key:
            return JSONResponse(status_code=401, content={"detail": "API key auth not configured"})
        if api_key != cfg.api_key:
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


# --- Auth endpoints ---


class LoginRequest(BaseModel):
    email: str
    password: str


class AuthUserGroup(BaseModel):
    id: int
    name: str


class AuthUserResponse(BaseModel):
    id: int
    email: str
    name: str
    groups: list[AuthUserGroup]


@app.post("/api/auth/login")
def login(req: LoginRequest):
    db = get_db()
    user = db.get_user_by_email(req.email)
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_jwt(user.id, user.email)
    groups = db.get_user_groups(user.id)
    response = JSONResponse(
        content={
            "id": user.id,
            "email": user.email,
            "name": user.name,
            "groups": [{"id": g.id, "name": g.name} for g in groups],
        }
    )
    response.set_cookie(
        key="jam_session",
        value=token,
        httponly=True,
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
        groups=[AuthUserGroup(id=g.id, name=g.name) for g in groups],
    )


@app.post("/api/auth/logout")
def logout():
    response = JSONResponse(content={"ok": True})
    response.delete_cookie(key="jam_session", path="/")
    return response


# --- Response models ---


class SessionResponse(BaseModel):
    id: int
    group_id: int
    group_name: str = ""
    name: str
    date: str | None
    source_file: str
    notes: str
    track_count: int
    tagged_count: int
    song_names: str = ""


class TrackResponse(BaseModel):
    id: int
    session_id: int
    song_id: int | None
    song_name: str | None
    track_number: int
    start_sec: float
    end_sec: float
    duration_sec: float
    fingerprint: str
    notes: str


class SongResponse(BaseModel):
    id: int
    name: str
    chart: str = ""
    lyrics: str = ""
    notes: str = ""
    take_count: int
    first_date: str | None
    last_date: str | None


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


class TagRequest(BaseModel):
    song_name: str


class NotesRequest(BaseModel):
    notes: str


class NameRequest(BaseModel):
    name: str


class MergeRequest(BaseModel):
    other_track_id: int


class SplitRequest(BaseModel):
    split_at_sec: float


class SongDetailsRequest(BaseModel):
    chart: str = ""
    lyrics: str = ""
    notes: str = ""


class DateRequest(BaseModel):
    date: str | None


class ReprocessRequest(BaseModel):
    threshold: float = -30.0
    min_duration: int = 120


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
    return SessionResponse(**d)


def _track_response(track) -> TrackResponse:
    d = track.__dict__.copy()
    d.pop("audio_path", None)
    return TrackResponse(**d)


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
    db.update_session_name(session_id, req.name)
    session = db.get_session(session_id)
    return _session_response(session)


@app.put("/api/sessions/{session_id}/notes", response_model=SessionResponse)
def update_session_notes(session_id: int, req: NotesRequest, request: Request):
    db = get_db()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    _require_group_access(request, session.group_id)
    db.update_session_notes(session_id, req.notes)
    session = db.get_session(session_id)
    return _session_response(session)


@app.put("/api/sessions/{session_id}/date", response_model=SessionResponse)
def update_session_date(session_id: int, req: DateRequest, request: Request):
    db = get_db()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    _require_group_access(request, session.group_id)
    db.update_session_date(session_id, req.date)
    session = db.get_session(session_id)
    return _session_response(session)


class DeleteSessionRequest(BaseModel):
    delete_files: bool = False


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: int, request: Request, req: DeleteSessionRequest | None = None):
    db = get_db()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    _require_group_access(request, session.group_id)
    db.delete_session(session_id, delete_files=req.delete_files if req else False)
    return {"ok": True}


@app.get("/api/sessions/{session_id}/audio")
def stream_session_audio(session_id: int, request: Request):
    db = get_db()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    _require_group_access(request, session.group_id)
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
    return [_track_response(t) for t in db.get_tracks_for_session(session_id)]


@app.post(
    "/api/sessions/{session_id}/reprocess",
    response_model=list[TrackResponse],
)
def reprocess_session(session_id: int, req: ReprocessRequest, request: Request):
    """Re-run song detection on a session with new parameters."""
    import os

    from jam_session_processor.fingerprint import compute_chroma_fingerprint
    from jam_session_processor.metadata import extract_metadata
    from jam_session_processor.output import export_segments
    from jam_session_processor.splitter import detect_songs

    db = get_db()
    cfg = get_config()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    _require_group_access(request, session.group_id)

    source = cfg.resolve_path(session.source_file)
    if not source.exists():
        raise HTTPException(status_code=404, detail="Source audio file not found on disk")

    # Determine output dir from existing tracks or default
    existing_tracks = db.get_tracks_for_session(session_id)
    if existing_tracks:
        output_dir = cfg.resolve_path(existing_tracks[0].audio_path).parent
    else:
        output_dir = cfg.output_dir_for_source(source.stem)

    # Delete old tracks and their audio files
    for track in existing_tracks:
        try:
            os.remove(str(cfg.resolve_path(track.audio_path)))
        except OSError:
            pass
        db.delete_track(track.id)

    # Re-detect songs
    try:
        result = detect_songs(
            source,
            energy_threshold_db=req.threshold,
            min_song_duration_sec=req.min_duration,
        )
    except Exception as e:
        logger.exception("Reprocess detection failed")
        raise HTTPException(status_code=500, detail=f"Detection failed: {e}")

    if not result.segments:
        return []

    # Re-export and save new tracks
    meta = extract_metadata(source)
    exported = export_segments(
        source,
        result.segments,
        output_dir,
        session_date=meta.recording_date,
    )

    for i, ((start, end), audio_path) in enumerate(zip(result.segments, exported), start=1):
        fp = compute_chroma_fingerprint(source, start_sec=start, duration_sec=end - start)
        db.create_track(
            session_id,
            track_number=i,
            start_sec=start,
            end_sec=end,
            audio_path=cfg.make_relative(audio_path.resolve()),
            fingerprint=fp,
        )

    return [_track_response(t) for t in db.get_tracks_for_session(session_id)]


ALLOWED_EXTENSIONS = {".m4a", ".wav", ".mp3", ".flac", ".ogg"}


@app.post("/api/sessions/upload", response_model=SessionResponse)
async def upload_session(request: Request, file: UploadFile):
    """Upload an audio file and run the full processing pipeline."""
    from jam_session_processor.fingerprint import compute_chroma_fingerprint
    from jam_session_processor.metadata import extract_metadata
    from jam_session_processor.output import export_segments
    from jam_session_processor.splitter import detect_songs

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

    # Save to input directory
    cfg.input_dir.mkdir(parents=True, exist_ok=True)
    dest = cfg.input_dir / file.filename
    if dest.exists():
        raise HTTPException(
            status_code=409,
            detail=f"File '{file.filename}' already exists in input/",
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

    # Run processing pipeline
    try:
        meta = extract_metadata(source)
        result = detect_songs(source)
    except Exception as e:
        logger.exception("Upload processing failed")
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")

    date_str = meta.recording_date.strftime("%Y-%m-%d") if meta.recording_date else None

    db = get_db()
    source_rel = cfg.make_relative(source)

    # Check for duplicate session
    existing = db.find_session_by_source(source_rel, group_id)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Session for this file already exists (id={existing.id})",
        )

    session_id = db.create_session(source_rel, group_id=group_id, date=date_str)

    if result.segments:
        output_dir = cfg.output_dir_for_source(source.stem)
        try:
            exported = export_segments(
                source,
                result.segments,
                output_dir,
                session_date=meta.recording_date,
            )
            for i, ((start, end), audio_path) in enumerate(zip(result.segments, exported), start=1):
                fp = compute_chroma_fingerprint(source, start_sec=start, duration_sec=end - start)
                db.create_track(
                    session_id,
                    track_number=i,
                    start_sec=start,
                    end_sec=end,
                    audio_path=cfg.make_relative(audio_path.resolve()),
                    fingerprint=fp,
                )
        except Exception as e:
            logger.exception("Upload export/fingerprint failed")
            raise HTTPException(status_code=500, detail=f"Export failed: {e}")

    session = db.get_session(session_id)
    return _session_response(session)


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
    db.tag_track(track_id, req.song_name, session.group_id)
    track = db.get_track(track_id)
    return _track_response(track)


@app.delete("/api/tracks/{track_id}/tag")
def untag_track(track_id: int, request: Request):
    db = get_db()
    _get_track_with_access(db, track_id, request)
    db.untag_track(track_id)
    return {"ok": True}


@app.put("/api/tracks/{track_id}/notes", response_model=TrackResponse)
def update_track_notes(track_id: int, req: NotesRequest, request: Request):
    db = get_db()
    _get_track_with_access(db, track_id, request)
    db.update_track_notes(track_id, req.notes)
    track = db.get_track(track_id)
    return _track_response(track)


@app.post("/api/tracks/{track_id}/merge", response_model=list[TrackResponse])
def merge_tracks_endpoint(track_id: int, req: MergeRequest, request: Request):
    from jam_session_processor.track_ops import merge_tracks

    db = get_db()
    _get_track_with_access(db, track_id, request)
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
    try:
        tracks = split_track(db, track_id, req.split_at_sec)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception:
        logger.exception("Split failed")
    return [_track_response(t) for t in tracks]


@app.get("/api/tracks/{track_id}/audio")
def stream_track_audio(track_id: int, request: Request):
    db = get_db()
    track, _ = _get_track_with_access(db, track_id, request)
    cfg = get_config()
    audio_path = cfg.resolve_path(track.audio_path)
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")
    media_types = {".ogg": "audio/ogg", ".m4a": "audio/mp4", ".wav": "audio/wav"}
    media_type = media_types.get(audio_path.suffix.lower(), "application/octet-stream")
    return FileResponse(audio_path, media_type=media_type)


# --- Song endpoints ---


def _get_song_with_access(db: Database, song_id: int, request: Request):
    """Get a song and verify group access."""
    song = db.get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    _require_group_access(request, song.group_id)
    return song


@app.get("/api/songs", response_model=list[SongResponse])
def list_songs(request: Request):
    db = get_db()
    group_ids = _get_group_ids(request)
    return [SongResponse(**s.__dict__) for s in db.list_songs(group_ids)]


@app.get("/api/songs/{song_id}", response_model=SongResponse)
def get_song(song_id: int, request: Request):
    db = get_db()
    song = _get_song_with_access(db, song_id, request)
    return SongResponse(**song.__dict__)


@app.put("/api/songs/{song_id}/details", response_model=SongResponse)
def update_song_details(song_id: int, req: SongDetailsRequest, request: Request):
    db = get_db()
    _get_song_with_access(db, song_id, request)
    db.update_song_details(song_id, req.chart, req.lyrics, req.notes)
    song = db.get_song(song_id)
    return SongResponse(**song.__dict__)


@app.delete("/api/songs/{song_id}")
def delete_song(song_id: int, request: Request):
    db = get_db()
    _get_song_with_access(db, song_id, request)
    db.delete_song(song_id)
    return {"ok": True}


@app.put("/api/songs/{song_id}/name", response_model=SongResponse)
def rename_song(song_id: int, req: NameRequest, request: Request):
    db = get_db()
    _get_song_with_access(db, song_id, request)
    try:
        db.rename_song(song_id, req.name.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    song = db.get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    return SongResponse(**song.__dict__)


@app.get("/api/songs/{song_id}/tracks", response_model=list[SongTrackResponse])
def get_song_tracks(song_id: int, request: Request):
    db = get_db()
    _get_song_with_access(db, song_id, request)
    rows = db.get_tracks_for_song(song_id)
    return [_song_track_response(r) for r in rows]


# --- SPA static file serving ---

_static_dir = _os.environ.get("JAM_STATIC_DIR")
if _static_dir:
    _static_path = Path(_static_dir)
    if _static_path.is_dir():
        # Serve index.html for the root and any non-file paths (React Router)
        @app.get("/{full_path:path}")
        def spa_catch_all(full_path: str):
            file = _static_path / full_path
            if full_path and file.is_file():
                return FileResponse(file)
            return FileResponse(_static_path / "index.html")
