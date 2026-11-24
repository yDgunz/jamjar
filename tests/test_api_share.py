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


def test_create_share_requires_auth(client):
    assert client.post("/api/shares", json={"kind": "track", "id": 1}).status_code == 401
    assert client.get("/api/shares").status_code == 401
    assert client.delete("/api/shares/1").status_code == 401


def test_old_track_share_endpoints_are_gone(auth_client):
    client, uid, gid = auth_client
    assert client.post("/api/tracks/1/share").status_code in (404, 405)


def test_revoke_unknown_share_404(auth_client):
    client, uid, gid = auth_client
    assert client.delete("/api/shares/999").status_code == 404


def test_readonly_can_share(client, tmp_path):
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
    resp = client.post("/api/shares", json={"kind": "track", "id": tracks[0].id})
    assert resp.status_code == 200
    assert resp.json()["can_manage"] is True


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


def test_public_share_track(auth_client):
    client, uid, gid = auth_client
    db = api._db
    tracks = db.get_tracks_for_session(1)
    db.tag_track(tracks[0].id, "Fat Cat", gid)
    link = db.create_share_link(tracks[0].id, uid)
    client.cookies.clear()
    resp = client.get(f"/api/share/{link.token}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["kind"] == "track"
    assert data["track"]["title"] == "Fat Cat"
    assert data["track"]["audio_url"] == f"/api/share/{link.token}/audio"
    assert "download=1" in data["track"]["download_url"]


def test_public_share_invalid_token(client):
    assert client.get("/api/share/nonexistent").status_code == 404


# --- Generic share links (tracks, recordings, setlists, songs) ---


def _seed(db, gid, uid):
    sid = db.get_tracks_for_session(1)[0].session_id
    song_id = db._get_or_create_song("Fat Cat", gid)
    db.update_song_details(song_id, sheet="[Verse]\nC  G\nHello there", notes="", artist="The Cats")
    other = db._get_or_create_song("Dog Day", gid)
    setlist_id = db.create_setlist("Friday Gig", gid)
    db.set_setlist_songs(setlist_id, [song_id])
    return sid, song_id, other, setlist_id


@pytest.mark.parametrize("kind", ["track", "session", "setlist", "song"])
def test_create_share_any_kind_defaults_to_a_month(auth_client, kind):
    client, uid, gid = auth_client
    db = api._db
    sid, song_id, _, setlist_id = _seed(db, gid, uid)
    target = {"track": 1, "session": sid, "setlist": setlist_id, "song": song_id}[kind]
    resp = client.post("/api/shares", json={"kind": kind, "id": target})
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["kind"] == kind and data["target_id"] == target
    assert data["url"] == f"/share/{data['token']}"
    assert data["can_manage"] is True
    assert data["group_id"] == gid
    days = (
        api.datetime.strptime(data["expires_at"], "%Y-%m-%d %H:%M:%S")
        - api.datetime.now(api.timezone.utc).replace(tzinfo=None)
    ).days
    assert days in (29, 30)
    # Same thing again → same link
    again = client.post("/api/shares", json={"kind": kind, "id": target}).json()
    assert again["token"] == data["token"]


def test_share_expiry_choice_and_never(auth_client):
    client, uid, gid = auth_client
    resp = client.post("/api/shares", json={"kind": "track", "id": 1, "expires_in_days": 7})
    link = resp.json()
    assert link["expires_at"] is not None
    # Re-sharing with an explicit expiry changes it
    resp = client.post("/api/shares", json={"kind": "track", "id": 1, "expires_in_days": None})
    assert resp.json()["token"] == link["token"]
    assert resp.json()["expires_at"] is None
    resp = client.put(f"/api/shares/{link['id']}/expiry", json={"expires_in_days": 1})
    assert resp.status_code == 200 and resp.json()["expires_at"] is not None
    bad = client.post("/api/shares", json={"kind": "track", "id": 1, "expires_in_days": 0})
    assert bad.status_code == 422


def test_share_default_expiry_from_env(auth_client, monkeypatch):
    client, uid, gid = auth_client
    monkeypatch.setenv("JAM_SHARE_EXPIRY_DAYS", "never")
    reset_config()
    resp = client.get("/api/shares/lookup", params={"kind": "track", "id": 1})
    assert resp.json() == {"link": None, "default_expiry_days": None}
    assert client.post("/api/shares", json={"kind": "track", "id": 1}).json()["expires_at"] is None
    assert client.get("/api/shares/lookup", params={"kind": "track", "id": 1}).json()["link"]


def test_expired_share_is_gone_and_replaced(auth_client):
    client, uid, gid = auth_client
    db = api._db
    link = client.post("/api/shares", json={"kind": "track", "id": 1}).json()
    db.conn.execute("UPDATE share_links SET expires_at = '2000-01-01 00:00:00'")
    db.conn.commit()
    client.cookies.clear()
    assert client.get(f"/api/share/{link['token']}").status_code == 410
    assert client.get(f"/api/share/{link['token']}/audio").status_code == 410
    client.post("/api/auth/login", json={"email": "test@example.com", "password": "password"})
    listed = client.get("/api/shares").json()
    assert listed[0]["expired"] is True
    fresh = client.post("/api/shares", json={"kind": "track", "id": 1}).json()
    assert fresh["token"] != link["token"]
    assert client.get(f"/api/share/{link['token']}").status_code == 404


def test_public_shared_session(auth_client):
    client, uid, gid = auth_client
    db = api._db
    sid, *_ = _seed(db, gid, uid)
    token = client.post("/api/shares", json={"kind": "session", "id": sid}).json()["token"]
    client.cookies.clear()
    data = client.get(f"/api/share/{token}").json()
    assert data["session"]["name"] == db.get_session(sid).name
    track = data["session"]["tracks"][0]
    assert client.get(track["audio_url"]).status_code == 200
    assert client.get(f"/api/share/{token}/tracks/999/audio").status_code == 404
    # A recording link can't be used as a track link
    assert client.get(f"/api/share/{token}/audio").status_code == 404


def test_public_shared_setlist_and_its_charts(auth_client):
    client, uid, gid = auth_client
    db = api._db
    _, song_id, other, setlist_id = _seed(db, gid, uid)
    token = client.post("/api/shares", json={"kind": "setlist", "id": setlist_id}).json()["token"]
    client.cookies.clear()
    data = client.get(f"/api/share/{token}").json()
    assert data["setlist"]["name"] == "Friday Gig"
    [entry] = data["setlist"]["songs"]
    assert (entry["song_id"], entry["name"], entry["has_sheet"]) == (song_id, "Fat Cat", True)
    song = client.get(f"/api/share/{token}/songs/{song_id}").json()
    assert "Hello there" in song["sheet"]
    assert "notes" not in song
    # Songs that aren't in the setlist stay private
    assert client.get(f"/api/share/{token}/songs/{other}").status_code == 404


def test_public_shared_song(auth_client):
    client, uid, gid = auth_client
    db = api._db
    _, song_id, *_ = _seed(db, gid, uid)
    db.add_song_link(song_id, "lesson", "https://youtu.be/abc", "How to", uid)
    token = client.post("/api/shares", json={"kind": "song", "id": song_id}).json()["token"]
    client.cookies.clear()
    data = client.get(f"/api/share/{token}").json()
    assert data["song"]["name"] == "Fat Cat"
    assert data["song"]["links"][0]["url"] == "https://youtu.be/abc"


def test_cannot_share_other_bands_things(auth_client):
    client, uid, gid = auth_client
    db = api._db
    other = db.create_group("Other")
    sid = db.create_session("x.m4a", other)
    song = db._get_or_create_song("Secret", other)
    assert client.post("/api/shares", json={"kind": "session", "id": sid}).status_code == 404
    assert client.post("/api/shares", json={"kind": "song", "id": song}).status_code == 404


def _login(client, db, email, role, gid):
    uid = db.create_user(email, hash_password("password"), name=email, role=role)
    db.assign_user_to_group(uid, gid)
    client.cookies.clear()
    client.post("/api/auth/login", json={"email": email, "password": "password"})
    return uid


def test_list_and_revoke_permissions(auth_client):
    client, admin_id, gid = auth_client
    db = api._db
    admin_link = client.post("/api/shares", json={"kind": "track", "id": 1}).json()

    # An editor sees only their own links and can't touch the admin's
    _login(client, db, "ed@example.com", "editor", gid)
    sid = db.get_tracks_for_session(1)[0].session_id
    mine = client.post("/api/shares", json={"kind": "session", "id": sid}).json()
    listed = client.get("/api/shares").json()
    assert [s["id"] for s in listed] == [mine["id"]]
    assert client.delete(f"/api/shares/{admin_link['id']}").status_code == 403
    resp = client.put(f"/api/shares/{admin_link['id']}/expiry", json={"expires_in_days": 1})
    assert resp.status_code == 403
    # Re-sharing the admin's track returns the admin's link, but can't change its expiry
    same = client.post("/api/shares", json={"kind": "track", "id": 1})
    assert same.json()["token"] == admin_link["token"]
    assert same.json()["can_manage"] is False
    resp = client.post("/api/shares", json={"kind": "track", "id": 1, "expires_in_days": 1})
    assert resp.status_code == 403

    # The admin sees every link in the band and can revoke the editor's
    client.cookies.clear()
    client.post("/api/auth/login", json={"email": "test@example.com", "password": "password"})
    listed = client.get("/api/shares").json()
    assert {s["id"] for s in listed} == {admin_link["id"], mine["id"]}
    assert all(s["can_manage"] for s in listed)
    assert client.delete(f"/api/shares/{mine['id']}").status_code == 200
    client.cookies.clear()
    assert client.get(f"/api/share/{mine['token']}").status_code == 404


def test_admin_doesnt_see_other_bands_links(auth_client):
    client, admin_id, gid = auth_client
    db = api._db
    other = db.create_group("Other")
    sid = db.create_session("x.m4a", other)
    _login(client, db, "o@example.com", "editor", other)
    client.post("/api/shares", json={"kind": "session", "id": sid})
    client.cookies.clear()
    client.post("/api/auth/login", json={"email": "test@example.com", "password": "password"})
    assert client.get("/api/shares").json() == []
