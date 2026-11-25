"""Tests for the fixes from the tech-debt and security audit."""

import sqlite3

import pytest
from fastapi.testclient import TestClient

from jam_session_processor import api
from jam_session_processor.auth import hash_password
from tests.test_api import _create_user_and_group, auth_client, client  # noqa: F401

# --- A failed write must not leave the connection in a transaction ---


def test_failed_write_is_rolled_back(client):  # noqa: F811
    db = api._db
    db.create_user("dup@example.com", hash_password("password"))
    with pytest.raises(sqlite3.IntegrityError):
        db.create_user("dup@example.com", hash_password("password"))
    assert not db.conn.in_transaction

    # Another connection can write straight away (the lock was released)
    other = sqlite3.connect(str(db.db_path), timeout=0.5)
    try:
        other.execute("INSERT INTO groups (name) VALUES ('Other')")
        other.commit()
    finally:
        other.close()


def test_failed_write_does_not_commit_earlier_statements(auth_client):  # noqa: F811
    http, _uid, gid = auth_client
    db = api._db
    song_id = http.post("/api/songs", json={"name": "One", "group_id": gid}).json()["id"]
    setlist_id = db.create_setlist("Set", gid)
    db.set_setlist_songs(setlist_id, [song_id])
    # The DELETE runs, then an INSERT fails on the unknown song: nothing may change
    with pytest.raises(sqlite3.IntegrityError):
        db.set_setlist_songs(setlist_id, [song_id, 999_999])
    db.create_group("Later")  # an unrelated commit on the same connection
    assert [s.song_id for s in db.get_setlist_songs(setlist_id)] == [song_id]


# --- Inserting into the middle of a setlist ---


def test_add_song_in_the_middle_of_a_setlist(auth_client):  # noqa: F811
    http, _uid, gid = auth_client
    ids = [
        http.post("/api/songs", json={"name": n, "group_id": gid}).json()["id"]
        for n in ("A", "B", "C", "New")
    ]
    setlist_id = http.post("/api/setlists", json={"name": "Set", "group_id": gid}).json()["id"]
    http.put(f"/api/setlists/{setlist_id}/songs", json={"song_ids": ids[:3]})

    resp = http.post(f"/api/setlists/{setlist_id}/songs", json={"song_id": ids[3], "position": 1})
    assert resp.status_code == 200
    assert [(s["position"], s["song_id"]) for s in resp.json()] == [
        (1, ids[3]),
        (2, ids[0]),
        (3, ids[1]),
        (4, ids[2]),
    ]
    # A position past the end appends instead of leaving a gap
    extra = http.post("/api/songs", json={"name": "Last", "group_id": gid}).json()["id"]
    resp = http.post(f"/api/setlists/{setlist_id}/songs", json={"song_id": extra, "position": 99})
    assert resp.json()[-1]["position"] == 5


# --- Deleting a song another band also plays ---


def test_cannot_delete_a_song_another_band_plays(auth_client):  # noqa: F811
    http, _uid, gid = auth_client
    db = api._db
    other_gid = db.create_group("OtherBand")
    song_id = http.post("/api/songs", json={"name": "Shared", "group_id": gid}).json()["id"]
    db.link_song_to_group(song_id, other_gid)

    resp = http.delete(f"/api/songs/{song_id}")
    assert resp.status_code == 409
    assert db.get_song(song_id) is not None

    # Once only the caller's band plays it, it can be deleted
    db.unlink_song_from_group(song_id, other_gid)
    assert http.delete(f"/api/songs/{song_id}").status_code == 200
    assert db.get_song(song_id) is None


def test_member_of_every_band_can_delete_shared_song(auth_client):  # noqa: F811
    http, uid, gid = auth_client
    db = api._db
    other_gid = db.create_group("OtherBand")
    db.assign_user_to_group(uid, other_gid)
    song_id = http.post("/api/songs", json={"name": "Shared", "group_id": gid}).json()["id"]
    db.link_song_to_group(song_id, other_gid)
    assert http.delete(f"/api/songs/{song_id}").status_code == 200


# --- Changing a password signs out other sessions ---


def test_password_change_signs_out_other_sessions(auth_client):  # noqa: F811
    http, uid, _gid = auth_client
    other = TestClient(api.app)
    creds = {"email": "test@example.com", "password": "password"}
    assert other.post("/api/auth/login", json=creds).status_code == 200
    assert other.get("/api/auth/me").status_code == 200

    # Make the earlier logins older than the change (issue times are whole seconds)
    api._db.conn.execute("UPDATE users SET password_changed_at = NULL")
    api._db.conn.commit()
    resp = http.put(
        "/api/auth/password",
        json={"current_password": "password", "new_password": "new-password"},
    )
    assert resp.status_code == 200
    changed = api._db.get_user(uid).password_changed_at
    assert changed is not None
    api._db.conn.execute("UPDATE users SET password_changed_at = ?", (changed + 5,))
    api._db.conn.commit()

    # Sessions from before the change are refused
    assert other.get("/api/auth/me").status_code == 401


def test_password_change_keeps_this_browser_signed_in(auth_client):  # noqa: F811
    http, _uid, _gid = auth_client
    resp = http.put(
        "/api/auth/password",
        json={"current_password": "password", "new_password": "new-password"},
    )
    assert resp.status_code == 200
    assert "jam_session" in resp.headers.get("set-cookie", "")
    assert http.get("/api/auth/me").status_code == 200


def test_login_without_issue_time_still_works_until_password_changes(auth_client):  # noqa: F811
    """Sessions issued before this check existed carry no issue time."""
    import jwt

    http, uid, _gid = auth_client
    old = jwt.encode({"sub": str(uid), "email": "test@example.com"}, "test-secret", "HS256")
    legacy = TestClient(api.app, cookies={"jam_session": old})
    assert legacy.get("/api/auth/me").status_code == 200
    api._db.update_user_password(uid, hash_password("another-one"))
    assert legacy.get("/api/auth/me").status_code == 401


# --- Baseline security headers ---


def test_security_headers_on_every_response(client):  # noqa: F811
    for path in ("/health", "/api/auth/me"):
        headers = client.get(path).headers
        assert headers["x-content-type-options"] == "nosniff"
        assert headers["x-frame-options"] == "DENY"
        assert headers["referrer-policy"] == "same-origin"


# --- Input checks ---


@pytest.mark.parametrize("file_id", ["../../etc", "a/b", "a b", ""])
def test_drive_file_id_must_look_like_an_id(auth_client, file_id):  # noqa: F811
    http, _uid, gid = auth_client
    resp = http.post("/api/drive/import", json={"file_id": file_id, "group_id": gid})
    assert resp.status_code == 422
    assert http.post("/api/drive/skip", json={"file_id": file_id}).status_code == 422


def test_admin_set_password_needs_eight_characters(client):  # noqa: F811
    db = api._db
    uid, _gid = _create_user_and_group(db, role="superadmin")
    client.post("/api/auth/login", json={"email": "test@example.com", "password": "password"})
    assert (
        client.put(f"/api/admin/users/{uid}/password", json={"password": "short"}).status_code
        == 400
    )
    resp = client.post("/api/admin/users", json={"email": "n@example.com", "password": "short"})
    assert resp.status_code == 400


def test_upload_complete_rejects_another_sessions_job(auth_client):  # noqa: F811
    http, _uid, gid = auth_client
    db = api._db
    mine = db.create_session("a.m4a", gid)
    other = db.create_session("b.m4a", gid)
    job = db.create_job("job-a", gid, session_id=mine)
    db.update_job_status(job.id, "pending")
    resp = http.post("/api/sessions/upload/complete", json={"job_id": job.id, "session_id": other})
    assert resp.status_code == 400


def test_download_name_with_non_latin_characters(auth_client, tmp_path):  # noqa: F811
    http, _uid, gid = auth_client
    db = api._db
    sid = db.create_session("s.m4a", gid, date="2026-02-03")
    audio = tmp_path / "t.m4a"
    audio.write_bytes(b"\x00" * 64)
    tid = db.create_track(sid, track_number=1, start_sec=0, end_sec=10, audio_path=str(audio))
    http.post(f"/api/tracks/{tid}/tag", json={"song_name": "Señor’s “Blues” 日本"})
    resp = http.get(f"/api/tracks/{tid}/audio?download=1")
    assert resp.status_code == 200
    assert resp.headers["content-disposition"].startswith("attachment")


# --- reset-db really empties the database ---


def test_reset_drops_every_table(client):  # noqa: F811
    db = api._db
    gid = db.create_group("Band")
    db.add_drive_folder("folder123", "Folder", gid, None)
    db.add_curation_run("did things", "[]")
    db.reset()
    assert db.list_drive_folders() == []
    assert db.list_curation_runs() == []
    assert db.list_groups() == []
