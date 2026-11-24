import re
import sqlite3
import threading
from dataclasses import dataclass
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'editor',
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS groups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_groups (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, group_id)
);

CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    date TEXT,
    source_file TEXT NOT NULL,
    duration_sec REAL,
    notes TEXT DEFAULT '',
    kind TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    sheet TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    score_path TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(group_id, name)
);

-- Which bands play which song. Songs are a shared catalog; songs.group_id is
-- the song's "home" band and is always also present here.
CREATE TABLE IF NOT EXISTS group_songs (
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (group_id, song_id)
);

CREATE INDEX IF NOT EXISTS idx_group_songs_song ON group_songs(song_id);

-- Reference videos for a song (how-to lessons, backing tracks). Shared by all
-- bands that play the song.
CREATE TABLE IF NOT EXISTS song_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    kind TEXT NOT NULL DEFAULT 'lesson' CHECK(kind IN ('lesson', 'backing_track', 'other')),
    url TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_song_links_song ON song_links(song_id);

-- Per-user song activity, for "recently opened / performed" sorting.
CREATE TABLE IF NOT EXISTS song_activity (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    last_opened_at TEXT,
    last_performed_at TEXT,
    PRIMARY KEY (user_id, song_id)
);

-- Google Drive folders shared with the app's service account, for importing recordings.
-- group_id is the band imports default to (NULL = choose per file).
CREATE TABLE IF NOT EXISTS drive_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    folder_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per Drive file that was imported, skipped, or found to duplicate a recording.
CREATE TABLE IF NOT EXISTS drive_imports (
    drive_file_id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,  -- imported | skipped | duplicate
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Log of the scheduled library-curation routine (new songs, videos, histories).
-- items is a JSON list of {song_id, song_name, action}.
CREATE TABLE IF NOT EXISTS curation_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    summary TEXT NOT NULL DEFAULT '',
    items TEXT NOT NULL DEFAULT '[]',
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
    audio_path TEXT NOT NULL,
    notes TEXT DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL DEFAULT 'upload',
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    progress TEXT NOT NULL DEFAULT '',
    session_id INTEGER REFERENCES sessions(id) ON DELETE SET NULL,
    error TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS setlists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    date TEXT,
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(group_id, name)
);

CREATE TABLE IF NOT EXISTS setlist_songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    setlist_id INTEGER NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    UNIQUE(setlist_id, position)
);

CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    detail TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_event ON activity_log(event_type);
CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at);

CREATE TABLE IF NOT EXISTS share_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    track_id INTEGER NOT NULL UNIQUE REFERENCES tracks(id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invite_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS track_transcripts (
    track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    audio_path TEXT NOT NULL,
    model TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS track_suggestions (
    track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,
    song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
    score REAL NOT NULL,
    source TEXT NOT NULL,
    dismissed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

"""


VALID_ROLES = {"superadmin", "admin", "editor", "readonly"}
# What a recording is; '' means not set
SESSION_KINDS = ("jam", "gig", "demo", "studio")


@dataclass
class User:
    id: int
    email: str
    name: str
    role: str
    password_hash: str
    created_at: str
    last_active_at: str | None = None


@dataclass
class Group:
    id: int
    name: str
    created_at: str
    features: str = ""


@dataclass
class Session:
    id: int
    group_id: int
    name: str
    date: str | None
    source_file: str
    duration_sec: float | None
    notes: str
    created_at: str
    track_count: int = 0
    tagged_count: int = 0
    song_names: str = ""
    active_job_id: str | None = None
    created_by: int | None = None
    updated_by: int | None = None
    updated_at: str | None = None
    kind: str = ""


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
    audio_path: str
    notes: str
    created_at: str = ""


@dataclass
class Song:
    id: int
    group_id: int
    name: str
    artist: str = ""
    sheet: str = ""
    notes: str = ""
    take_count: int = 0
    first_date: str | None = None
    last_date: str | None = None
    created_by: int | None = None
    updated_by: int | None = None
    updated_at: str | None = None
    background: str = ""
    background_sources: str = ""  # JSON list of {title, url}
    created_at: str | None = None
    tab: str = ""
    score_path: str | None = None  # storage key of the notated score (MusicXML), if any


@dataclass
class Job:
    id: str
    type: str
    group_id: int
    status: str
    progress: str
    session_id: int | None
    error: str | None
    created_at: str
    updated_at: str


@dataclass
class Setlist:
    id: int
    group_id: int
    name: str
    date: str | None
    notes: str
    created_at: str
    song_count: int = 0
    created_by: int | None = None
    updated_by: int | None = None
    updated_at: str | None = None


@dataclass
class SetlistSong:
    position: int
    song_id: int
    song_name: str
    artist: str
    sheet: str
    added_by: int | None = None


@dataclass
class ShareLink:
    id: int
    token: str
    track_id: int
    created_by: int | None
    created_at: str


@dataclass
class InviteToken:
    id: int
    token: str
    user_id: int
    expires_at: str
    created_at: str
    used_at: str | None = None


@dataclass
class PasswordResetToken:
    id: int
    token: str
    user_id: int
    expires_at: str
    created_at: str
    used_at: str | None = None


def clean_session_name(source_file: str) -> str:
    """Generate a clean display name from a source filename.

    Strips file extension and date patterns (M-D-YY, M-D-YYYY, YYYY-MM-DD).
    """
    name = Path(source_file).stem
    # Remove date patterns
    name = re.sub(r"\b\d{4}-\d{1,2}-\d{1,2}\b", "", name)  # YYYY-MM-DD
    name = re.sub(r"\b\d{1,2}-\d{1,2}-\d{2,4}\b", "", name)  # M-D-YY or M-D-YYYY
    # Clean up leftover separators and whitespace
    name = re.sub(r"\s*-\s*$", "", name)  # trailing dash
    name = re.sub(r"^\s*-\s*", "", name)  # leading dash
    name = re.sub(r"\s{2,}", " ", name)  # collapse multiple spaces
    return name.strip()


class Database:
    def __init__(self, db_path: Path | None = None):
        if db_path is None:
            from jam_session_processor.config import get_config

            db_path = get_config().db_path
        self.db_path = db_path
        # One connection per thread: FastAPI runs sync endpoints in a thread pool,
        # and a single shared sqlite3 connection breaks under concurrent requests
        # ("bad parameter or other API misuse"). SQLite (WAL) handles the
        # concurrency across connections.
        self._local = threading.local()
        self._all_conns: list[sqlite3.Connection] = []
        self._conns_lock = threading.Lock()
        self._closed = False
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self.db_path), check_same_thread=False, timeout=30)
        conn.execute("PRAGMA foreign_keys = ON")
        conn.row_factory = sqlite3.Row
        return conn

    @property
    def conn(self) -> sqlite3.Connection:
        """This thread's connection (created on first use)."""
        if self._closed:
            raise sqlite3.ProgrammingError("Cannot operate on a closed database.")
        conn = getattr(self._local, "conn", None)
        if conn is None:
            conn = self._connect()
            self._local.conn = conn
            with self._conns_lock:
                self._all_conns.append(conn)
        return conn

    @conn.setter
    def conn(self, value: sqlite3.Connection):
        self._closed = False
        self._local.conn = value
        with self._conns_lock:
            self._all_conns.append(value)

    def ping(self) -> None:
        """Run a trivial query against the schema; raises if the DB is unusable."""
        self.conn.execute("SELECT 1 FROM users LIMIT 1").fetchall()

    def _init_schema(self):
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript(SCHEMA)
        self.conn.commit()
        self._migrate()

    def _migrate(self):
        cols = {row["name"] for row in self.conn.execute("PRAGMA table_info(users)").fetchall()}
        if "role" not in cols:
            self.conn.execute("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'editor'")
            self.conn.commit()

        track_cols = {
            row["name"] for row in self.conn.execute("PRAGMA table_info(tracks)").fetchall()
        }
        if "fingerprint" in track_cols:
            self.conn.execute("ALTER TABLE tracks DROP COLUMN fingerprint")
            self.conn.commit()

        session_cols = {
            row["name"] for row in self.conn.execute("PRAGMA table_info(sessions)").fetchall()
        }
        if "duration_sec" not in session_cols:
            self.conn.execute("ALTER TABLE sessions ADD COLUMN duration_sec REAL")
            self.conn.commit()
        if "kind" not in session_cols:
            self.conn.execute("ALTER TABLE sessions ADD COLUMN kind TEXT NOT NULL DEFAULT ''")
            self.conn.commit()

        song_cols = {
            row["name"] for row in self.conn.execute("PRAGMA table_info(songs)").fetchall()
        }
        if "artist" not in song_cols:
            self.conn.execute("ALTER TABLE songs ADD COLUMN artist TEXT NOT NULL DEFAULT ''")
            self.conn.commit()

        if "last_active_at" not in cols:
            self.conn.execute("ALTER TABLE users ADD COLUMN last_active_at TEXT")
            self.conn.commit()

        # Add creator/updater tracking columns
        fk_clause = "INTEGER REFERENCES users(id) ON DELETE SET NULL"
        for table in ("sessions", "songs", "setlists"):
            table_cols = {
                row["name"] for row in self.conn.execute(f"PRAGMA table_info({table})").fetchall()
            }
            if "created_by" not in table_cols:
                self.conn.execute(f"ALTER TABLE {table} ADD COLUMN created_by {fk_clause}")
                self.conn.execute(f"ALTER TABLE {table} ADD COLUMN updated_by {fk_clause}")
                self.conn.execute(f"ALTER TABLE {table} ADD COLUMN updated_at TEXT")
                self.conn.commit()

        setlist_song_cols = {
            row["name"] for row in self.conn.execute("PRAGMA table_info(setlist_songs)").fetchall()
        }
        if "added_by" not in setlist_song_cols:
            self.conn.execute(f"ALTER TABLE setlist_songs ADD COLUMN added_by {fk_clause}")
            self.conn.commit()

        group_cols = {
            row["name"] for row in self.conn.execute("PRAGMA table_info(groups)").fetchall()
        }
        if "features" not in group_cols:
            self.conn.execute("ALTER TABLE groups ADD COLUMN features TEXT NOT NULL DEFAULT ''")
            self.conn.commit()

        # Song background ("About" tab): paragraph with [n] markers + JSON sources
        song_cols = {r["name"] for r in self.conn.execute("PRAGMA table_info(songs)").fetchall()}
        if "background" not in song_cols:
            self.conn.execute("ALTER TABLE songs ADD COLUMN background TEXT NOT NULL DEFAULT ''")
            self.conn.execute(
                "ALTER TABLE songs ADD COLUMN background_sources TEXT NOT NULL DEFAULT ''"
            )
            self.conn.commit()
        if "tab" not in song_cols:
            # Guitar tablature (intros, riffs, solos), kept apart from the chords/lyrics chart
            self.conn.execute("ALTER TABLE songs ADD COLUMN tab TEXT NOT NULL DEFAULT ''")
            self.conn.commit()
        if "score_path" not in song_cols:
            # Notated sheet music: storage key of an uploaded MusicXML file
            self.conn.execute("ALTER TABLE songs ADD COLUMN score_path TEXT")
            self.conn.commit()

        # Shared song catalog: every song is linked to its home band.
        self.conn.execute(
            "INSERT OR IGNORE INTO group_songs (group_id, song_id) SELECT group_id, id FROM songs"
        )
        self.conn.commit()

    def close(self):
        """Close every thread's connection."""
        with self._conns_lock:
            conns, self._all_conns = self._all_conns, []
        for conn in conns:
            try:
                conn.close()
            except sqlite3.Error:
                pass
        self._local = threading.local()
        self._closed = True

    def reset(self):
        """Drop all tables and recreate the schema."""
        self.conn.executescript("""
            DROP TABLE IF EXISTS event_responses;
            DROP TABLE IF EXISTS events;
            DROP TABLE IF EXISTS invite_tokens;
            DROP TABLE IF EXISTS activity_log;
            DROP TABLE IF EXISTS song_activity;
            DROP TABLE IF EXISTS song_links;
            DROP TABLE IF EXISTS group_songs;
            DROP TABLE IF EXISTS setlist_songs;
            DROP TABLE IF EXISTS setlists;
            DROP TABLE IF EXISTS jobs;
            DROP TABLE IF EXISTS share_links;
            DROP TABLE IF EXISTS track_suggestions;
            DROP TABLE IF EXISTS track_transcripts;
            DROP TABLE IF EXISTS tracks;
            DROP TABLE IF EXISTS songs;
            DROP TABLE IF EXISTS sessions;
            DROP TABLE IF EXISTS user_groups;
            DROP TABLE IF EXISTS groups;
            DROP TABLE IF EXISTS users;
        """)
        self._init_schema()

    # --- Activity tracking ---

    def update_last_active(self, user_id: int):
        self.conn.execute(
            "UPDATE users SET last_active_at = datetime('now') WHERE id = ?", (user_id,)
        )
        self.conn.commit()

    def log_activity(
        self, user_id: int, group_id: int | None, event_type: str, detail: str | None = None
    ):
        self.conn.execute(
            "INSERT INTO activity_log (user_id, group_id, event_type, detail) VALUES (?, ?, ?, ?)",
            (user_id, group_id, event_type, detail),
        )
        self.conn.commit()

    # --- Google Drive import ---

    def add_drive_folder(
        self, folder_id: str, name: str, group_id: int | None, created_by: int | None
    ) -> int:
        cur = self.conn.execute(
            "INSERT INTO drive_folders (folder_id, name, group_id, created_by) VALUES (?, ?, ?, ?)",
            (folder_id, name, group_id, created_by),
        )
        self.conn.commit()
        return cur.lastrowid

    def list_drive_folders(self) -> list[dict]:
        rows = self.conn.execute(
            "SELECT f.id, f.folder_id, f.name, f.group_id, g.name AS group_name, f.created_at"
            " FROM drive_folders f LEFT JOIN groups g ON g.id = f.group_id ORDER BY f.name"
        ).fetchall()
        return [dict(r) for r in rows]

    def get_drive_folder(self, folder_pk: int) -> dict | None:
        row = self.conn.execute(
            "SELECT f.id, f.folder_id, f.name, f.group_id, g.name AS group_name, f.created_at"
            " FROM drive_folders f LEFT JOIN groups g ON g.id = f.group_id WHERE f.id = ?",
            (folder_pk,),
        ).fetchone()
        return dict(row) if row else None

    def update_drive_folder_group(self, folder_pk: int, group_id: int | None):
        self.conn.execute(
            "UPDATE drive_folders SET group_id = ? WHERE id = ?", (group_id, folder_pk)
        )
        self.conn.commit()

    def delete_drive_folder(self, folder_pk: int):
        self.conn.execute("DELETE FROM drive_folders WHERE id = ?", (folder_pk,))
        self.conn.commit()

    def get_drive_imports(self, file_ids: list[str]) -> dict[str, dict]:
        if not file_ids:
            return {}
        out: dict[str, dict] = {}
        for i in range(0, len(file_ids), 500):
            chunk = file_ids[i : i + 500]
            rows = self.conn.execute(
                "SELECT d.drive_file_id, d.status, d.session_id, d.group_id, s.name AS session_name"
                " FROM drive_imports d LEFT JOIN sessions s ON s.id = d.session_id"
                f" WHERE d.drive_file_id IN ({','.join('?' * len(chunk))})",
                chunk,
            ).fetchall()
            out.update({r["drive_file_id"]: dict(r) for r in rows})
        return out

    def set_drive_import(
        self,
        drive_file_id: str,
        status: str,
        file_name: str = "",
        session_id: int | None = None,
        group_id: int | None = None,
        created_by: int | None = None,
    ):
        self.conn.execute(
            "INSERT INTO drive_imports"
            " (drive_file_id, file_name, status, session_id, group_id, created_by)"
            " VALUES (?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(drive_file_id) DO UPDATE SET status = excluded.status,"
            " file_name = excluded.file_name, session_id = excluded.session_id,"
            " group_id = excluded.group_id, created_by = excluded.created_by,"
            " created_at = datetime('now')",
            (drive_file_id, file_name, status, session_id, group_id, created_by),
        )
        self.conn.commit()

    def clear_drive_import(self, drive_file_id: str):
        self.conn.execute("DELETE FROM drive_imports WHERE drive_file_id = ?", (drive_file_id,))
        self.conn.commit()

    def storage_references(self) -> tuple[list[dict], list[dict]]:
        """Every session's source file and every track's audio path, for storage stats."""
        sessions = self.conn.execute(
            "SELECT s.id, s.name, s.date, s.source_file, s.duration_sec, g.name AS group_name"
            " FROM sessions s LEFT JOIN groups g ON g.id = s.group_id"
        ).fetchall()
        tracks = self.conn.execute("SELECT session_id, audio_path FROM tracks").fetchall()
        return [dict(r) for r in sessions], [dict(r) for r in tracks]

    def add_curation_run(self, summary: str, items_json: str) -> int:
        cur = self.conn.execute(
            "INSERT INTO curation_runs (summary, items) VALUES (?, ?)", (summary, items_json)
        )
        self.conn.commit()
        return cur.lastrowid

    def list_curation_runs(self, limit: int = 50) -> list[dict]:
        rows = self.conn.execute(
            "SELECT id, summary, items, created_at FROM curation_runs ORDER BY id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_activity_stats(self) -> dict:
        """Return per-user stats and recent activity for the admin stats page."""
        # Per-user event counts
        user_rows = self.conn.execute(
            """SELECT u.id, u.email, u.name, u.last_active_at,
                      al.event_type, COUNT(al.id) as cnt
               FROM users u
               LEFT JOIN activity_log al ON al.user_id = u.id
               GROUP BY u.id, al.event_type
               ORDER BY u.email"""
        ).fetchall()
        users: dict[int, dict] = {}
        for row in user_rows:
            uid = row["id"]
            if uid not in users:
                users[uid] = {
                    "id": uid,
                    "email": row["email"],
                    "name": row["name"],
                    "last_active_at": row["last_active_at"],
                    "event_counts": {},
                }
            if row["event_type"]:
                users[uid]["event_counts"][row["event_type"]] = row["cnt"]

        # Recent activity
        recent = self.conn.execute(
            """SELECT u.name as user_name, al.event_type, al.detail, al.created_at
               FROM activity_log al
               JOIN users u ON al.user_id = u.id
               ORDER BY al.created_at DESC
               LIMIT 50"""
        ).fetchall()

        # Totals
        session_count = self.conn.execute("SELECT COUNT(*) as cnt FROM sessions").fetchone()["cnt"]
        song_count = self.conn.execute("SELECT COUNT(*) as cnt FROM songs").fetchone()["cnt"]
        setlist_count = self.conn.execute("SELECT COUNT(*) as cnt FROM setlists").fetchone()["cnt"]

        return {
            "users": list(users.values()),
            "recent_activity": [dict(r) for r in recent],
            "totals": {
                "sessions": session_count,
                "songs": song_count,
                "setlists": setlist_count,
            },
        }

    # --- Users ---

    def create_user(
        self, email: str, password_hash: str, name: str = "", role: str = "editor"
    ) -> int:
        email = email.strip()
        if role not in VALID_ROLES:
            valid = ", ".join(sorted(VALID_ROLES))
            raise ValueError(f"Invalid role '{role}'. Must be one of: {valid}")
        cur = self.conn.execute(
            "INSERT INTO users (email, password_hash, name, role) VALUES (?, ?, ?, ?)",
            (email, password_hash, name, role),
        )
        self.conn.commit()
        return cur.lastrowid

    def get_user_name(self, user_id: int | None) -> str | None:
        """Return the display name for a user, or None if user_id is None/not found."""
        if user_id is None:
            return None
        row = self.conn.execute("SELECT name, email FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            return None
        return row["name"] or row["email"]

    def get_user_by_email(self, email: str) -> User | None:
        email = email.strip()
        row = self.conn.execute(
            "SELECT * FROM users WHERE LOWER(email) = LOWER(?)", (email,)
        ).fetchone()
        if not row:
            return None
        return User(**row)

    def get_user(self, user_id: int) -> User | None:
        row = self.conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        if not row:
            return None
        return User(**row)

    def list_users(self) -> list[User]:
        rows = self.conn.execute("SELECT * FROM users ORDER BY email").fetchall()
        return [User(**row) for row in rows]

    def update_user_password(self, user_id: int, password_hash: str):
        self.conn.execute(
            "UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id)
        )
        self.conn.commit()

    def update_user_name(self, user_id: int, name: str):
        self.conn.execute("UPDATE users SET name = ? WHERE id = ?", (name, user_id))
        self.conn.commit()

    def update_user_role(self, user_id: int, role: str):
        if role not in VALID_ROLES:
            valid = ", ".join(sorted(VALID_ROLES))
            raise ValueError(f"Invalid role '{role}'. Must be one of: {valid}")
        self.conn.execute("UPDATE users SET role = ? WHERE id = ?", (role, user_id))
        self.conn.commit()

    def delete_user(self, user_id: int):
        """Delete a user. CASCADE removes user_groups memberships."""
        self.conn.execute("DELETE FROM users WHERE id = ?", (user_id,))
        self.conn.commit()

    # --- Groups ---

    def create_group(self, name: str) -> int:
        cur = self.conn.execute("INSERT INTO groups (name) VALUES (?)", (name,))
        self.conn.commit()
        return cur.lastrowid

    def get_group(self, group_id: int) -> Group | None:
        row = self.conn.execute("SELECT * FROM groups WHERE id = ?", (group_id,)).fetchone()
        if not row:
            return None
        return Group(**row)

    def get_group_by_name(self, name: str) -> Group | None:
        row = self.conn.execute("SELECT * FROM groups WHERE name = ?", (name,)).fetchone()
        if not row:
            return None
        return Group(**row)

    def list_groups(self) -> list[Group]:
        rows = self.conn.execute("SELECT * FROM groups ORDER BY name").fetchall()
        return [Group(**row) for row in rows]

    def delete_group(self, group_id: int):
        """Delete a group. CASCADE removes sessions, tracks, memberships and songs
        that only this group plays; songs other groups also play are re-homed."""
        self.conn.execute(
            """UPDATE songs SET group_id = (
                   SELECT MIN(gs.group_id) FROM group_songs gs
                   WHERE gs.song_id = songs.id AND gs.group_id != ?)
               WHERE group_id = ? AND EXISTS (
                   SELECT 1 FROM group_songs gs
                   WHERE gs.song_id = songs.id AND gs.group_id != ?)""",
            (group_id, group_id, group_id),
        )
        self.conn.execute("DELETE FROM groups WHERE id = ?", (group_id,))
        self.conn.commit()

    def update_group_features(self, group_id: int, features: str):
        self.conn.execute("UPDATE groups SET features = ? WHERE id = ?", (features, group_id))
        self.conn.commit()

    def group_has_feature(self, group_id: int, feature: str) -> bool:
        row = self.conn.execute("SELECT features FROM groups WHERE id = ?", (group_id,)).fetchone()
        if not row or not row["features"]:
            return False
        return feature in row["features"].split(",")

    # --- Membership ---

    def assign_user_to_group(self, user_id: int, group_id: int):
        self.conn.execute(
            "INSERT OR IGNORE INTO user_groups (user_id, group_id) VALUES (?, ?)",
            (user_id, group_id),
        )
        self.conn.commit()

    def remove_user_from_group(self, user_id: int, group_id: int):
        self.conn.execute(
            "DELETE FROM user_groups WHERE user_id = ? AND group_id = ?",
            (user_id, group_id),
        )
        self.conn.commit()

    def get_user_groups(self, user_id: int) -> list[Group]:
        rows = self.conn.execute(
            """SELECT g.* FROM groups g
               JOIN user_groups ug ON ug.group_id = g.id
               WHERE ug.user_id = ?
               ORDER BY g.name""",
            (user_id,),
        ).fetchall()
        return [Group(**row) for row in rows]

    def get_group_ids_for_user(self, user_id: int) -> list[int]:
        rows = self.conn.execute(
            "SELECT group_id FROM user_groups WHERE user_id = ?", (user_id,)
        ).fetchall()
        return [row["group_id"] for row in rows]

    def get_users_for_group(self, group_id: int) -> list[User]:
        rows = self.conn.execute(
            """SELECT u.* FROM users u
               JOIN user_groups ug ON ug.user_id = u.id
               WHERE ug.group_id = ?
               ORDER BY u.name""",
            (group_id,),
        ).fetchall()
        return [User(**row) for row in rows]

    def get_group_member_count(self, group_id: int) -> int:
        row = self.conn.execute(
            "SELECT COUNT(*) as cnt FROM user_groups WHERE group_id = ?",
            (group_id,),
        ).fetchone()
        return row["cnt"]

    # --- Sessions ---

    def create_session(
        self,
        source_file: str,
        group_id: int,
        date: str | None = None,
        notes: str = "",
        created_by: int | None = None,
    ) -> int:
        name = clean_session_name(source_file)
        cur = self.conn.execute(
            "INSERT INTO sessions (group_id, name, source_file, date, notes, created_by)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (group_id, name, source_file, date, notes, created_by),
        )
        self.conn.commit()
        return cur.lastrowid

    def update_session_name(self, session_id: int, name: str, updated_by: int | None = None):
        self.conn.execute(
            "UPDATE sessions SET name = ?, updated_by = ?,"
            " updated_at = datetime('now') WHERE id = ?",
            (name, updated_by, session_id),
        )
        self.conn.commit()

    def get_session(self, session_id: int) -> Session | None:
        row = self.conn.execute(
            """SELECT s.*,
                      COUNT(t.id) as track_count,
                      COUNT(t.song_id) as tagged_count,
                      COALESCE((SELECT GROUP_CONCAT(DISTINCT s2.name)
                                FROM tracks t2 JOIN songs s2 ON t2.song_id = s2.id
                                WHERE t2.session_id = s.id), '') as song_names,
                      (SELECT j.id FROM jobs j
                       WHERE j.session_id = s.id
                         AND j.status IN ('pending', 'processing')
                       ORDER BY j.created_at DESC LIMIT 1
                      ) as active_job_id
               FROM sessions s
               LEFT JOIN tracks t ON t.session_id = s.id
               WHERE s.id = ?
               GROUP BY s.id""",
            (session_id,),
        ).fetchone()
        if not row:
            return None
        return Session(**row)

    def list_sessions(self, group_ids: list[int] | None = None) -> list[Session]:
        if group_ids is not None and not group_ids:
            return []
        base = """SELECT s.*,
                      COUNT(t.id) as track_count,
                      COUNT(t.song_id) as tagged_count,
                      COALESCE((SELECT GROUP_CONCAT(DISTINCT s2.name)
                                FROM tracks t2 JOIN songs s2 ON t2.song_id = s2.id
                                WHERE t2.session_id = s.id), '') as song_names,
                      (SELECT j.id FROM jobs j
                       WHERE j.session_id = s.id
                         AND j.status IN ('pending', 'processing')
                       ORDER BY j.created_at DESC LIMIT 1
                      ) as active_job_id
               FROM sessions s
               LEFT JOIN tracks t ON t.session_id = s.id"""
        if group_ids is not None:
            placeholders = ",".join("?" for _ in group_ids)
            base += f" WHERE s.group_id IN ({placeholders})"
            base += " GROUP BY s.id ORDER BY s.date DESC, s.id DESC"
            rows = self.conn.execute(base, group_ids).fetchall()
        else:
            base += " GROUP BY s.id ORDER BY s.date DESC, s.id DESC"
            rows = self.conn.execute(base).fetchall()
        return [Session(**row) for row in rows]

    def find_session_by_source(self, source_file: str, group_id: int) -> Session | None:
        row = self.conn.execute(
            """SELECT s.*,
                      COUNT(t.id) as track_count,
                      COUNT(t.song_id) as tagged_count,
                      COALESCE((SELECT GROUP_CONCAT(DISTINCT s2.name)
                                FROM tracks t2 JOIN songs s2 ON t2.song_id = s2.id
                                WHERE t2.session_id = s.id), '') as song_names,
                      (SELECT j.id FROM jobs j
                       WHERE j.session_id = s.id
                         AND j.status IN ('pending', 'processing')
                       ORDER BY j.created_at DESC LIMIT 1
                      ) as active_job_id
               FROM sessions s
               LEFT JOIN tracks t ON t.session_id = s.id
               WHERE s.source_file = ? AND s.group_id = ?
               GROUP BY s.id""",
            (source_file, group_id),
        ).fetchone()
        if not row:
            return None
        return Session(**row)

    def delete_session(self, session_id: int):
        """Delete a session and its tracks (DB only).

        File cleanup is the caller's responsibility.
        """
        self.conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        self.conn.commit()

    def update_session_date(self, session_id: int, date: str | None, updated_by: int | None = None):
        self.conn.execute(
            "UPDATE sessions SET date = ?, updated_by = ?,"
            " updated_at = datetime('now') WHERE id = ?",
            (date, updated_by, session_id),
        )
        self.conn.commit()

    def update_session_notes(self, session_id: int, notes: str, updated_by: int | None = None):
        self.conn.execute(
            "UPDATE sessions SET notes = ?, updated_by = ?,"
            " updated_at = datetime('now') WHERE id = ?",
            (notes, updated_by, session_id),
        )
        self.conn.commit()

    def update_session_kind(self, session_id: int, kind: str, updated_by: int | None = None):
        if kind not in SESSION_KINDS and kind != "":
            raise ValueError(f"Unknown recording type: {kind}")
        self.conn.execute(
            "UPDATE sessions SET kind = ?, updated_by = ?,"
            " updated_at = datetime('now') WHERE id = ?",
            (kind, updated_by, session_id),
        )
        self.conn.commit()

    def move_track(
        self,
        track_id: int,
        session_id: int,
        track_number: int,
        start_sec: float,
        end_sec: float,
        audio_path: str,
    ):
        """Re-home a track (used when recordings are merged). Tag, notes and
        share link stay with the track."""
        self.conn.execute(
            "UPDATE tracks SET session_id = ?, track_number = ?, start_sec = ?,"
            " end_sec = ?, audio_path = ? WHERE id = ?",
            (session_id, track_number, start_sec, end_sec, audio_path, track_id),
        )
        self.conn.commit()

    def finish_session_merge(
        self,
        target_id: int,
        merged_ids: list[int],
        source_file: str,
        duration_sec: float,
        notes: str,
        updated_by: int | None = None,
    ):
        """Point the kept recording at its new combined source and drop the
        recordings merged into it (their tracks must already have been moved)."""
        marks = self._in(merged_ids)
        self.conn.execute(
            "UPDATE sessions SET source_file = ?, duration_sec = ?, notes = ?,"
            " updated_by = ?, updated_at = datetime('now') WHERE id = ?",
            (source_file, duration_sec, notes, updated_by, target_id),
        )
        self.conn.execute(
            f"UPDATE drive_imports SET session_id = ? WHERE session_id IN ({marks})",
            [target_id, *merged_ids],
        )
        self.conn.execute(f"DELETE FROM sessions WHERE id IN ({marks})", merged_ids)
        self.conn.commit()

    def update_session_group(self, session_id: int, new_group_id: int):
        """Move a session to a new group. Tagged songs are linked to the new group
        (or retagged to a same-named song that group already plays)."""
        tracks = self.get_tracks_for_session(session_id)
        for t in tracks:
            if t.song_id and t.song_name:
                existing = self.find_song_in_groups(t.song_name, [new_group_id])
                if existing and existing != t.song_id:
                    self.conn.execute(
                        "UPDATE tracks SET song_id = ? WHERE id = ?", (existing, t.id)
                    )
                else:
                    self._link(t.song_id, new_group_id)
        self.conn.execute(
            "UPDATE sessions SET group_id = ? WHERE id = ?", (new_group_id, session_id)
        )
        self.conn.commit()

    def update_session_source_file(self, session_id: int, source_file: str):
        self.conn.execute(
            "UPDATE sessions SET source_file = ? WHERE id = ?", (source_file, session_id)
        )
        self.conn.commit()

    def update_session_duration(self, session_id: int, duration_sec: float):
        self.conn.execute(
            "UPDATE sessions SET duration_sec = ? WHERE id = ?", (duration_sec, session_id)
        )
        self.conn.commit()

    def find_duplicate_session(
        self, group_id: int, duration_sec: float, exclude_session_id: int | None = None
    ) -> Session | None:
        """Find a session in the same group with exactly matching duration."""
        where = "s.group_id = ? AND s.duration_sec = ?"
        params: list = [group_id, duration_sec]
        if exclude_session_id is not None:
            where += " AND s.id != ?"
            params.append(exclude_session_id)
        row = self.conn.execute(
            f"""SELECT s.*,
                      COUNT(t.id) as track_count,
                      COUNT(t.song_id) as tagged_count,
                      COALESCE((SELECT GROUP_CONCAT(DISTINCT s2.name)
                                FROM tracks t2 JOIN songs s2 ON t2.song_id = s2.id
                                WHERE t2.session_id = s.id), '') as song_names,
                      (SELECT j.id FROM jobs j
                       WHERE j.session_id = s.id
                         AND j.status IN ('pending', 'processing')
                       ORDER BY j.created_at DESC LIMIT 1
                      ) as active_job_id
               FROM sessions s
               LEFT JOIN tracks t ON t.session_id = s.id
               WHERE {where}
               GROUP BY s.id
               LIMIT 1""",
            params,
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
    ) -> int:
        duration_sec = end_sec - start_sec
        cur = self.conn.execute(
            """INSERT INTO tracks
               (session_id, track_number, start_sec, end_sec, duration_sec, audio_path)
               VALUES (?, ?, ?, ?, ?, ?)""",
            (session_id, track_number, start_sec, end_sec, duration_sec, audio_path),
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

    def tag_track(
        self,
        track_id: int,
        song_name: str,
        group_id: int,
        user_id: int | None = None,
        visible_group_ids: list[int] | None = None,
    ) -> int:
        """Tag a track with a song name. Reuses a same-named song from the group (or
        from the caller's other groups, linking it); otherwise creates one."""
        song_id = self._get_or_create_song(
            song_name, group_id, created_by=user_id, visible_group_ids=visible_group_ids
        )
        self.conn.execute(
            "UPDATE tracks SET song_id = ? WHERE id = ?",
            (song_id, track_id),
        )
        self.conn.execute("DELETE FROM track_suggestions WHERE track_id = ?", (track_id,))
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

    # --- Song suggestions (speech-to-text matching, see identify.py) ---

    def tracks_needing_transcript(self) -> list[sqlite3.Row]:
        """Tracks with no transcript of their current audio, newest recordings first."""
        return self.conn.execute(
            """SELECT t.id, t.audio_path
               FROM tracks t
               JOIN sessions s ON s.id = t.session_id
               LEFT JOIN track_transcripts tt ON tt.track_id = t.id
               WHERE tt.track_id IS NULL OR tt.audio_path != t.audio_path
               ORDER BY s.date DESC, s.id DESC, t.track_number"""
        ).fetchall()

    def save_transcript(self, track_id: int, audio_path: str, model: str, text: str):
        self.conn.execute(
            """INSERT INTO track_transcripts (track_id, audio_path, model, text)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(track_id) DO UPDATE SET audio_path = excluded.audio_path,
                 model = excluded.model, text = excluded.text, created_at = datetime('now')""",
            (track_id, audio_path, model, text),
        )
        self.conn.commit()

    def get_transcripts(self) -> list[sqlite3.Row]:
        """Current transcripts: track_id, song_id (tag), group_id, text."""
        return self.conn.execute(
            """SELECT t.id AS track_id, t.song_id, s.group_id, tt.text
               FROM track_transcripts tt
               JOIN tracks t ON t.id = tt.track_id AND t.audio_path = tt.audio_path
               JOIN sessions s ON s.id = t.session_id"""
        ).fetchall()

    def get_song_sheets(self) -> list[tuple[int, str]]:
        rows = self.conn.execute("SELECT id, sheet FROM songs WHERE sheet != ''").fetchall()
        return [(r["id"], r["sheet"]) for r in rows]

    def get_group_song_links(self) -> list[tuple[int, int]]:
        rows = self.conn.execute("SELECT group_id, song_id FROM group_songs").fetchall()
        return [(r["group_id"], r["song_id"]) for r in rows]

    def has_active_jobs(self) -> bool:
        row = self.conn.execute("SELECT 1 FROM jobs WHERE status = 'processing' LIMIT 1").fetchone()
        return row is not None

    def set_suggestion(self, track_id: int, song_id: int, score: float, source: str):
        """Store a track's suggested song. A dismissed suggestion stays dismissed while
        the suggestion is still the same song."""
        self.conn.execute(
            """INSERT INTO track_suggestions (track_id, song_id, score, source)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(track_id) DO UPDATE SET
                 dismissed = CASE WHEN song_id = excluded.song_id THEN dismissed ELSE 0 END,
                 song_id = excluded.song_id, score = excluded.score,
                 source = excluded.source, created_at = datetime('now')""",
            (track_id, song_id, score, source),
        )
        self.conn.commit()

    def clear_suggestion(self, track_id: int) -> bool:
        """Drop a suggestion that no longer holds (dismissed ones are kept)."""
        cur = self.conn.execute(
            "DELETE FROM track_suggestions WHERE track_id = ? AND dismissed = 0", (track_id,)
        )
        self.conn.commit()
        return cur.rowcount > 0

    def dismiss_suggestion(self, track_id: int):
        self.conn.execute(
            "UPDATE track_suggestions SET dismissed = 1 WHERE track_id = ?", (track_id,)
        )
        self.conn.commit()

    def get_suggestions(
        self, session_id: int | None = None, track_id: int | None = None
    ) -> dict[int, dict]:
        """Open suggestions for untagged tracks, keyed by track id."""
        where, params = "", []
        if session_id is not None:
            where, params = " AND t.session_id = ?", [session_id]
        elif track_id is not None:
            where, params = " AND t.id = ?", [track_id]
        rows = self.conn.execute(
            """SELECT ts.track_id, ts.song_id, s.name AS song_name, ts.score, ts.source
               FROM track_suggestions ts
               JOIN tracks t ON t.id = ts.track_id
               JOIN songs s ON s.id = ts.song_id
               WHERE ts.dismissed = 0 AND t.song_id IS NULL"""
            + where,
            params,
        ).fetchall()
        return {r["track_id"]: {k: r[k] for k in r.keys() if k != "track_id"} for r in rows}

    def get_identification_stats(self) -> dict:
        one = lambda sql: self.conn.execute(sql).fetchone()[0]  # noqa: E731
        return {
            "tracks": one("SELECT COUNT(*) FROM tracks"),
            "untagged": one("SELECT COUNT(*) FROM tracks WHERE song_id IS NULL"),
            "pending_transcripts": len(self.tracks_needing_transcript()),
            "suggestions": len(self.get_suggestions()),
            "last_transcribed_at": one("SELECT MAX(created_at) FROM track_transcripts"),
        }

    def delete_track(self, track_id: int):
        """Delete a track by ID."""
        self.conn.execute("DELETE FROM tracks WHERE id = ?", (track_id,))
        self.conn.commit()

    def update_track(self, track_id: int, **kwargs):
        """Update arbitrary columns on a track. Valid keys: track_number, start_sec,
        end_sec, duration_sec, audio_path, song_id, notes."""
        allowed = {
            "track_number",
            "start_sec",
            "end_sec",
            "duration_sec",
            "audio_path",
            "song_id",
            "notes",
        }
        updates = {k: v for k, v in kwargs.items() if k in allowed}
        if not updates:
            return
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [track_id]
        self.conn.execute(f"UPDATE tracks SET {set_clause} WHERE id = ?", values)
        self.conn.commit()

    # --- Share links ---

    def create_share_link(self, track_id: int, created_by: int | None) -> ShareLink | None:
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

    def get_share_link_by_token(self, token: str) -> ShareLink | None:
        row = self.conn.execute("SELECT * FROM share_links WHERE token = ?", (token,)).fetchone()
        return ShareLink(**row) if row else None

    def get_share_link_by_track(self, track_id: int) -> ShareLink | None:
        row = self.conn.execute(
            "SELECT * FROM share_links WHERE track_id = ?", (track_id,)
        ).fetchone()
        return ShareLink(**row) if row else None

    def delete_share_link(self, track_id: int):
        self.conn.execute("DELETE FROM share_links WHERE track_id = ?", (track_id,))
        self.conn.commit()

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

    def get_invite_token(self, token: str) -> InviteToken | None:
        """Get an invite token record. Returns None if not found."""
        row = self.conn.execute("SELECT * FROM invite_tokens WHERE token = ?", (token,)).fetchone()
        return InviteToken(**row) if row else None

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

    # --- Password reset tokens ---

    def create_password_reset_token(self, user_id: int, expires_hours: int = 1) -> str:
        """Create a password reset token for a user. Returns the token string."""
        import secrets
        from datetime import datetime, timedelta, timezone

        # Delete any existing tokens for this user
        self.conn.execute("DELETE FROM password_reset_tokens WHERE user_id = ?", (user_id,))
        token = secrets.token_urlsafe(32)
        expires_at = (datetime.now(timezone.utc) + timedelta(hours=expires_hours)).strftime(
            "%Y-%m-%d %H:%M:%S"
        )
        self.conn.execute(
            "INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?, ?, ?)",
            (token, user_id, expires_at),
        )
        self.conn.commit()
        return token

    def get_password_reset_token(self, token: str) -> PasswordResetToken | None:
        """Get a password reset token record. Returns None if not found."""
        row = self.conn.execute(
            "SELECT * FROM password_reset_tokens WHERE token = ?", (token,)
        ).fetchone()
        return PasswordResetToken(**row) if row else None

    def consume_password_reset_token(self, token: str):
        """Mark a password reset token as used."""
        self.conn.execute(
            "UPDATE password_reset_tokens SET used_at = datetime('now') WHERE token = ?",
            (token,),
        )
        self.conn.commit()

    # --- Songs ---
    #
    # Songs are a shared catalog. `group_songs` records which groups play each
    # song (with per-group notes); a user sees a song if any of their groups is
    # linked to it. `songs.group_id` is the song's home group, which is always
    # linked too. Song names are unique per group (case-insensitive) across links.

    @staticmethod
    def _in(ids: list[int]) -> str:
        return ",".join("?" for _ in ids)

    def _link(self, song_id: int, group_id: int):
        self.conn.execute(
            "INSERT OR IGNORE INTO group_songs (group_id, song_id) VALUES (?, ?)",
            (group_id, song_id),
        )

    def find_song_in_groups(self, name: str, group_ids: list[int]) -> int | None:
        """Id of a song with this name (case-insensitive) played by any of
        `group_ids`, preferring the first group listed."""
        for gid in group_ids:
            row = self.conn.execute(
                """SELECT s.id FROM songs s JOIN group_songs gs ON gs.song_id = s.id
                   WHERE gs.group_id = ? AND s.name = ? COLLATE NOCASE
                   ORDER BY s.id LIMIT 1""",
                (gid, name.strip()),
            ).fetchone()
            if row:
                return row["id"]
        return None

    def _get_or_create_song(
        self,
        name: str,
        group_id: int,
        created_by: int | None = None,
        visible_group_ids: list[int] | None = None,
    ) -> int:
        """Return the song `group_id` plays with this name; else link a same-named
        song from `visible_group_ids`; else create a new song homed in `group_id`."""
        name = name.strip()
        existing = self.find_song_in_groups(name, [group_id])
        if existing:
            return existing
        others = [g for g in (visible_group_ids or []) if g != group_id]
        shared = self.find_song_in_groups(name, others) if others else None
        if shared:
            self._link(shared, group_id)
            self.conn.commit()
            return shared
        cur = self.conn.execute(
            "INSERT INTO songs (name, group_id, created_by) VALUES (?, ?, ?)",
            (name, group_id, created_by),
        )
        self._link(cur.lastrowid, group_id)
        self.conn.commit()
        return cur.lastrowid

    def song_exists_in_group(self, name: str, group_id: int) -> bool:
        return self.find_song_in_groups(name, [group_id]) is not None

    def _song_query(self, where: str, params: list, group_ids: list[int] | None) -> list:
        """Songs with take counts/dates limited to sessions in `group_ids` (all if None)."""
        take_filter = ""
        take_params: list = []
        if group_ids is not None:
            take_filter = (
                f" AND t.session_id IN (SELECT id FROM sessions WHERE group_id IN"
                f" ({self._in(group_ids)}))"
            )
            take_params = list(group_ids)
        sql = f"""SELECT s.id, s.group_id, s.name, s.artist, s.sheet, s.notes,
                      COUNT(t.id) as take_count,
                      MIN(ses.date) as first_date, MAX(ses.date) as last_date,
                      s.created_by, s.updated_by, s.updated_at,
                      s.background, s.background_sources, s.created_at, s.tab, s.score_path
               FROM songs s
               LEFT JOIN tracks t ON t.song_id = s.id{take_filter}
               LEFT JOIN sessions ses ON t.session_id = ses.id
               WHERE {where}
               GROUP BY s.id ORDER BY s.name"""
        return self.conn.execute(sql, take_params + params).fetchall()

    def list_songs(self, group_ids: list[int] | None = None) -> list[Song]:
        """Songs played by any of `group_ids` (all songs if None)."""
        if group_ids is not None and not group_ids:
            return []
        if group_ids is None:
            rows = self._song_query("1 = 1", [], None)
        else:
            rows = self._song_query(
                f"s.id IN (SELECT song_id FROM group_songs WHERE group_id IN"
                f" ({self._in(group_ids)}))",
                list(group_ids),
                group_ids,
            )
        return [Song(**row) for row in rows]

    def get_song(self, song_id: int, group_ids: list[int] | None = None) -> Song | None:
        """A song by id. Take counts/dates cover sessions in `group_ids` (all if None)."""
        rows = self._song_query("s.id = ?", [song_id], group_ids)
        return Song(**rows[0]) if rows else None

    def get_song_groups(self, song_id: int) -> list[dict]:
        """Groups that play a song: [{id, name, notes}], home group first."""
        rows = self.conn.execute(
            """SELECT g.id, g.name, gs.notes FROM group_songs gs
               JOIN groups g ON g.id = gs.group_id
               JOIN songs s ON s.id = gs.song_id
               WHERE gs.song_id = ?
               ORDER BY (g.id = s.group_id) DESC, g.name""",
            (song_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def link_song_to_group(self, song_id: int, group_id: int):
        """Mark that `group_id` also plays this song.

        Raises ValueError if that group already plays a different song with the
        same name (merge them instead)."""
        song = self.conn.execute("SELECT name FROM songs WHERE id = ?", (song_id,)).fetchone()
        if not song:
            raise ValueError("Song not found")
        other = self.find_song_in_groups(song["name"], [group_id])
        if other and other != song_id:
            raise ValueError(f"That group already has a song named '{song['name']}'")
        self._link(song_id, group_id)
        self.conn.commit()

    def unlink_song_from_group(self, song_id: int, group_id: int):
        """Stop listing a song for a group. Its recorded takes are kept.

        Raises ValueError if it's the song's only group (delete the song instead)."""
        groups = [g["id"] for g in self.get_song_groups(song_id)]
        if group_id not in groups:
            return
        if len(groups) == 1:
            raise ValueError("A song must belong to at least one group")
        self.conn.execute(
            "DELETE FROM group_songs WHERE song_id = ? AND group_id = ?", (song_id, group_id)
        )
        new_home = next(g for g in groups if g != group_id)
        self.conn.execute(
            "UPDATE songs SET group_id = ? WHERE id = ? AND group_id = ?",
            (new_home, song_id, group_id),
        )
        self.conn.commit()

    def set_group_song_notes(self, song_id: int, group_id: int, notes: str):
        self.conn.execute(
            "UPDATE group_songs SET notes = ? WHERE song_id = ? AND group_id = ?",
            (notes, song_id, group_id),
        )
        self.conn.commit()

    def update_song_details(
        self,
        song_id: int,
        sheet: str,
        notes: str,
        artist: str = "",
        updated_by: int | None = None,
    ):
        self.conn.execute(
            "UPDATE songs SET artist = ?, sheet = ?, notes = ?,"
            " updated_by = ?, updated_at = datetime('now')"
            " WHERE id = ?",
            (artist, sheet, notes, updated_by, song_id),
        )
        self.conn.commit()

    def set_song_tab(self, song_id: int, tab: str, updated_by: int | None = None):
        self.conn.execute(
            "UPDATE songs SET tab = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?",
            (tab, updated_by, song_id),
        )
        self.conn.commit()

    def set_song_score(self, song_id: int, score_path: str | None, updated_by: int | None = None):
        """Set (or clear, with None) the storage key of a song's notated score."""
        self.conn.execute(
            "UPDATE songs SET score_path = ?, updated_by = ?, updated_at = datetime('now')"
            " WHERE id = ?",
            (score_path, updated_by, song_id),
        )
        self.conn.commit()

    def score_paths(self) -> set[str]:
        """Storage keys of every song's notated score."""
        rows = self.conn.execute(
            "SELECT score_path FROM songs WHERE score_path IS NOT NULL"
        ).fetchall()
        return {row["score_path"] for row in rows}

    def set_song_background(self, song_id: int, text: str, sources_json: str):
        """Set (or clear, with empty text) a song's "About" background."""
        self.conn.execute(
            "UPDATE songs SET background = ?, background_sources = ? WHERE id = ?",
            (text, sources_json if text else "", song_id),
        )
        self.conn.commit()

    def update_song_group(self, song_id: int, new_group_id: int):
        """Move a song's home to `new_group_id` (linking it there and unlinking the
        old home group).

        Raises ValueError if the target group already has a song with the same name.
        """
        song = self.conn.execute(
            "SELECT name, group_id FROM songs WHERE id = ?", (song_id,)
        ).fetchone()
        if not song:
            raise ValueError("Song not found")
        if song["group_id"] == new_group_id:
            return
        other = self.find_song_in_groups(song["name"], [new_group_id])
        if other and other != song_id:
            raise ValueError(f"A song named '{song['name']}' already exists in that group")
        old_group = song["group_id"]
        self._link(song_id, new_group_id)
        self.conn.execute("UPDATE songs SET group_id = ? WHERE id = ?", (new_group_id, song_id))
        self.conn.execute(
            "DELETE FROM group_songs WHERE song_id = ? AND group_id = ?", (song_id, old_group)
        )
        self.conn.commit()

    def get_tracks_for_song(self, song_id: int, group_ids: list[int] | None = None) -> list[dict]:
        """Tracks tagged with a song (in sessions of `group_ids`, or all): studio
        recordings first, then newest first."""
        group_filter = ""
        params: list = [song_id]
        if group_ids is not None:
            if not group_ids:
                return []
            group_filter = f" AND ses.group_id IN ({self._in(group_ids)})"
            params += list(group_ids)
        rows = self.conn.execute(
            f"""SELECT t.id, t.session_id, t.track_number,
                      t.start_sec, t.end_sec, t.duration_sec,
                      t.audio_path, t.notes,
                      ses.date as session_date, ses.source_file,
                      ses.name as session_name, ses.kind as session_kind
               FROM tracks t
               JOIN sessions ses ON t.session_id = ses.id
               WHERE t.song_id = ?{group_filter}
               ORDER BY (ses.kind = 'studio') DESC, ses.date DESC, t.track_number""",
            params,
        ).fetchall()
        return [dict(row) for row in rows]

    def delete_song(self, song_id: int):
        """Delete a song. Tracks referencing it will have song_id set to NULL."""
        self.conn.execute("DELETE FROM songs WHERE id = ?", (song_id,))
        self.conn.commit()

    def rename_song(self, song_id: int, new_name: str, updated_by: int | None = None):
        """Rename a song. Raises ValueError if a group that plays it already has
        another song with that name."""
        groups = [g["id"] for g in self.get_song_groups(song_id)]
        if (
            not groups
            and not self.conn.execute("SELECT 1 FROM songs WHERE id = ?", (song_id,)).fetchone()
        ):
            raise ValueError(f"Song {song_id} not found")
        for gid in groups:
            other = self.find_song_in_groups(new_name, [gid])
            if other and other != song_id:
                raise ValueError(f"Song '{new_name}' already exists")
        self.conn.execute(
            "UPDATE songs SET name = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?",
            (new_name, updated_by, song_id),
        )
        self.conn.commit()

    def merge_songs(self, keep_id: int, merge_id: int):
        """Fold song `merge_id` into `keep_id`: takes, setlist entries and group
        links move over; the kept song's artist/chart/notes/score win unless empty.
        `merge_id` is deleted."""
        if keep_id == merge_id:
            raise ValueError("Cannot merge a song into itself")
        keep = self.conn.execute("SELECT * FROM songs WHERE id = ?", (keep_id,)).fetchone()
        merge = self.conn.execute("SELECT * FROM songs WHERE id = ?", (merge_id,)).fetchone()
        if not keep or not merge:
            raise ValueError("Song not found")
        with self.conn:
            self.conn.execute(
                "UPDATE tracks SET song_id = ? WHERE song_id = ?", (keep_id, merge_id)
            )
            self.conn.execute(
                "UPDATE setlist_songs SET song_id = ? WHERE song_id = ?", (keep_id, merge_id)
            )
            self.conn.execute(
                "UPDATE song_links SET song_id = ? WHERE song_id = ?", (keep_id, merge_id)
            )
            self.conn.execute(
                """INSERT INTO song_activity (user_id, song_id, last_opened_at, last_performed_at)
                   SELECT user_id, ?, last_opened_at, last_performed_at
                   FROM song_activity WHERE song_id = ?
                   ON CONFLICT(user_id, song_id) DO UPDATE SET
                     last_opened_at = MAX(COALESCE(last_opened_at, ''),
                                          COALESCE(excluded.last_opened_at, '')),
                     last_performed_at = MAX(COALESCE(last_performed_at, ''),
                                             COALESCE(excluded.last_performed_at, ''))""",
                (keep_id, merge_id),
            )
            for link in self.conn.execute(
                "SELECT group_id, notes FROM group_songs WHERE song_id = ?", (merge_id,)
            ).fetchall():
                # The merged song's notes were band-specific: carry them to that band
                notes = link["notes"] or merge["notes"]
                self.conn.execute(
                    "INSERT OR IGNORE INTO group_songs (group_id, song_id, notes) VALUES (?, ?, ?)",
                    (link["group_id"], keep_id, notes),
                )
                if notes:
                    self.conn.execute(
                        "UPDATE group_songs SET notes = ? WHERE group_id = ? AND song_id = ?"
                        " AND notes = ''",
                        (notes, link["group_id"], keep_id),
                    )
            self.conn.execute(
                """UPDATE songs SET
                       artist = CASE WHEN artist = '' THEN ? ELSE artist END,
                       sheet = CASE WHEN sheet = '' THEN ? ELSE sheet END,
                       tab = CASE WHEN tab = '' THEN ? ELSE tab END,
                       score_path = COALESCE(score_path, ?),
                       background_sources = CASE WHEN background = ''
                                            THEN ? ELSE background_sources END,
                       background = CASE WHEN background = '' THEN ? ELSE background END,
                       updated_at = datetime('now')
                   WHERE id = ?""",
                (
                    merge["artist"],
                    merge["sheet"],
                    merge["tab"],
                    merge["score_path"],
                    merge["background_sources"],
                    merge["background"],
                    keep_id,
                ),
            )
            self.conn.execute("DELETE FROM songs WHERE id = ?", (merge_id,))

    # --- Song links (reference videos) ---

    def add_song_link(
        self, song_id: int, kind: str, url: str, title: str = "", created_by: int | None = None
    ) -> int:
        cur = self.conn.execute(
            "INSERT INTO song_links (song_id, kind, url, title, created_by) VALUES (?, ?, ?, ?, ?)",
            (song_id, kind, url, title, created_by),
        )
        self.conn.commit()
        return cur.lastrowid

    def list_song_links(self, song_id: int) -> list[dict]:
        rows = self.conn.execute(
            """SELECT id, song_id, kind, url, title, created_by, created_at
               FROM song_links WHERE song_id = ?
               ORDER BY CASE kind WHEN 'lesson' THEN 0 WHEN 'backing_track' THEN 1 ELSE 2 END,
                        id""",
            (song_id,),
        ).fetchall()
        return [dict(r) for r in rows]

    def get_song_link(self, link_id: int) -> dict | None:
        row = self.conn.execute("SELECT * FROM song_links WHERE id = ?", (link_id,)).fetchone()
        return dict(row) if row else None

    def delete_song_link(self, link_id: int):
        self.conn.execute("DELETE FROM song_links WHERE id = ?", (link_id,))
        self.conn.commit()

    # --- Per-user song activity ---

    _ACTIVITY_COLUMNS = {"opened": "last_opened_at", "performed": "last_performed_at"}

    def record_song_activity(self, user_id: int, song_id: int, event: str):
        """Stamp `event` ("opened" or "performed") for this user and song as now."""
        col = self._ACTIVITY_COLUMNS[event]
        self.conn.execute(
            f"""INSERT INTO song_activity (user_id, song_id, {col})
                VALUES (?, ?, datetime('now'))
                ON CONFLICT(user_id, song_id) DO UPDATE SET {col} = datetime('now')""",
            (user_id, song_id),
        )
        self.conn.commit()

    def get_song_activity(self, user_id: int) -> dict[int, dict]:
        """{song_id: {last_opened_at, last_performed_at}} for one user."""
        rows = self.conn.execute(
            "SELECT song_id, last_opened_at, last_performed_at FROM song_activity"
            " WHERE user_id = ?",
            (user_id,),
        ).fetchall()
        return {
            r["song_id"]: {
                "last_opened_at": r["last_opened_at"] or None,
                "last_performed_at": r["last_performed_at"] or None,
            }
            for r in rows
        }

    # --- Jobs ---

    def create_job(
        self, job_id: str, group_id: int, job_type: str = "upload", session_id: int | None = None
    ) -> Job:
        self.conn.execute(
            "INSERT INTO jobs (id, type, group_id, session_id) VALUES (?, ?, ?, ?)",
            (job_id, job_type, group_id, session_id),
        )
        self.conn.commit()
        return self.get_job(job_id)

    def get_job(self, job_id: str) -> Job | None:
        row = self.conn.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            return None
        return Job(**row)

    def update_job_progress(self, job_id: str, progress: str):
        self.conn.execute(
            "UPDATE jobs SET status = 'processing', progress = ?,"
            " updated_at = datetime('now') WHERE id = ?",
            (progress, job_id),
        )
        self.conn.commit()

    def complete_job(self, job_id: str, session_id: int):
        self.conn.execute(
            "UPDATE jobs SET status = 'completed', session_id = ?,"
            " updated_at = datetime('now') WHERE id = ?",
            (session_id, job_id),
        )
        self.conn.commit()

    def fail_interrupted_jobs(self, stale_pending_hours: int = 2) -> int:
        """Fail jobs a previous server process left unfinished.

        'processing' jobs can't still be running after a restart. 'pending' jobs are
        only failed once stale: a presigned upload stays pending while the browser
        uploads straight to storage, which a restart doesn't interrupt.
        """
        cur = self.conn.execute(
            "UPDATE jobs SET status = 'failed',"
            " error = 'Interrupted by a server restart. Re-split the recording to try again.',"
            " updated_at = datetime('now')"
            " WHERE status = 'processing'"
            " OR (status = 'pending' AND created_at < datetime('now', ?))",
            (f"-{stale_pending_hours} hours",),
        )
        self.conn.commit()
        return cur.rowcount

    def fail_job(self, job_id: str, error: str):
        self.conn.execute(
            "UPDATE jobs SET status = 'failed', error = ?,"
            " updated_at = datetime('now') WHERE id = ?",
            (error, job_id),
        )
        self.conn.commit()

    def update_job_status(self, job_id: str, status: str):
        self.conn.execute(
            "UPDATE jobs SET status = ?, updated_at = datetime('now') WHERE id = ?",
            (status, job_id),
        )
        self.conn.commit()

    # --- Setlists ---

    def create_setlist(
        self,
        name: str,
        group_id: int,
        date: str | None = None,
        notes: str = "",
        created_by: int | None = None,
    ) -> int:
        cur = self.conn.execute(
            "INSERT INTO setlists (name, group_id, date, notes, created_by) VALUES (?, ?, ?, ?, ?)",
            (name, group_id, date, notes, created_by),
        )
        self.conn.commit()
        return cur.lastrowid

    def get_setlist(self, setlist_id: int) -> Setlist | None:
        row = self.conn.execute(
            """SELECT sl.*,
                      COUNT(ss.id) as song_count
               FROM setlists sl
               LEFT JOIN setlist_songs ss ON ss.setlist_id = sl.id
               WHERE sl.id = ?
               GROUP BY sl.id""",
            (setlist_id,),
        ).fetchone()
        if not row:
            return None
        return Setlist(**row)

    def setlist_exists_in_group(self, name: str, group_id: int) -> bool:
        row = self.conn.execute(
            "SELECT 1 FROM setlists WHERE name = ? AND group_id = ?",
            (name, group_id),
        ).fetchone()
        return row is not None

    def list_setlists(self, group_ids: list[int] | None = None) -> list[Setlist]:
        if group_ids is not None and not group_ids:
            return []
        base = """SELECT sl.*,
                      COUNT(ss.id) as song_count
               FROM setlists sl
               LEFT JOIN setlist_songs ss ON ss.setlist_id = sl.id"""
        if group_ids is not None:
            placeholders = ",".join("?" for _ in group_ids)
            base += f" WHERE sl.group_id IN ({placeholders})"
            base += " GROUP BY sl.id ORDER BY sl.date DESC, sl.name"
            rows = self.conn.execute(base, group_ids).fetchall()
        else:
            base += " GROUP BY sl.id ORDER BY sl.date DESC, sl.name"
            rows = self.conn.execute(base).fetchall()
        return [Setlist(**row) for row in rows]

    def update_setlist_name(self, setlist_id: int, name: str, updated_by: int | None = None):
        """Rename a setlist. Raises ValueError if name already exists in the same group."""
        sl = self.conn.execute(
            "SELECT group_id FROM setlists WHERE id = ?", (setlist_id,)
        ).fetchone()
        if not sl:
            raise ValueError(f"Setlist {setlist_id} not found")
        existing = self.conn.execute(
            "SELECT id FROM setlists WHERE name = ? AND group_id = ? AND id != ?",
            (name, sl["group_id"], setlist_id),
        ).fetchone()
        if existing:
            raise ValueError(f"Setlist '{name}' already exists")
        self.conn.execute(
            "UPDATE setlists SET name = ?, updated_by = ?,"
            " updated_at = datetime('now') WHERE id = ?",
            (name, updated_by, setlist_id),
        )
        self.conn.commit()

    def update_setlist_date(self, setlist_id: int, date: str | None, updated_by: int | None = None):
        self.conn.execute(
            "UPDATE setlists SET date = ?, updated_by = ?,"
            " updated_at = datetime('now') WHERE id = ?",
            (date, updated_by, setlist_id),
        )
        self.conn.commit()

    def update_setlist_notes(self, setlist_id: int, notes: str, updated_by: int | None = None):
        self.conn.execute(
            "UPDATE setlists SET notes = ?, updated_by = ?,"
            " updated_at = datetime('now') WHERE id = ?",
            (notes, updated_by, setlist_id),
        )
        self.conn.commit()

    def delete_setlist(self, setlist_id: int):
        """Delete a setlist. CASCADE handles the join table."""
        self.conn.execute("DELETE FROM setlists WHERE id = ?", (setlist_id,))
        self.conn.commit()

    def get_setlist_songs(self, setlist_id: int) -> list[SetlistSong]:
        rows = self.conn.execute(
            """SELECT ss.position, ss.song_id, s.name as song_name,
                      s.artist, s.sheet, ss.added_by
               FROM setlist_songs ss
               JOIN songs s ON ss.song_id = s.id
               WHERE ss.setlist_id = ?
               ORDER BY ss.position""",
            (setlist_id,),
        ).fetchall()
        return [SetlistSong(**row) for row in rows]

    def set_setlist_songs(
        self, setlist_id: int, song_ids: list[int], updated_by: int | None = None
    ):
        """Replace the full song list with sequential positions (idempotent).

        Preserves added_by for songs that remain in the list.
        """
        # Capture existing added_by values
        existing = {
            row["song_id"]: row["added_by"]
            for row in self.conn.execute(
                "SELECT song_id, added_by FROM setlist_songs WHERE setlist_id = ?",
                (setlist_id,),
            ).fetchall()
        }
        self.conn.execute("DELETE FROM setlist_songs WHERE setlist_id = ?", (setlist_id,))
        for i, song_id in enumerate(song_ids, start=1):
            added_by = existing.get(song_id, updated_by)
            self.conn.execute(
                "INSERT INTO setlist_songs (setlist_id, song_id, position, added_by)"
                " VALUES (?, ?, ?, ?)",
                (setlist_id, song_id, i, added_by),
            )
        self.conn.commit()

    def add_song_to_setlist(
        self,
        setlist_id: int,
        song_id: int,
        position: int | None = None,
        added_by: int | None = None,
    ):
        """Add a song at a given position (or append to the end)."""
        if position is None:
            row = self.conn.execute(
                "SELECT COALESCE(MAX(position), 0) as max_pos"
                " FROM setlist_songs WHERE setlist_id = ?",
                (setlist_id,),
            ).fetchone()
            position = row["max_pos"] + 1
        else:
            # Shift existing songs at or after this position
            self.conn.execute(
                "UPDATE setlist_songs SET position = position + 1"
                " WHERE setlist_id = ? AND position >= ?",
                (setlist_id, position),
            )
        self.conn.execute(
            "INSERT INTO setlist_songs"
            " (setlist_id, song_id, position, added_by)"
            " VALUES (?, ?, ?, ?)",
            (setlist_id, song_id, position, added_by),
        )
        self.conn.commit()

    def remove_song_from_setlist(self, setlist_id: int, position: int):
        """Remove the song at a given position and renumber remaining songs."""
        self.conn.execute(
            "DELETE FROM setlist_songs WHERE setlist_id = ? AND position = ?",
            (setlist_id, position),
        )
        # Renumber: close the gap
        self.conn.execute(
            "UPDATE setlist_songs SET position = position - 1"
            " WHERE setlist_id = ? AND position > ?",
            (setlist_id, position),
        )
        self.conn.commit()
