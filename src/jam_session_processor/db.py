import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

DEFAULT_DB_PATH = Path("jam_sessions.db")

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    source_file TEXT NOT NULL,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tracks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    song_id INTEGER REFERENCES songs(id) ON DELETE SET NULL,
    track_number INTEGER NOT NULL,
    start_sec REAL NOT NULL,
    end_sec REAL NOT NULL,
    duration_sec REAL NOT NULL,
    fingerprint TEXT DEFAULT '',
    audio_path TEXT NOT NULL,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


@dataclass
class Session:
    id: int
    date: str | None
    source_file: str
    notes: str
    created_at: str
    track_count: int = 0
    tagged_count: int = 0


@dataclass
class Track:
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
    created_at: str = ""


@dataclass
class Song:
    id: int
    name: str
    take_count: int = 0


class Database:
    def __init__(self, db_path: Path = DEFAULT_DB_PATH):
        self.db_path = db_path
        self.conn = sqlite3.connect(str(db_path))
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self):
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def close(self):
        self.conn.close()

    def reset(self):
        """Drop all tables and recreate the schema."""
        self.conn.executescript("""
            DROP TABLE IF EXISTS tracks;
            DROP TABLE IF EXISTS songs;
            DROP TABLE IF EXISTS sessions;
        """)
        self._init_schema()

    # --- Sessions ---

    def create_session(self, source_file: str, date: str | None = None, notes: str = "") -> int:
        cur = self.conn.execute(
            "INSERT INTO sessions (source_file, date, notes) VALUES (?, ?, ?)",
            (source_file, date, notes),
        )
        self.conn.commit()
        return cur.lastrowid

    def get_session(self, session_id: int) -> Session | None:
        row = self.conn.execute(
            """SELECT s.*,
                      COUNT(t.id) as track_count,
                      COUNT(t.song_id) as tagged_count
               FROM sessions s
               LEFT JOIN tracks t ON t.session_id = s.id
               WHERE s.id = ?
               GROUP BY s.id""",
            (session_id,),
        ).fetchone()
        if not row:
            return None
        return Session(**row)

    def list_sessions(self) -> list[Session]:
        rows = self.conn.execute(
            """SELECT s.*,
                      COUNT(t.id) as track_count,
                      COUNT(t.song_id) as tagged_count
               FROM sessions s
               LEFT JOIN tracks t ON t.session_id = s.id
               GROUP BY s.id
               ORDER BY s.date DESC, s.id DESC"""
        ).fetchall()
        return [Session(**row) for row in rows]

    def find_session_by_source(self, source_file: str) -> Session | None:
        row = self.conn.execute(
            """SELECT s.*,
                      COUNT(t.id) as track_count,
                      COUNT(t.song_id) as tagged_count
               FROM sessions s
               LEFT JOIN tracks t ON t.session_id = s.id
               WHERE s.source_file = ?
               GROUP BY s.id""",
            (source_file,),
        ).fetchone()
        if not row:
            return None
        return Session(**row)

    # --- Tracks ---

    def create_track(
        self,
        session_id: int,
        track_number: int,
        start_sec: float,
        end_sec: float,
        audio_path: str,
        fingerprint: str = "",
    ) -> int:
        duration_sec = end_sec - start_sec
        cur = self.conn.execute(
            """INSERT INTO tracks
               (session_id, track_number, start_sec, end_sec, duration_sec, fingerprint, audio_path)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (session_id, track_number, start_sec, end_sec, duration_sec, fingerprint, audio_path),
        )
        self.conn.commit()
        return cur.lastrowid

    def get_tracks_for_session(self, session_id: int) -> list[Track]:
        rows = self.conn.execute(
            """SELECT t.*, s.name as song_name
               FROM tracks t
               LEFT JOIN songs s ON t.song_id = s.id
               WHERE t.session_id = ?
               ORDER BY t.track_number""",
            (session_id,),
        ).fetchall()
        return [Track(**row) for row in rows]

    def tag_track(self, track_id: int, song_name: str) -> int:
        """Tag a track with a song name. Creates the song if it doesn't exist. Returns song_id."""
        song_id = self._get_or_create_song(song_name)
        self.conn.execute(
            "UPDATE tracks SET song_id = ? WHERE id = ?",
            (song_id, track_id),
        )
        self.conn.commit()
        return song_id

    def untag_track(self, track_id: int):
        """Remove the song tag from a track."""
        self.conn.execute("UPDATE tracks SET song_id = NULL WHERE id = ?", (track_id,))
        self.conn.commit()

    def update_track_notes(self, track_id: int, notes: str):
        self.conn.execute("UPDATE tracks SET notes = ? WHERE id = ?", (notes, track_id))
        self.conn.commit()

    # --- Songs ---

    def _get_or_create_song(self, name: str) -> int:
        row = self.conn.execute("SELECT id FROM songs WHERE name = ?", (name,)).fetchone()
        if row:
            return row["id"]
        cur = self.conn.execute("INSERT INTO songs (name) VALUES (?)", (name,))
        self.conn.commit()
        return cur.lastrowid

    def list_songs(self) -> list[Song]:
        rows = self.conn.execute(
            """SELECT s.id, s.name, COUNT(t.id) as take_count
               FROM songs s
               LEFT JOIN tracks t ON t.song_id = s.id
               GROUP BY s.id
               ORDER BY s.name"""
        ).fetchall()
        return [Song(**row) for row in rows]

    def get_tracks_for_song(self, song_id: int) -> list[dict]:
        """Get all tracks tagged with a song, including session info."""
        rows = self.conn.execute(
            """SELECT t.*, ses.date as session_date, ses.source_file
               FROM tracks t
               JOIN sessions ses ON t.session_id = ses.id
               WHERE t.song_id = ?
               ORDER BY ses.date DESC, t.track_number""",
            (song_id,),
        ).fetchall()
        return [dict(row) for row in rows]
