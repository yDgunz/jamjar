"""GET /api/admin/users/{id}/song-activity: read-only view of one user's song activity."""

from jam_session_processor import api
from jam_session_processor.auth import hash_password
from tests.test_api import client  # noqa: F401


def _setup(db, role="superadmin"):
    gid = db.create_group("Band")
    uid = db.create_user("me@x.com", hash_password("password"), name="Me", role=role)
    db.assign_user_to_group(uid, gid)
    a = db._get_or_create_song("Alpha", gid)
    b = db._get_or_create_song("Beta", gid)
    return uid, a, b


def test_activity_newest_first(client):  # noqa: F811
    db = api._db
    uid, a, b = _setup(db)
    db.conn.execute(
        "INSERT INTO song_activity (user_id, song_id, last_opened_at, last_performed_at)"
        " VALUES (?, ?, '2026-01-01 00:00:00', NULL), (?, ?, '2026-01-01 00:00:00',"
        " '2026-03-01 00:00:00')",
        (uid, a, uid, b),
    )
    db.conn.commit()
    resp = client.get(
        f"/api/admin/users/{uid}/song-activity", headers={"x-api-key": "test-api-key"}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert [r["song_id"] for r in body] == [b, a]
    assert body[0]["last_performed_at"] == "2026-03-01 00:00:00"
    assert body[1]["last_performed_at"] is None


def test_activity_unknown_user_404(client):  # noqa: F811
    resp = client.get("/api/admin/users/999/song-activity", headers={"x-api-key": "test-api-key"})
    assert resp.status_code == 404


def test_activity_requires_superadmin(client):  # noqa: F811
    db = api._db
    uid, _a, _b = _setup(db, role="admin")
    client.post("/api/auth/login", json={"email": "me@x.com", "password": "password"})
    assert client.get(f"/api/admin/users/{uid}/song-activity").status_code == 403


def test_curation_runs_log_and_list(client):  # noqa: F811
    h = {"x-api-key": "test-api-key"}
    body = {
        "summary": "Added 2 songs",
        "items": [
            {"song_id": 5, "song_name": "Creep", "action": "added_song"},
            {"song_name": "Gone", "action": "added_background"},
        ],
    }
    resp = client.post("/api/admin/curation-runs", json=body, headers=h)
    assert resp.status_code == 200
    assert resp.json()["items"][1]["song_id"] is None
    client.post("/api/admin/curation-runs", json={"summary": "second"}, headers=h)
    runs = client.get("/api/admin/curation-runs", headers=h).json()
    assert [r["summary"] for r in runs] == ["second", "Added 2 songs"]
    assert runs[1]["items"][0]["song_name"] == "Creep"


def test_curation_runs_require_superadmin(client):  # noqa: F811
    _setup(api._db, role="admin")
    client.post("/api/auth/login", json={"email": "me@x.com", "password": "password"})
    assert client.get("/api/admin/curation-runs").status_code == 403
    assert client.post("/api/admin/curation-runs", json={"summary": "x"}).status_code == 403
