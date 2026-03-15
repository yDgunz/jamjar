import re
import sqlite3
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
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS songs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    artist TEXT NOT NULL DEFAULT '',
    sheet TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(group_id, name)
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
        self.conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.row_factory = sqlite3.Row
        self._init_schema()

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
                row["name"]
                for row in self.conn.execute(f"PRAGMA table_info({table})").fetchall()
            }
            if "created_by" not in table_cols:
                self.conn.execute(
                    f"ALTER TABLE {table} ADD COLUMN created_by {fk_clause}"
                )
                self.conn.execute(
                    f"ALTER TABLE {table} ADD COLUMN updated_by {fk_clause}"
                )
                self.conn.execute(
                    f"ALTER TABLE {table} ADD COLUMN updated_at TEXT"
                )
                self.conn.commit()

        setlist_song_cols = {
            row["name"]
            for row in self.conn.execute(
                "PRAGMA table_info(setlist_songs)"
            ).fetchall()
        }
        if "added_by" not in setlist_song_cols:
            self.conn.execute(
                f"ALTER TABLE setlist_songs ADD COLUMN added_by {fk_clause}"
            )
            self.conn.commit()

    def close(self):
        self.conn.close()

    def reset(self):
        """Drop all tables and recreate the schema."""
        self.conn.executescript("""
            DROP TABLE IF EXISTS invite_tokens;
            DROP TABLE IF EXISTS activity_log;
            DROP TABLE IF EXISTS setlist_songs;
            DROP TABLE IF EXISTS setlists;
            DROP TABLE IF EXISTS jobs;
            DROP TABLE IF EXISTS share_links;
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
        """Delete a group. CASCADE removes sessions, songs, tracks, and memberships."""
        self.conn.execute("DELETE FROM groups WHERE id = ?", (group_id,))
        self.conn.commit()

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

    def update_session_group(self, session_id: int, new_group_id: int):
        """Move a session to a new group. Retags tracks with equivalent songs in the new group."""
        tracks = self.get_tracks_for_session(session_id)
        for t in tracks:
            if t.song_id and t.song_name:
                new_song_id = self._get_or_create_song(t.song_name, new_group_id)
                self.conn.execute("UPDATE tracks SET song_id = ? WHERE id = ?", (new_song_id, t.id))
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
        self, track_id: int, song_name: str, group_id: int, user_id: int | None = None
    ) -> int:
        """Tag a track with a song name. Creates the song if it doesn't exist. Returns song_id."""
        song_id = self._get_or_create_song(song_name, group_id, created_by=user_id)
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

    def _get_or_create_song(self, name: str, group_id: int, created_by: int | None = None) -> int:
        row = self.conn.execute(
            "SELECT id FROM songs WHERE name = ? AND group_id = ?", (name, group_id)
        ).fetchone()
        if row:
            return row["id"]
        cur = self.conn.execute(
            "INSERT INTO songs (name, group_id, created_by) VALUES (?, ?, ?)",
            (name, group_id, created_by),
        )
        self.conn.commit()
        return cur.lastrowid

    def song_exists_in_group(self, name: str, group_id: int) -> bool:
        row = self.conn.execute(
            "SELECT 1 FROM songs WHERE name = ? AND group_id = ?",
            (name, group_id),
        ).fetchone()
        return row is not None

    def list_songs(self, group_ids: list[int] | None = None) -> list[Song]:
        if group_ids is not None and not group_ids:
            return []
        base = """SELECT s.id, s.group_id, s.name, s.artist, s.sheet, s.notes,
                      COUNT(t.id) as take_count,
                      MIN(ses.date) as first_date, MAX(ses.date) as last_date,
                      s.created_by, s.updated_by, s.updated_at
               FROM songs s
               LEFT JOIN tracks t ON t.song_id = s.id
               LEFT JOIN sessions ses ON t.session_id = ses.id"""
        if group_ids is not None:
            placeholders = ",".join("?" for _ in group_ids)
            base += f" WHERE s.group_id IN ({placeholders})"
            base += " GROUP BY s.id ORDER BY s.name"
            rows = self.conn.execute(base, group_ids).fetchall()
        else:
            base += " GROUP BY s.id ORDER BY s.name"
            rows = self.conn.execute(base).fetchall()
        return [Song(**row) for row in rows]

    def get_song(self, song_id: int) -> Song | None:
        row = self.conn.execute(
            """SELECT s.id, s.group_id, s.name, s.artist, s.sheet, s.notes,
                      COUNT(t.id) as take_count,
                      MIN(ses.date) as first_date, MAX(ses.date) as last_date,
                      s.created_by, s.updated_by, s.updated_at
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

    def update_song_group(self, song_id: int, new_group_id: int):
        """Move a song to a new group.

        Raises ValueError if the target group already has a song with the same name.
        """
        song = self.conn.execute(
            "SELECT name, group_id FROM songs WHERE id = ?", (song_id,)
        ).fetchone()
        if not song:
            raise ValueError("Song not found")
        existing = self.conn.execute(
            "SELECT id FROM songs WHERE name = ? AND group_id = ? AND id != ?",
            (song["name"], new_group_id, song_id),
        ).fetchone()
        if existing:
            raise ValueError(f"A song named '{song['name']}' already exists in that group")
        self.conn.execute("UPDATE songs SET group_id = ? WHERE id = ?", (new_group_id, song_id))
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

    def rename_song(self, song_id: int, new_name: str, updated_by: int | None = None):
        """Rename a song. Raises ValueError if new_name already exists in the same group."""
        # Get the song's group_id for scoped uniqueness check
        song = self.conn.execute("SELECT group_id FROM songs WHERE id = ?", (song_id,)).fetchone()
        if not song:
            raise ValueError(f"Song {song_id} not found")
        existing = self.conn.execute(
            "SELECT id FROM songs WHERE name = ? AND group_id = ? AND id != ?",
            (new_name, song["group_id"], song_id),
        ).fetchone()
        if existing:
            raise ValueError(f"Song '{new_name}' already exists")
        self.conn.execute(
            "UPDATE songs SET name = ?, updated_by = ?, updated_at = datetime('now') WHERE id = ?",
            (new_name, updated_by, song_id),
        )
        self.conn.commit()

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
