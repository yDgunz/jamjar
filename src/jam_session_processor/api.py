import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, UploadFile

logger = logging.getLogger(__name__)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from jam_session_processor.config import get_config
from jam_session_processor.db import Database

app = FastAPI(title="Jam Session Processor", version="0.1.0")


@app.get("/health")
def health():
    return {"status": "ok"}


app.add_middleware(
    CORSMiddleware,
    allow_origins=get_config().cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

_db: Database | None = None


def get_db() -> Database:
    global _db
    if _db is None:
        _db = Database()
    return _db


# --- Response models ---


class SessionResponse(BaseModel):
    id: int
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
    audio_path: str
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
    audio_path: str
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


# --- Session endpoints ---


@app.get("/api/sessions", response_model=list[SessionResponse])
def list_sessions():
    db = get_db()
    return [SessionResponse(**s.__dict__) for s in db.list_sessions()]


@app.get("/api/sessions/{session_id}", response_model=SessionResponse)
def get_session(session_id: int):
    db = get_db()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionResponse(**session.__dict__)


@app.put("/api/sessions/{session_id}/name", response_model=SessionResponse)
def update_session_name(session_id: int, req: NameRequest):
    db = get_db()
    db.update_session_name(session_id, req.name)
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionResponse(**session.__dict__)


@app.put("/api/sessions/{session_id}/notes", response_model=SessionResponse)
def update_session_notes(session_id: int, req: NotesRequest):
    db = get_db()
    db.update_session_notes(session_id, req.notes)
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionResponse(**session.__dict__)


@app.put("/api/sessions/{session_id}/date", response_model=SessionResponse)
def update_session_date(session_id: int, req: DateRequest):
    db = get_db()
    db.update_session_date(session_id, req.date)
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return SessionResponse(**session.__dict__)


class DeleteSessionRequest(BaseModel):
    delete_files: bool = False


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: int, req: DeleteSessionRequest | None = None):
    db = get_db()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    db.delete_session(session_id, delete_files=req.delete_files if req else False)
    return {"ok": True}


@app.get("/api/sessions/{session_id}/audio")
def stream_session_audio(session_id: int):
    db = get_db()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    cfg = get_config()
    audio_path = cfg.resolve_path(session.source_file)
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Source audio file not found")
    # Determine media type from extension
    suffix = audio_path.suffix.lower()
    media_types = {".m4a": "audio/mp4", ".wav": "audio/wav", ".mp3": "audio/mpeg"}
    media_type = media_types.get(suffix, "application/octet-stream")
    return FileResponse(audio_path, media_type=media_type)


@app.get("/api/sessions/{session_id}/tracks", response_model=list[TrackResponse])
def get_session_tracks(session_id: int):
    db = get_db()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return [TrackResponse(**t.__dict__) for t in db.get_tracks_for_session(session_id)]


@app.post(
    "/api/sessions/{session_id}/reprocess",
    response_model=list[TrackResponse],
)
def reprocess_session(session_id: int, req: ReprocessRequest):
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

    source = cfg.resolve_path(session.source_file)
    if not source.exists():
        raise HTTPException(
            status_code=404, detail="Source audio file not found on disk"
        )

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
        raise HTTPException(
            status_code=500, detail=f"Detection failed: {e}"
        )

    if not result.segments:
        return []

    # Re-export and save new tracks
    meta = extract_metadata(source)
    exported = export_segments(
        source, result.segments, output_dir,
        session_date=meta.recording_date,
    )

    for i, ((start, end), audio_path) in enumerate(
        zip(result.segments, exported), start=1
    ):
        fp = compute_chroma_fingerprint(
            source, start_sec=start, duration_sec=end - start
        )
        db.create_track(
            session_id,
            track_number=i,
            start_sec=start,
            end_sec=end,
            audio_path=cfg.make_relative(audio_path.resolve()),
            fingerprint=fp,
        )

    return [
        TrackResponse(**t.__dict__)
        for t in db.get_tracks_for_session(session_id)
    ]


ALLOWED_EXTENSIONS = {".m4a", ".wav", ".mp3", ".flac", ".ogg"}


@app.post("/api/sessions/upload", response_model=SessionResponse)
async def upload_session(file: UploadFile):
    """Upload an audio file and run the full processing pipeline."""
    from jam_session_processor.fingerprint import compute_chroma_fingerprint
    from jam_session_processor.metadata import extract_metadata
    from jam_session_processor.output import export_segments
    from jam_session_processor.splitter import detect_songs

    # Validate extension
    ext = Path(file.filename).suffix.lower() if file.filename else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    cfg = get_config()

    # Save to input directory
    cfg.input_dir.mkdir(parents=True, exist_ok=True)
    dest = cfg.input_dir / file.filename
    if dest.exists():
        raise HTTPException(
            status_code=409,
            detail=f"File '{file.filename}' already exists in input/",
        )

    try:
        content = await file.read()
        dest.write_bytes(content)
    except Exception as e:
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
    existing = db.find_session_by_source(source_rel)
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Session for this file already exists (id={existing.id})",
        )

    session_id = db.create_session(source_rel, date=date_str)

    if result.segments:
        output_dir = cfg.output_dir_for_source(source.stem)
        try:
            exported = export_segments(
                source, result.segments, output_dir,
                session_date=meta.recording_date,
            )
            for i, ((start, end), audio_path) in enumerate(
                zip(result.segments, exported), start=1
            ):
                fp = compute_chroma_fingerprint(
                    source, start_sec=start, duration_sec=end - start
                )
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
    return SessionResponse(**session.__dict__)


# --- Track endpoints ---


@app.post("/api/tracks/{track_id}/tag", response_model=TrackResponse)
def tag_track(track_id: int, req: TagRequest):
    db = get_db()
    db.tag_track(track_id, req.song_name)
    # Return updated track — need to find it first
    tracks = _find_track(db, track_id)
    if not tracks:
        raise HTTPException(status_code=404, detail="Track not found")
    return TrackResponse(**tracks.__dict__)


@app.delete("/api/tracks/{track_id}/tag")
def untag_track(track_id: int):
    db = get_db()
    db.untag_track(track_id)
    return {"ok": True}


@app.put("/api/tracks/{track_id}/notes", response_model=TrackResponse)
def update_track_notes(track_id: int, req: NotesRequest):
    db = get_db()
    db.update_track_notes(track_id, req.notes)
    track = _find_track(db, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return TrackResponse(**track.__dict__)


@app.post("/api/tracks/{track_id}/merge", response_model=list[TrackResponse])
def merge_tracks_endpoint(track_id: int, req: MergeRequest):
    from jam_session_processor.track_ops import merge_tracks
    db = get_db()
    try:
        tracks = merge_tracks(db, track_id, req.other_track_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Merge failed")
        raise HTTPException(status_code=500, detail=f"Merge failed: {e}")
    return [TrackResponse(**t.__dict__) for t in tracks]


@app.post("/api/tracks/{track_id}/split", response_model=list[TrackResponse])
def split_track_endpoint(track_id: int, req: SplitRequest):
    from jam_session_processor.track_ops import split_track
    db = get_db()
    try:
        tracks = split_track(db, track_id, req.split_at_sec)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Split failed")
    return [TrackResponse(**t.__dict__) for t in tracks]


@app.get("/api/tracks/{track_id}/audio")
def stream_track_audio(track_id: int):
    db = get_db()
    track = _find_track(db, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    cfg = get_config()
    audio_path = cfg.resolve_path(track.audio_path)
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")
    media_types = {".ogg": "audio/ogg", ".m4a": "audio/mp4", ".wav": "audio/wav"}
    media_type = media_types.get(audio_path.suffix.lower(), "application/octet-stream")
    return FileResponse(audio_path, media_type=media_type)


# --- Song endpoints ---


@app.get("/api/songs", response_model=list[SongResponse])
def list_songs():
    db = get_db()
    return [SongResponse(**s.__dict__) for s in db.list_songs()]


@app.get("/api/songs/{song_id}", response_model=SongResponse)
def get_song(song_id: int):
    db = get_db()
    song = db.get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    return SongResponse(**song.__dict__)


@app.put("/api/songs/{song_id}/details", response_model=SongResponse)
def update_song_details(song_id: int, req: SongDetailsRequest):
    db = get_db()
    song = db.get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    db.update_song_details(song_id, req.chart, req.lyrics, req.notes)
    song = db.get_song(song_id)
    return SongResponse(**song.__dict__)


@app.delete("/api/songs/{song_id}")
def delete_song(song_id: int):
    db = get_db()
    song = db.get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    db.delete_song(song_id)
    return {"ok": True}


@app.put("/api/songs/{song_id}/name", response_model=SongResponse)
def rename_song(song_id: int, req: NameRequest):
    db = get_db()
    try:
        db.rename_song(song_id, req.name.strip())
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    song = db.get_song(song_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    return SongResponse(**song.__dict__)


@app.get("/api/songs/{song_id}/tracks", response_model=list[SongTrackResponse])
def get_song_tracks(song_id: int):
    db = get_db()
    rows = db.get_tracks_for_song(song_id)
    return [SongTrackResponse(**r) for r in rows]


# --- Helpers ---


def _find_track(db: Database, track_id: int):
    """Find a track by ID across all sessions."""
    return db.get_track(track_id)


# --- SPA static file serving ---

import os as _os

_static_dir = _os.environ.get("JAM_STATIC_DIR")
if _static_dir:
    _static_path = Path(_static_dir)
    if _static_path.is_dir():
        from fastapi.staticfiles import StaticFiles

        # Serve index.html for the root and any non-file paths (React Router)
        @app.get("/{full_path:path}")
        def spa_catch_all(full_path: str):
            file = _static_path / full_path
            if full_path and file.is_file():
                return FileResponse(file)
            return FileResponse(_static_path / "index.html")
