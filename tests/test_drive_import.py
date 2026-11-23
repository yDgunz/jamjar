"""Google Drive import: linking folders, listing files, importing recordings."""

import shutil

import pytest

from jam_session_processor import api, gdrive
from jam_session_processor.auth import hash_password
from jam_session_processor.gdrive import DriveError, parse_folder_id
from tests.test_api import _poll_job, auth_client, client  # noqa: F401

H = {"x-api-key": "test-api-key"}
FOLDER = "1AbCdEfGhIjKlMnOp"


class FakeDrive:
    email = "jamjar@test-project.iam.gserviceaccount.com"

    def __init__(self, audio):
        self.audio = audio
        self.files = {
            "fileA123456": {"name": "Band Jam 3-14-25.wav", "size": 100},
            "fileB123456": {"name": "Other take.wav", "size": 100},
        }

    def get_file(self, file_id):
        if file_id == FOLDER:
            return {"id": FOLDER, "name": "Jam Recordings", "mimeType": gdrive.FOLDER_MIME}
        if file_id in self.files:
            f = self.files[file_id]
            return {
                "id": file_id,
                "mimeType": "audio/wav",
                **f,
                "createdTime": "2025-03-15T01:00:00Z",
            }
        raise DriveError("not found", 404)

    def list_audio(self, folder_id):
        if folder_id != FOLDER:
            raise DriveError("not found", 404)
        return [
            {
                "id": k,
                "path": ["Sub"] if k == "fileB123456" else [],
                "createdTime": "2025-03-15T01:00:00Z",
                **v,
            }
            for k, v in self.files.items()
        ]

    def download(self, file_id, dest, on_progress=None):
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(self.audio, dest)
        return dest.stat().st_size


@pytest.fixture
def drive(monkeypatch, fake_session_file):
    fake = FakeDrive(fake_session_file)
    monkeypatch.setattr(gdrive, "get_drive_client", lambda: fake)
    return fake


def _band(db, name="Band"):
    return db.create_group(name)


def test_parse_folder_id():
    assert parse_folder_id(f"https://drive.google.com/drive/folders/{FOLDER}?usp=sharing") == FOLDER
    assert parse_folder_id(f"https://drive.google.com/open?id={FOLDER}") == FOLDER
    assert parse_folder_id(FOLDER) == FOLDER
    assert parse_folder_id("not a link") is None


def test_not_configured(client, monkeypatch):  # noqa: F811
    monkeypatch.setattr(gdrive, "get_drive_client", lambda: None)
    assert client.get("/api/drive", headers=H).json() == {
        "configured": False,
        "service_account_email": None,
    }
    resp = client.post("/api/drive/folders", json={"url": FOLDER}, headers=H)
    assert resp.status_code == 503


def test_link_folder_and_list_files(client, drive):  # noqa: F811
    gid = _band(api._db)
    info = client.get("/api/drive", headers=H).json()
    assert info == {"configured": True, "service_account_email": drive.email}

    resp = client.post(
        "/api/drive/folders",
        json={"url": f"https://drive.google.com/drive/folders/{FOLDER}", "group_id": gid},
        headers=H,
    )
    assert resp.status_code == 200
    folder = resp.json()
    assert folder["name"] == "Jam Recordings" and folder["group_name"] == "Band"
    assert client.post("/api/drive/folders", json={"url": FOLDER}, headers=H).status_code == 409

    files = client.get(f"/api/drive/folders/{folder['id']}/files", headers=H).json()
    by_id = {f["id"]: f for f in files}
    assert by_id["fileA123456"]["status"] == "new"
    assert by_id["fileA123456"]["suggested_date"] == "2025-03-14"
    assert by_id["fileB123456"]["path"] == ["Sub"]


def test_link_unshared_folder_explains(client, drive):  # noqa: F811
    resp = client.post("/api/drive/folders", json={"url": "1ZZZZZZZZZZZZZZ"}, headers=H)
    assert resp.status_code == 400
    assert drive.email in resp.json()["detail"]


def test_import_creates_processed_recording(client, drive):  # noqa: F811
    gid = _band(api._db)
    resp = client.post(
        "/api/drive/import",
        json={"file_id": "fileA123456", "group_id": gid, "single": True},
        headers=H,
    )
    assert resp.status_code == 202
    job = _poll_job(client, resp.json()["id"], headers=H, timeout=30)
    assert job["status"] == "completed", job
    session = client.get(f"/api/sessions/{job['session_id']}", headers=H).json()
    assert session["name"] == "Band Jam"
    assert session["date"] == "2025-03-14"
    assert session["group_id"] == gid
    assert session["track_count"] == 1

    # Marked imported; importing again is refused
    fid = client.post("/api/drive/folders", json={"url": FOLDER}, headers=H).json()["id"]
    files = {f["id"]: f for f in client.get(f"/api/drive/folders/{fid}/files", headers=H).json()}
    assert files["fileA123456"]["status"] == "imported"
    assert files["fileA123456"]["session_id"] == job["session_id"]
    again = client.post(
        "/api/drive/import", json={"file_id": "fileA123456", "group_id": gid}, headers=H
    )
    assert again.status_code == 409


def test_import_duplicate_is_flagged(client, drive):  # noqa: F811
    gid = _band(api._db)
    first = client.post(
        "/api/drive/import", json={"file_id": "fileA123456", "group_id": gid}, headers=H
    )
    first_job = _poll_job(client, first.json()["id"], headers=H, timeout=30)
    # Same audio under another Drive file: duplicate by duration
    second = client.post(
        "/api/drive/import", json={"file_id": "fileB123456", "group_id": gid}, headers=H
    )
    job = _poll_job(client, second.json()["id"], headers=H, timeout=30)
    assert job["status"] == "failed" and "Already in JamJar" in job["error"]
    imports = api._db.get_drive_imports(["fileB123456"])
    assert imports["fileB123456"]["status"] == "duplicate"
    assert imports["fileB123456"]["session_id"] == first_job["session_id"]
    assert len(client.get("/api/sessions", headers=H).json()) == 1


def test_import_with_overrides(client, drive):  # noqa: F811
    gid = _band(api._db)
    resp = client.post(
        "/api/drive/import",
        json={
            "file_id": "fileB123456",
            "group_id": gid,
            "name": "Basement jam",
            "date": "2017-03-08",
            "single": True,
        },
        headers=H,
    )
    job = _poll_job(client, resp.json()["id"], headers=H, timeout=30)
    session = client.get(f"/api/sessions/{job['session_id']}", headers=H).json()
    assert (session["name"], session["date"], session["track_count"]) == (
        "Basement jam",
        "2017-03-08",
        1,
    )


def test_skip_and_unskip(client, drive):  # noqa: F811
    _band(api._db)
    fid = client.post("/api/drive/folders", json={"url": FOLDER}, headers=H).json()["id"]
    client.post(
        "/api/drive/skip", json={"file_id": "fileB123456", "file_name": "Other take.wav"}, headers=H
    )
    files = {f["id"]: f for f in client.get(f"/api/drive/folders/{fid}/files", headers=H).json()}
    assert files["fileB123456"]["status"] == "skipped"
    client.post("/api/drive/skip", json={"file_id": "fileB123456", "skipped": False}, headers=H)
    files = {f["id"]: f for f in client.get(f"/api/drive/folders/{fid}/files", headers=H).json()}
    assert files["fileB123456"]["status"] == "new"


def test_folder_scoped_to_band_and_admin_only(client, drive):  # noqa: F811
    db = api._db
    mine, other = _band(db, "Mine"), _band(db, "Other")
    client.post("/api/drive/folders", json={"url": FOLDER, "group_id": other}, headers=H)

    uid = db.create_user("ed@x.com", hash_password("password"), name="Ed", role="editor")
    db.assign_user_to_group(uid, mine)
    aid = db.create_user("ad@x.com", hash_password("password"), name="Ad", role="admin")
    db.assign_user_to_group(aid, mine)

    client.post("/api/auth/login", json={"email": "ed@x.com", "password": "password"})
    assert client.get("/api/drive").status_code == 403
    client.post("/api/auth/login", json={"email": "ad@x.com", "password": "password"})
    assert client.get("/api/drive/folders").json() == []
    resp = client.post("/api/drive/import", json={"file_id": "fileA123456", "group_id": other})
    assert resp.status_code == 404


def test_drive_client_auth_and_listing(monkeypatch):
    """The real client: signs a JWT for a token, then pages through a folder tree."""
    import json as _json
    from unittest.mock import MagicMock

    import jwt as pyjwt
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    sa = {"client_email": "sa@p.iam.gserviceaccount.com", "private_key": pem}
    dc = gdrive.DriveClient(gdrive._load_key(_json.dumps(sa)))

    def fake_post(url, data, timeout):
        claims = pyjwt.decode(
            data["assertion"], key.public_key(), algorithms=["RS256"], audience=gdrive.TOKEN_URL
        )
        assert claims["iss"] == sa["client_email"] and claims["scope"] == gdrive.SCOPE
        return MagicMock(status_code=200, json=lambda: {"access_token": "tok", "expires_in": 3600})

    tree = {
        "root": [
            {"id": "sub", "name": "2017", "mimeType": gdrive.FOLDER_MIME},
            {"id": "a", "name": "jam.m4a", "mimeType": "audio/x-m4a", "size": "10"},
            {"id": "pdf", "name": "chart.pdf", "mimeType": "application/pdf"},
            {"id": "junk", "name": "._jam.m4a", "mimeType": "audio/x-m4a"},
        ],
        "sub": [
            {"id": "b", "name": "take.wav", "mimeType": "application/octet-stream", "size": "5"}
        ],
    }

    def fake_get(url, params, headers, timeout, stream):
        assert headers["Authorization"] == "Bearer tok"
        parent = params["q"].split("'")[1]
        return MagicMock(status_code=200, json=lambda: {"files": tree[parent]})

    monkeypatch.setattr(gdrive.requests, "post", fake_post)
    monkeypatch.setattr(gdrive.requests, "get", fake_get)
    found = {f["id"]: f for f in dc.list_audio("root")}
    assert set(found) == {"a", "b"}
    assert found["b"]["path"] == ["2017"] and found["b"]["size"] == 5
