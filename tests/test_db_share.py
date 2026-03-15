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
