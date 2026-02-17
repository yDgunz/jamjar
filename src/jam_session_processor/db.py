import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    date TEXT,
    source_file TEXT NOT NULL,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    chart TEXT NOT NULL DEFAULT '',
    lyrics TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
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
    name: str
    date: str | None
    source_file: str
    notes: str
    created_at: str
    track_count: int = 0
    tagged_count: int = 0
    song_names: str = ""


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
    chart: str = ""
    lyrics: str = ""
    notes: str = ""
    take_count: int = 0
    first_date: str | None = None
    last_date: str | None = None


def clean_session_name(source_file: str) -> str:
    """Generate a clean display name from a source filename.

    Strips file extension and date patterns (M-D-YY, M-D-YYYY, YYYY-MM-DD).
    """
    name = Path(source_file).stem
    # Remove date patterns
    name = re.sub(r'\b\d{4}-\d{1,2}-\d{1,2}\b', '', name)  # YYYY-MM-DD
    name = re.sub(r'\b\d{1,2}-\d{1,2}-\d{2,4}\b', '', name)  # M-D-YY or M-D-YYYY
    # Clean up leftover separators and whitespace
    name = re.sub(r'\s*-\s*$', '', name)  # trailing dash
    name = re.sub(r'^\s*-\s*', '', name)  # leading dash
    name = re.sub(r'\s{2,}', ' ', name)  # collapse multiple spaces
    return name.strip()


class Database:
    def __init__(self, db_path: Path | None = None):
        if db_path is None:
            from jam_session_processor.config import get_config
            db_path = get_config().db_path
        self.db_path = db_path
        self.conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.row_factory = sqlite3.Row
        self._init_schema()

    def _init_schema(self):
        self.conn.executescript(SCHEMA)
        self._migrate()
        self.conn.commit()

    def _migrate(self):
        """Run any needed migrations on existing databases."""
        # Add 'name' column if missing (pre-existing DBs)
        cols = [r[1] for r in self.conn.execute("PRAGMA table_info(sessions)").fetchall()]
        if "name" not in cols:
            self.conn.execute("ALTER TABLE sessions ADD COLUMN name TEXT NOT NULL DEFAULT ''")
            # Backfill names from source_file
            for row in self.conn.execute("SELECT id, source_file FROM sessions").fetchall():
                name = clean_session_name(row[1])
                self.conn.execute("UPDATE sessions SET name = ? WHERE id = ?", (name, row[0]))

        # Add song metadata columns if missing
        song_cols = [r[1] for r in self.conn.execute("PRAGMA table_info(songs)").fetchall()]
        for col in ("chart", "lyrics", "notes"):
            if col not in song_cols:
                self.conn.execute(f"ALTER TABLE songs ADD COLUMN {col} TEXT NOT NULL DEFAULT ''")

        # Drop waveform_peaks column if present (unused)
        track_cols = [r[1] for r in self.conn.execute("PRAGMA table_info(tracks)").fetchall()]
        if "waveform_peaks" in track_cols:
            self.conn.execute("ALTER TABLE tracks DROP COLUMN waveform_peaks")

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
        name = clean_session_name(source_file)
        cur = self.conn.execute(
            "INSERT INTO sessions (name, source_file, date, notes) VALUES (?, ?, ?, ?)",
            (name, source_file, date, notes),
        )
        self.conn.commit()
        return cur.lastrowid

    def update_session_name(self, session_id: int, name: str):
        self.conn.execute("UPDATE sessions SET name = ? WHERE id = ?", (name, session_id))
        self.conn.commit()

    def get_session(self, session_id: int) -> Session | None:
        row = self.conn.execute(
            """SELECT s.*,
                      COUNT(t.id) as track_count,
                      COUNT(t.song_id) as tagged_count,
                      COALESCE((SELECT GROUP_CONCAT(DISTINCT s2.name)
                                FROM tracks t2 JOIN songs s2 ON t2.song_id = s2.id
                                WHERE t2.session_id = s.id), '') as song_names
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
                      COUNT(t.song_id) as tagged_count,
                      COALESCE((SELECT GROUP_CONCAT(DISTINCT s2.name)
                                FROM tracks t2 JOIN songs s2 ON t2.song_id = s2.id
                                WHERE t2.session_id = s.id), '') as song_names
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
                      COUNT(t.song_id) as tagged_count,
                      COALESCE((SELECT GROUP_CONCAT(DISTINCT s2.name)
                                FROM tracks t2 JOIN songs s2 ON t2.song_id = s2.id
                                WHERE t2.session_id = s.id), '') as song_names
               FROM sessions s
               LEFT JOIN tracks t ON t.session_id = s.id
               WHERE s.source_file = ?
               GROUP BY s.id""",
            (source_file,),
        ).fetchone()
        if not row:
            return None
        return Session(**row)

    def delete_session(self, session_id: int, delete_files: bool = False):
        """Delete a session and its tracks. Optionally delete audio files."""
        if delete_files:
            from jam_session_processor.config import get_config
            cfg = get_config()
            tracks = self.get_tracks_for_session(session_id)
            for t in tracks:
                try:
                    cfg.resolve_path(t.audio_path).unlink(missing_ok=True)
                except OSError:
                    pass
        self.conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        self.conn.commit()

    def update_session_date(self, session_id: int, date: str | None):
        self.conn.execute("UPDATE sessions SET date = ? WHERE id = ?", (date, session_id))
        self.conn.commit()

    def update_session_notes(self, session_id: int, notes: str):
        self.conn.execute("UPDATE sessions SET notes = ? WHERE id = ?", (notes, session_id))
        self.conn.commit()

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

    def get_track(self, track_id: int) -> Track | None:
        """Fetch a single track by ID."""
        row = self.conn.execute(
            """SELECT t.*, s.name as song_name
               FROM tracks t
               LEFT JOIN songs s ON t.song_id = s.id
               WHERE t.id = ?""",
            (track_id,),
        ).fetchone()
        if not row:
            return None
        return Track(**row)

    def delete_track(self, track_id: int):
        """Delete a track by ID."""
        self.conn.execute("DELETE FROM tracks WHERE id = ?", (track_id,))
        self.conn.commit()

    def update_track(self, track_id: int, **kwargs):
        """Update arbitrary columns on a track. Valid keys: track_number, start_sec,
        end_sec, duration_sec, audio_path, fingerprint, song_id, notes."""
        allowed = {"track_number", "start_sec", "end_sec", "duration_sec",
                    "audio_path", "fingerprint", "song_id", "notes"}
        updates = {k: v for k, v in kwargs.items() if k in allowed}
        if not updates:
            return
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [track_id]
        self.conn.execute(f"UPDATE tracks SET {set_clause} WHERE id = ?", values)
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
            """SELECT s.id, s.name, s.chart, s.lyrics, s.notes,
                      COUNT(t.id) as take_count,
                      MIN(ses.date) as first_date, MAX(ses.date) as last_date
               FROM songs s
               LEFT JOIN tracks t ON t.song_id = s.id
               LEFT JOIN sessions ses ON t.session_id = ses.id
               GROUP BY s.id
               ORDER BY s.name"""
        ).fetchall()
        return [Song(**row) for row in rows]

    def get_song(self, song_id: int) -> Song | None:
        row = self.conn.execute(
            """SELECT s.id, s.name, s.chart, s.lyrics, s.notes,
                      COUNT(t.id) as take_count,
                      MIN(ses.date) as first_date, MAX(ses.date) as last_date
               FROM songs s
               LEFT JOIN tracks t ON t.song_id = s.id
               LEFT JOIN sessions ses ON t.session_id = ses.id
               WHERE s.id = ?
               GROUP BY s.id""",
            (song_id,),
        ).fetchone()
        if not row:
            return None
        return Song(**row)

    def update_song_details(self, song_id: int, chart: str, lyrics: str, notes: str):
        self.conn.execute(
            "UPDATE songs SET chart = ?, lyrics = ?, notes = ? WHERE id = ?",
            (chart, lyrics, notes, song_id),
        )
        self.conn.commit()

    def get_tracks_for_song(self, song_id: int) -> list[dict]:
        """Get all tracks tagged with a song, including session info."""
        rows = self.conn.execute(
            """SELECT t.id, t.session_id, t.track_number,
                      t.start_sec, t.end_sec, t.duration_sec,
                      t.audio_path, t.notes,
                      ses.date as session_date, ses.source_file,
                      ses.name as session_name
               FROM tracks t
               JOIN sessions ses ON t.session_id = ses.id
               WHERE t.song_id = ?
               ORDER BY ses.date DESC, t.track_number""",
            (song_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    def delete_song(self, song_id: int):
        """Delete a song. Tracks referencing it will have song_id set to NULL."""
        self.conn.execute("DELETE FROM songs WHERE id = ?", (song_id,))
        self.conn.commit()

    def rename_song(self, song_id: int, new_name: str):
        """Rename a song. Raises ValueError if new_name already exists."""
        existing = self.conn.execute(
            "SELECT id FROM songs WHERE name = ? AND id != ?", (new_name, song_id)
        ).fetchone()
        if existing:
            raise ValueError(f"Song '{new_name}' already exists")
        self.conn.execute("UPDATE songs SET name = ? WHERE id = ?", (new_name, song_id))
        self.conn.commit()
