import pytest
from fastapi.testclient import TestClient

from jam_session_processor import api
from jam_session_processor.auth import hash_password
from jam_session_processor.config import reset_config
from jam_session_processor.db import Database
from jam_session_processor.storage import reset_storage


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("JAM_JWT_SECRET", "test-secret")
    monkeypatch.setenv("JAM_API_KEY", "test-api-key")
    monkeypatch.delenv("JAM_R2_BUCKET", raising=False)
    monkeypatch.delenv("JAM_R2_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("JAM_R2_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("JAM_R2_SECRET_ACCESS_KEY", raising=False)
    reset_config()
    reset_storage()
    db = Database(tmp_path / "test.db")
    api._db = db
    yield TestClient(api.app)
    db.close()
    api._db = None
    reset_storage()
    reset_config()


@pytest.fixture
def auth_client(client, tmp_path):
    db = api._db
    uid = db.create_user("test@example.com", hash_password("password"), name="Test", role="admin")
    gid = db.create_group("TestBand")
    db.assign_user_to_group(uid, gid)
    sid = db.create_session("session.m4a", gid, date="2026-01-01")
    audio = tmp_path / "track1.m4a"
    audio.write_bytes(b"\x00" * 100)
    db.create_track(sid, track_number=1, start_sec=0, end_sec=300, audio_path=str(audio))
    login = {"email": "test@example.com", "password": "password"}
    resp = client.post("/api/auth/login", json=login)
    assert resp.status_code == 200
    return client, uid, gid


def test_create_share_link(auth_client):
    client, uid, gid = auth_client
    db = api._db
    tracks = db.get_tracks_for_session(1)
    resp = client.post(f"/api/tracks/{tracks[0].id}/share")
    assert resp.status_code == 200
    data = resp.json()
    assert "token" in data
    assert data["url"].startswith("/share/")


def test_create_share_link_idempotent(auth_client):
    client, uid, gid = auth_client
    db = api._db
    tracks = db.get_tracks_for_session(1)
    resp1 = client.post(f"/api/tracks/{tracks[0].id}/share")
    resp2 = client.post(f"/api/tracks/{tracks[0].id}/share")
    assert resp1.json()["token"] == resp2.json()["token"]


def test_create_share_link_requires_auth(client):
    resp = client.post("/api/tracks/1/share")
    assert resp.status_code == 401


def test_delete_share_link(auth_client):
    client, uid, gid = auth_client
    db = api._db
    tracks = db.get_tracks_for_session(1)
    client.post(f"/api/tracks/{tracks[0].id}/share")
    resp = client.delete(f"/api/tracks/{tracks[0].id}/share")
    assert resp.status_code == 200


def test_delete_share_link_404_when_none(auth_client):
    client, uid, gid = auth_client
    db = api._db
    tracks = db.get_tracks_for_session(1)
    resp = client.delete(f"/api/tracks/{tracks[0].id}/share")
    assert resp.status_code == 404


def test_delete_share_link_requires_auth(client):
    resp = client.delete("/api/tracks/1/share")
    assert resp.status_code == 401


def test_readonly_can_create_share_link(client, tmp_path):
    """All roles including readonly can create share links."""
    db = api._db
    uid = db.create_user("ro@example.com", hash_password("password"), name="RO", role="readonly")
    gid = db.create_group("ROBand")
    db.assign_user_to_group(uid, gid)
    sid = db.create_session("session.m4a", gid)
    audio = tmp_path / "track_ro.m4a"
    audio.write_bytes(b"\x00" * 100)
    db.create_track(sid, track_number=1, start_sec=0, end_sec=300, audio_path=str(audio))
    client.post("/api/auth/login", json={"email": "ro@example.com", "password": "password"})
    tracks = db.get_tracks_for_session(sid)
    resp = client.post(f"/api/tracks/{tracks[0].id}/share")
    assert resp.status_code == 200


def test_public_share_audio(auth_client, tmp_path):
    """Public audio endpoint streams audio without auth."""
    client, uid, gid = auth_client
    db = api._db
    tracks = db.get_tracks_for_session(1)
    link = db.create_share_link(tracks[0].id, uid)
    # Need to clear auth cookie to test public access
    client.cookies.clear()
    resp = client.get(f"/api/share/{link.token}/audio")
    assert resp.status_code == 200


def test_public_share_audio_download(auth_client, tmp_path):
    client, uid, gid = auth_client
    db = api._db
    tracks = db.get_tracks_for_session(1)
    link = db.create_share_link(tracks[0].id, uid)
    client.cookies.clear()
    resp = client.get(f"/api/share/{link.token}/audio?download=1")
    assert resp.status_code == 200
    assert "attachment" in resp.headers.get("content-disposition", "")


def test_public_share_audio_invalid_token(client):
    resp = client.get("/api/share/nonexistent/audio")
    assert resp.status_code == 404


def test_share_landing_page(auth_client):
    client, uid, gid = auth_client
    db = api._db
    tracks = db.get_tracks_for_session(1)
    link = db.create_share_link(tracks[0].id, uid)
    client.cookies.clear()
    resp = client.get(f"/share/{link.token}")
    assert resp.status_code == 200
    assert "text/html" in resp.headers.get("content-type", "")
    assert "JamJar" in resp.text
    assert f"/api/share/{link.token}/audio" in resp.text


def test_share_landing_page_invalid_token(client):
    resp = client.get("/share/nonexistent")
    assert resp.status_code == 404


def test_share_landing_page_shows_song_name(auth_client):
    client, uid, gid = auth_client
    db = api._db
    tracks = db.get_tracks_for_session(1)
    db.tag_track(tracks[0].id, "My Song", gid)
    link = db.create_share_link(tracks[0].id, uid)
    client.cookies.clear()
    resp = client.get(f"/share/{link.token}")
    assert "My Song" in resp.text


def test_share_landing_page_has_download_link(auth_client):
    client, uid, gid = auth_client
    db = api._db
    tracks = db.get_tracks_for_session(1)
    link = db.create_share_link(tracks[0].id, uid)
    client.cookies.clear()
    resp = client.get(f"/share/{link.token}")
    assert "download=1" in resp.text
