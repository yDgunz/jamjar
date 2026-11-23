"""GET /api/admin/storage: file storage usage with a per-recording breakdown."""

from jam_session_processor import api
from jam_session_processor.auth import hash_password
from tests.test_api import client  # noqa: F401

H = {"x-api-key": "test-api-key"}


def _write(path, size):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"x" * size)


def test_storage_usage_breakdown(client, tmp_path):  # noqa: F811
    api._storage_usage_cache.clear()
    db = api._db
    gid = db.create_group("Band")
    _write(tmp_path / "recordings" / "big.m4a", 1000)
    _write(tmp_path / "tracks" / "big" / "01.m4a", 300)
    _write(tmp_path / "tracks" / "big" / "02.m4a", 200)
    _write(tmp_path / "recordings" / "small.m4a", 100)
    _write(tmp_path / "recordings" / "stray.m4a", 50)  # not referenced by any session
    big = db.create_session("recordings/big.m4a", gid)
    db.create_track(big, 1, 0.0, 60.0, "tracks/big/01.m4a")
    db.create_track(big, 2, 60.0, 90.0, "tracks/big/02.m4a")
    db.create_track(big, 3, 90.0, 120.0, "tracks/big/03.m4a")  # file missing
    db.create_session("recordings/small.m4a", gid)

    body = client.get("/api/admin/storage", headers=H).json()
    assert body["backend"] == "local"
    assert body["total_objects"] == 5
    assert body["total_bytes"] == 1650
    assert body["recordings_source_bytes"] == 1100
    assert body["recordings_track_bytes"] == 500
    assert body["orphans"] == {"objects": 1, "bytes": 50}
    assert body["missing_files"] == 1
    prefixes = {p["prefix"]: p for p in body["prefixes"]}
    assert prefixes["recordings"]["bytes"] == 1150
    assert prefixes["tracks"]["objects"] == 2
    first = body["recordings"][0]
    assert first["id"] == big and first["total_bytes"] == 1500 and first["track_count"] == 3
    assert body["recordings"][1]["source_bytes"] == 100


def test_storage_usage_is_cached_until_refresh(client, tmp_path):  # noqa: F811
    api._storage_usage_cache.clear()
    _write(tmp_path / "recordings" / "a.m4a", 10)
    assert client.get("/api/admin/storage", headers=H).json()["total_bytes"] == 10
    _write(tmp_path / "recordings" / "b.m4a", 5)
    assert client.get("/api/admin/storage", headers=H).json()["total_bytes"] == 10
    assert client.get("/api/admin/storage?refresh=true", headers=H).json()["total_bytes"] == 15


def test_storage_usage_requires_superadmin(client):  # noqa: F811
    db = api._db
    gid = db.create_group("G")
    uid = db.create_user("a@x.com", hash_password("password"), name="A", role="admin")
    db.assign_user_to_group(uid, gid)
    client.post("/api/auth/login", json={"email": "a@x.com", "password": "password"})
    assert client.get("/api/admin/storage").status_code == 403
