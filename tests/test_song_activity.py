"""Per-user song activity: last opened / last performed."""

from pathlib import Path

from jam_session_processor import api
from jam_session_processor.auth import hash_password
from jam_session_processor.db import Database
from tests.test_api import auth_client, client  # noqa: F401


def test_record_and_read_activity(auth_client):  # noqa: F811
    http, uid, gid = auth_client
    db = api._db
    a = db._get_or_create_song("A", gid)
    b = db._get_or_create_song("B", gid)

    assert http.post(f"/api/songs/{a}/activity", json={"event": "opened"}).status_code == 204
    assert http.post(f"/api/songs/{b}/activity", json={"event": "performed"}).status_code == 204

    songs = {s["name"]: s for s in http.get("/api/songs").json()}
    assert songs["A"]["last_opened_at"] and songs["A"]["last_performed_at"] is None
    assert songs["B"]["last_performed_at"] and songs["B"]["last_opened_at"] is None
    single = http.get(f"/api/songs/{a}").json()
    assert single["last_opened_at"] == songs["A"]["last_opened_at"]


def test_activity_is_per_user(auth_client):  # noqa: F811
    http, uid, gid = auth_client
    db = api._db
    song = db._get_or_create_song("A", gid)
    other = db.create_user("o@x.com", hash_password("password"), name="O", role="editor")
    db.assign_user_to_group(other, gid)
    db.record_song_activity(other, song, "opened")
    assert http.get(f"/api/songs/{song}").json()["last_opened_at"] is None


def test_rejects_unknown_event(auth_client):  # noqa: F811
    http, uid, gid = auth_client
    song = api._db._get_or_create_song("A", gid)
    assert http.post(f"/api/songs/{song}/activity", json={"event": "liked"}).status_code == 422


def test_activity_requires_song_access(auth_client):  # noqa: F811
    http, uid, gid = auth_client
    other_group = api._db.create_group("Other")
    song = api._db._get_or_create_song("Hidden", other_group)
    resp = http.post(f"/api/songs/{song}/activity", json={"event": "opened"})
    assert resp.status_code == 404


def test_api_key_activity_is_noop(client):  # noqa: F811
    gid = api._db.create_group("G")
    song = api._db._get_or_create_song("A", gid)
    resp = client.post(
        f"/api/songs/{song}/activity",
        json={"event": "opened"},
        headers={"x-api-key": "test-api-key"},
    )
    assert resp.status_code == 204


def test_merge_keeps_latest_activity(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    g = db.create_group("G")
    uid = db.create_user("u@x.com", hash_password("pw"))
    keep = db._get_or_create_song("Keep", g)
    drop = db._get_or_create_song("Drop", g)
    db.conn.execute(
        "INSERT INTO song_activity VALUES (?, ?, '2026-01-01 00:00:00', NULL)", (uid, keep)
    )
    db.conn.execute(
        "INSERT INTO song_activity VALUES (?, ?, '2026-02-01 00:00:00', '2026-02-02 00:00:00')",
        (uid, drop),
    )
    db.conn.commit()
    db.merge_songs(keep, drop)
    act = db.get_song_activity(uid)[keep]
    assert act == {
        "last_opened_at": "2026-02-01 00:00:00",
        "last_performed_at": "2026-02-02 00:00:00",
    }


def test_song_response_includes_created_at(client):  # noqa: F811
    from jam_session_processor import api as _api

    gid = _api._db.create_group("G")
    sid = _api._db._get_or_create_song("New One", gid)
    body = client.get(f"/api/songs/{sid}", headers={"x-api-key": "test-api-key"}).json()
    assert body["created_at"] and len(body["created_at"]) == 19
    listed = client.get("/api/songs", headers={"x-api-key": "test-api-key"}).json()
    assert listed[0]["created_at"] == body["created_at"]
