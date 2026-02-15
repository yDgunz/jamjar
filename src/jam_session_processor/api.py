from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from jam_session_processor.db import Database

app = FastAPI(title="Jam Session Processor", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
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
    date: str | None
    source_file: str
    notes: str
    track_count: int
    tagged_count: int


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
    take_count: int


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


class TagRequest(BaseModel):
    song_name: str


class NotesRequest(BaseModel):
    notes: str


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


@app.get("/api/sessions/{session_id}/tracks", response_model=list[TrackResponse])
def get_session_tracks(session_id: int):
    db = get_db()
    session = db.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return [TrackResponse(**t.__dict__) for t in db.get_tracks_for_session(session_id)]


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


@app.get("/api/tracks/{track_id}/audio")
def stream_track_audio(track_id: int):
    db = get_db()
    track = _find_track(db, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    audio_path = Path(track.audio_path)
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(audio_path, media_type="audio/wav")


# --- Song endpoints ---


@app.get("/api/songs", response_model=list[SongResponse])
def list_songs():
    db = get_db()
    return [SongResponse(**s.__dict__) for s in db.list_songs()]


@app.get("/api/songs/{song_id}/tracks", response_model=list[SongTrackResponse])
def get_song_tracks(song_id: int):
    db = get_db()
    rows = db.get_tracks_for_song(song_id)
    return [SongTrackResponse(**r) for r in rows]


# --- Helpers ---


def _find_track(db: Database, track_id: int):
    """Find a track by ID across all sessions."""
    row = db.conn.execute(
        """SELECT t.*, s.name as song_name
           FROM tracks t
           LEFT JOIN songs s ON t.song_id = s.id
           WHERE t.id = ?""",
        (track_id,),
    ).fetchone()
    if not row:
        return None
    from jam_session_processor.db import Track
    return Track(**row)
