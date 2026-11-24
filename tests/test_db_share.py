import pytest

from jam_session_processor.auth import hash_password
from jam_session_processor.db import Database


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
    assert link.track_id == tid
    assert link.created_by == uid
    assert len(link.token) >= 16


def test_create_share_link_returns_existing(seeded_db):
    db, uid, gid, sid, tid = seeded_db
    link1 = db.create_share_link(tid, uid)
    link2 = db.create_share_link(tid, uid)
    assert link1.token == link2.token


def test_get_share_link_by_token(seeded_db):
    db, uid, gid, sid, tid = seeded_db
    link = db.create_share_link(tid, uid)
    fetched = db.get_share_link_by_token(link.token)
    assert fetched is not None
    assert fetched.track_id == tid


def test_get_share_link_by_token_invalid(seeded_db):
    db, uid, gid, sid, tid = seeded_db
    assert db.get_share_link_by_token("nonexistent") is None


def test_get_share_link_by_track(seeded_db):
    db, uid, gid, sid, tid = seeded_db
    db.create_share_link(tid, uid)
    link = db.get_share_link_by_track(tid)
    assert link is not None
    assert link.track_id == tid


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
    assert db.get_share_link_by_token(link.token) is None


def test_share_link_user_delete_sets_null(seeded_db):
    db, uid, gid, sid, tid = seeded_db
    link = db.create_share_link(tid, uid)
    db.delete_user(uid)
    fetched = db.get_share_link_by_token(link.token)
    assert fetched is not None
    assert fetched.created_by is None


def test_old_track_only_table_is_migrated(tmp_path, monkeypatch):
    """Links from before expiry keep working and get the default expiry from now."""
    import sqlite3

    from jam_session_processor.config import reset_config

    monkeypatch.setenv("JAM_SHARE_EXPIRY_DAYS", "30")
    reset_config()
    path = tmp_path / "old.db"
    db = Database(path)
    uid = db.create_user("a@example.com", hash_password("pw"))
    gid = db.create_group("Band")
    sid = db.create_session("r.m4a", gid)
    tid = db.create_track(sid, track_number=1, start_sec=0, end_sec=1, audio_path="t.m4a")
    db.close()
    conn = sqlite3.connect(path)
    conn.executescript(
        """DROP TABLE share_links;
        CREATE TABLE share_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            token TEXT NOT NULL UNIQUE,
            track_id INTEGER NOT NULL UNIQUE REFERENCES tracks(id) ON DELETE CASCADE,
            created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );"""
    )
    conn.execute(
        "INSERT INTO share_links (token, track_id, created_by) VALUES ('tok', ?, ?)", (tid, uid)
    )
    conn.commit()
    conn.close()

    db = Database(path)
    link = db.get_share_link_by_token("tok")
    assert (link.kind, link.track_id, link.group_id, link.created_by) == ("track", tid, gid, uid)
    assert link.expires_at is not None
    from jam_session_processor.db import share_expired

    assert not share_expired(link)
    # And new kinds of link work on the rebuilt table
    assert db.create_share("session", sid, gid, uid).session_id == sid
    reset_config()


def test_shares_cascade_with_their_target(seeded_db):
    db, uid, gid, sid, tid = seeded_db
    song = db._get_or_create_song("Song", gid)
    setlist = db.create_setlist("Gig", gid)
    links = [
        db.create_share("session", sid, gid, uid),
        db.create_share("setlist", setlist, gid, uid),
        db.create_share("song", song, gid, uid),
    ]
    db.delete_setlist(setlist)
    db.delete_song(song)
    db.delete_session(sid)
    assert all(db.get_share_link_by_token(link.token) is None for link in links)


def test_song_share_follows_song_merge(seeded_db):
    db, uid, gid, sid, tid = seeded_db
    keep = db._get_or_create_song("Keep", gid)
    gone = db._get_or_create_song("Gone", gid)
    link = db.create_share("song", gone, gid, uid)
    db.merge_songs(keep, gone)
    assert db.get_share_link_by_token(link.token).song_id == keep


def test_list_shares_titles(seeded_db):
    db, uid, gid, sid, tid = seeded_db
    db.create_share_link(tid, uid, expires_in_days=7)
    [row] = db.list_shares(created_by=uid)
    assert row["title"] == "Track 1"
    assert row["kind"] == "track" and row["target_id"] == tid
    assert row["expired"] is False
    assert db.list_shares(created_by=uid + 1) == []
    assert db.list_shares(group_ids=[gid])[0]["id"] == row["id"]
