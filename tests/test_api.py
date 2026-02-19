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


def _create_user_and_group(db, email="test@example.com", group_name="TestBand", role="admin"):
    """Create a user with a group and return (user_id, group_id)."""
    uid = db.create_user(email, hash_password("password"), name="Test User", role=role)
    gid = db.create_group(group_name)
    db.assign_user_to_group(uid, gid)
    return uid, gid


@pytest.fixture
def auth_client(client):
    """Client with a user, group, and auth cookie set."""
    db = api._db
    uid, gid = _create_user_and_group(db)
    # Login via API to set the cookie properly
    resp = client.post(
        "/api/auth/login",
        json={"email": "test@example.com", "password": "password"},
    )
    assert resp.status_code == 200
    return client, uid, gid


@pytest.fixture
def seeded_client(auth_client, tmp_path):
    """Client with a session and tracks already in the DB."""
    client, uid, gid = auth_client
    db = api._db
    sid = db.create_session("session1.m4a", gid, date="2026-02-03", notes="Test session")
    for i in range(1, 4):
        audio = tmp_path / f"track{i}.wav"
        audio.write_bytes(b"RIFF" + b"\x00" * 100)
        db.create_track(
            sid, track_number=i, start_sec=(i - 1) * 300.0, end_sec=i * 300.0, audio_path=str(audio)
        )
    return client, uid, gid


# --- Auth tests ---


def test_unauthenticated_api_returns_401(client):
    resp = client.get("/api/sessions")
    assert resp.status_code == 401


def test_health_is_public(client):
    resp = client.get("/health")
    assert resp.status_code == 200


def test_login_success(client):
    db = api._db
    _create_user_and_group(db)

    resp = client.post(
        "/api/auth/login",
        json={"email": "test@example.com", "password": "password"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "test@example.com"
    assert "jam_session" in resp.cookies


def test_login_wrong_password(client):
    db = api._db
    _create_user_and_group(db)

    resp = client.post("/api/auth/login", json={"email": "test@example.com", "password": "wrong"})
    assert resp.status_code == 401


def test_login_unknown_user(client):
    resp = client.post("/api/auth/login", json={"email": "nobody@example.com", "password": "x"})
    assert resp.status_code == 401


def test_get_me(auth_client):
    client, uid, gid = auth_client
    resp = client.get("/api/auth/me")
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "test@example.com"
    assert len(data["groups"]) == 1


def test_logout(auth_client):
    client, uid, gid = auth_client
    resp = client.post("/api/auth/logout")
    assert resp.status_code == 200


def test_api_key_auth(client, tmp_path):
    db = api._db
    db.create_group("TestBand")

    resp = client.get("/api/sessions", headers={"X-API-Key": "test-api-key"})
    assert resp.status_code == 200


def test_invalid_api_key(client):
    resp = client.get("/api/sessions", headers={"X-API-Key": "wrong-key"})
    assert resp.status_code == 401


# --- Session tests ---


def test_list_sessions_empty(auth_client):
    client, uid, gid = auth_client
    resp = client.get("/api/sessions")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_sessions(seeded_client):
    client, uid, gid = seeded_client
    resp = client.get("/api/sessions")
    assert resp.status_code == 200
    sessions = resp.json()
    assert len(sessions) == 1
    assert sessions[0]["source_file"] == "session1.m4a"
    assert sessions[0]["track_count"] == 3
    assert sessions[0]["song_names"] == ""
    assert sessions[0]["group_id"] == gid
    assert sessions[0]["group_name"] == "TestBand"


def test_session_song_names(seeded_client):
    client, uid, gid = seeded_client
    client.post("/api/tracks/1/tag", json={"song_name": "Fat Cat"})
    client.post("/api/tracks/2/tag", json={"song_name": "Spit Me Out"})

    resp = client.get("/api/sessions")
    sessions = resp.json()
    names = sessions[0]["song_names"].split(",")
    assert "Fat Cat" in names
    assert "Spit Me Out" in names


def test_get_session(seeded_client):
    client, uid, gid = seeded_client
    resp = client.get("/api/sessions/1")
    assert resp.status_code == 200
    assert resp.json()["date"] == "2026-02-03"


def test_get_session_not_found(auth_client):
    client, uid, gid = auth_client
    resp = client.get("/api/sessions/999")
    assert resp.status_code == 404


def test_get_session_tracks(seeded_client):
    client, uid, gid = seeded_client
    resp = client.get("/api/sessions/1/tracks")
    assert resp.status_code == 200
    tracks = resp.json()
    assert len(tracks) == 3
    assert tracks[0]["track_number"] == 1
    assert tracks[2]["track_number"] == 3


def test_tag_and_untag_track(seeded_client):
    client, uid, gid = seeded_client
    # Tag
    resp = client.post("/api/tracks/1/tag", json={"song_name": "Fat Cat"})
    assert resp.status_code == 200
    assert resp.json()["song_name"] == "Fat Cat"

    # Verify in session tracks
    resp = client.get("/api/sessions/1/tracks")
    assert resp.json()[0]["song_name"] == "Fat Cat"

    # Untag
    resp = client.delete("/api/tracks/1/tag")
    assert resp.status_code == 200

    resp = client.get("/api/sessions/1/tracks")
    assert resp.json()[0]["song_name"] is None


def test_update_track_notes(seeded_client):
    client, uid, gid = seeded_client
    resp = client.put("/api/tracks/1/notes", json={"notes": "Great take"})
    assert resp.status_code == 200
    assert resp.json()["notes"] == "Great take"


def test_stream_audio(seeded_client):
    client, uid, gid = seeded_client
    resp = client.get("/api/tracks/1/audio")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "audio/wav"


def test_stream_audio_ogg(auth_client, tmp_path):
    client, uid, gid = auth_client
    db = api._db
    sid = db.create_session("session1.m4a", gid, date="2026-02-03")
    audio = tmp_path / "track1.ogg"
    audio.write_bytes(b"OggS" + b"\x00" * 100)
    db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path=str(audio))

    resp = client.get("/api/tracks/1/audio")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "audio/ogg"


def test_stream_audio_not_found(auth_client):
    client, uid, gid = auth_client
    resp = client.get("/api/tracks/999/audio")
    assert resp.status_code == 404


def test_list_songs(seeded_client):
    client, uid, gid = seeded_client
    client.post("/api/tracks/1/tag", json={"song_name": "Fat Cat"})
    client.post("/api/tracks/2/tag", json={"song_name": "Spit Me Out"})

    resp = client.get("/api/songs")
    assert resp.status_code == 200
    songs = resp.json()
    assert len(songs) == 2


def test_update_session_notes(seeded_client):
    client, uid, gid = seeded_client
    resp = client.put("/api/sessions/1/notes", json={"notes": "Great rehearsal"})
    assert resp.status_code == 200
    assert resp.json()["notes"] == "Great rehearsal"

    resp = client.get("/api/sessions/1")
    assert resp.json()["notes"] == "Great rehearsal"


def test_get_song_tracks(seeded_client):
    client, uid, gid = seeded_client
    client.post("/api/tracks/1/tag", json={"song_name": "Fat Cat"})
    client.post("/api/tracks/3/tag", json={"song_name": "Fat Cat"})

    songs = client.get("/api/songs").json()
    song_id = songs[0]["id"]

    resp = client.get(f"/api/songs/{song_id}/tracks")
    assert resp.status_code == 200
    tracks = resp.json()
    assert len(tracks) == 2


@pytest.fixture
def seeded_client_with_source(auth_client, tmp_path):
    """Client with a session whose source_file is a real path (for merge/split)."""
    from unittest.mock import patch

    client, uid, gid = auth_client
    db = api._db
    source = tmp_path / "source.m4a"
    source.write_bytes(b"\x00" * 100)
    sid = db.create_session(str(source), gid, date="2026-02-03")

    output_dir = tmp_path / "output"
    output_dir.mkdir()
    for i in range(1, 4):
        audio = output_dir / f"track{i}.wav"
        audio.write_bytes(b"RIFF" + b"\x00" * 100)
        db.create_track(
            sid, track_number=i, start_sec=(i - 1) * 300.0, end_sec=i * 300.0, audio_path=str(audio)
        )

    def mock_export(file_path, output_path, start_sec, end_sec, **kwargs):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"RIFF" + b"\x00" * 100)

    with (
        patch("jam_session_processor.track_ops.export_segment", side_effect=mock_export),
        patch("jam_session_processor.track_ops.compute_chroma_fingerprint", return_value="mockfp"),
    ):
        reset_storage()
        yield client


def test_merge_tracks_endpoint(seeded_client_with_source):
    resp = seeded_client_with_source.post("/api/tracks/1/merge", json={"other_track_id": 2})
    assert resp.status_code == 200
    tracks = resp.json()
    assert len(tracks) == 2
    assert tracks[0]["start_sec"] == 0.0
    assert tracks[0]["end_sec"] == 600.0


def test_merge_non_adjacent_returns_400(seeded_client_with_source):
    resp = seeded_client_with_source.post("/api/tracks/1/merge", json={"other_track_id": 3})
    assert resp.status_code == 400


def test_split_track_endpoint(seeded_client_with_source):
    resp = seeded_client_with_source.post("/api/tracks/1/split", json={"split_at_sec": 150.0})
    assert resp.status_code == 200
    tracks = resp.json()
    assert len(tracks) == 4
    assert tracks[0]["end_sec"] == 150.0
    assert tracks[1]["start_sec"] == 150.0


def test_split_invalid_position_returns_400(seeded_client_with_source):
    resp = seeded_client_with_source.post("/api/tracks/1/split", json={"split_at_sec": 0.5})
    assert resp.status_code == 400


def test_reprocess_session(auth_client, tmp_path):
    from unittest.mock import MagicMock, patch

    from jam_session_processor.splitter import SplitResult

    client, uid, gid = auth_client
    db = api._db
    source = tmp_path / "source.m4a"
    source.write_bytes(b"\x00" * 100)
    sid = db.create_session(str(source), gid, date="2026-02-03")

    output_dir = tmp_path / "output"
    output_dir.mkdir()
    for i in range(1, 3):
        audio = output_dir / f"track{i}.wav"
        audio.write_bytes(b"RIFF" + b"\x00" * 100)
        db.create_track(
            sid, track_number=i, start_sec=(i - 1) * 300.0, end_sec=i * 300.0, audio_path=str(audio)
        )

    new_segments = [(0.0, 200.0), (210.0, 400.0), (420.0, 600.0)]
    mock_result = SplitResult(segments=new_segments, total_duration_sec=600.0)

    def mock_export(file_path, segments, output_dir, **kwargs):
        paths = []
        for i, (s, e) in enumerate(segments, 1):
            p = output_dir / f"new_track{i}.wav"
            p.write_bytes(b"RIFF" + b"\x00" * 100)
            paths.append(p)
        return paths

    mock_meta = MagicMock()
    mock_meta.recording_date = None

    with (
        patch("jam_session_processor.splitter.detect_songs", return_value=mock_result),
        patch("jam_session_processor.output.export_segments", side_effect=mock_export),
        patch(
            "jam_session_processor.fingerprint.compute_chroma_fingerprint", return_value="mockfp"
        ),
        patch("jam_session_processor.metadata.extract_metadata", return_value=mock_meta),
    ):
        resp = client.post(
            f"/api/sessions/{sid}/reprocess",
            json={"threshold": -25.0, "min_duration": 60},
        )

    assert resp.status_code == 200
    tracks = resp.json()
    assert len(tracks) == 3
    assert tracks[0]["start_sec"] == 0.0
    assert tracks[0]["end_sec"] == 200.0
    assert tracks[2]["start_sec"] == 420.0


def test_reprocess_source_not_found(auth_client, tmp_path):
    client, uid, gid = auth_client
    db = api._db
    sid = db.create_session("/nonexistent/file.m4a", gid, date="2026-02-03")

    resp = client.post(
        f"/api/sessions/{sid}/reprocess",
        json={"threshold": -30.0, "min_duration": 120},
    )
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


def test_delete_session_endpoint(seeded_client):
    client, uid, gid = seeded_client
    resp = client.request("DELETE", "/api/sessions/1", json={"delete_files": False})
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    resp = client.get("/api/sessions/1")
    assert resp.status_code == 404


def test_rename_song_endpoint(seeded_client):
    client, uid, gid = seeded_client
    client.post("/api/tracks/1/tag", json={"song_name": "Fat Cat"})

    songs = client.get("/api/songs").json()
    song_id = songs[0]["id"]

    resp = client.put(f"/api/songs/{song_id}/name", json={"name": "Fat Cat Blues"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Fat Cat Blues"

    resp = client.get("/api/sessions/1/tracks")
    assert resp.json()[0]["song_name"] == "Fat Cat Blues"


def test_get_song_endpoint(seeded_client):
    client, uid, gid = seeded_client
    client.post("/api/tracks/1/tag", json={"song_name": "Fat Cat"})

    songs = client.get("/api/songs").json()
    song_id = songs[0]["id"]

    resp = client.get(f"/api/songs/{song_id}")
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Fat Cat"
    assert data["chart"] == ""
    assert data["lyrics"] == ""
    assert data["notes"] == ""
    assert data["take_count"] == 1


def test_get_song_not_found(auth_client):
    client, uid, gid = auth_client
    resp = client.get("/api/songs/9999")
    assert resp.status_code == 404


def test_update_song_details_endpoint(seeded_client):
    client, uid, gid = seeded_client
    client.post("/api/tracks/1/tag", json={"song_name": "Fat Cat"})

    songs = client.get("/api/songs").json()
    song_id = songs[0]["id"]

    resp = client.put(
        f"/api/songs/{song_id}/details",
        json={
            "chart": "Intro: Am | G | F | E\nVerse: C | G",
            "lyrics": "Some lyrics here",
            "notes": "Play slow",
        },
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["chart"] == "Intro: Am | G | F | E\nVerse: C | G"
    assert data["lyrics"] == "Some lyrics here"
    assert data["notes"] == "Play slow"

    resp = client.get(f"/api/songs/{song_id}")
    assert resp.json()["chart"] == "Intro: Am | G | F | E\nVerse: C | G"


def test_update_song_details_not_found(auth_client):
    client, uid, gid = auth_client
    resp = client.put("/api/songs/9999/details", json={"chart": "C"})
    assert resp.status_code == 404


def test_delete_song_endpoint(seeded_client):
    client, uid, gid = seeded_client
    client.post("/api/tracks/1/tag", json={"song_name": "Fat Cat"})

    songs = client.get("/api/songs").json()
    song_id = songs[0]["id"]

    resp = client.delete(f"/api/songs/{song_id}")
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    assert client.get(f"/api/songs/{song_id}").status_code == 404
    assert client.get("/api/songs").json() == []

    tracks = client.get("/api/sessions/1/tracks").json()
    assert tracks[0]["song_id"] is None


def test_delete_song_not_found(auth_client):
    client, uid, gid = auth_client
    resp = client.delete("/api/songs/9999")
    assert resp.status_code == 404


def test_rename_song_collision_returns_400(seeded_client):
    client, uid, gid = seeded_client
    client.post("/api/tracks/1/tag", json={"song_name": "Fat Cat"})
    client.post("/api/tracks/2/tag", json={"song_name": "Spit Me Out"})

    songs = client.get("/api/songs").json()
    fat_cat_id = next(s["id"] for s in songs if s["name"] == "Fat Cat")

    resp = client.put(f"/api/songs/{fat_cat_id}/name", json={"name": "Spit Me Out"})
    assert resp.status_code == 400


# --- Upload endpoint tests ---


def test_upload_session(auth_client, tmp_path):
    from io import BytesIO
    from unittest.mock import MagicMock, patch

    from jam_session_processor.splitter import SplitResult

    client, uid, gid = auth_client

    segments = [(0.0, 200.0), (210.0, 400.0)]
    mock_result = SplitResult(segments=segments, total_duration_sec=400.0)

    mock_meta = MagicMock()
    mock_meta.recording_date = None

    def mock_export(file_path, segments, output_dir, **kwargs):
        output_dir.mkdir(parents=True, exist_ok=True)
        paths = []
        for i, (s, e) in enumerate(segments, 1):
            p = output_dir / f"track{i}.wav"
            p.write_bytes(b"RIFF" + b"\x00" * 100)
            paths.append(p)
        return paths

    with (
        patch("jam_session_processor.splitter.detect_songs", return_value=mock_result),
        patch("jam_session_processor.output.export_segments", side_effect=mock_export),
        patch(
            "jam_session_processor.fingerprint.compute_chroma_fingerprint", return_value="mockfp"
        ),
        patch("jam_session_processor.metadata.extract_metadata", return_value=mock_meta),
    ):
        resp = client.post(
            "/api/sessions/upload",
            files={"file": ("test-session.m4a", BytesIO(b"\x00" * 100), "audio/mp4")},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["track_count"] == 2
    assert "test-session" in data["source_file"]
    assert data["group_id"] == gid


def test_upload_invalid_type(auth_client, tmp_path):
    from io import BytesIO

    client, uid, gid = auth_client

    resp = client.post(
        "/api/sessions/upload",
        files={"file": ("notes.txt", BytesIO(b"hello"), "text/plain")},
    )
    assert resp.status_code == 400
    assert "Invalid file type" in resp.json()["detail"]


def test_upload_duplicate(auth_client, tmp_path):
    from io import BytesIO
    from unittest.mock import MagicMock, patch

    from jam_session_processor.splitter import SplitResult

    client, uid, gid = auth_client
    mock_result = SplitResult(segments=[], total_duration_sec=100.0)
    mock_meta = MagicMock()
    mock_meta.recording_date = None

    with (
        patch("jam_session_processor.splitter.detect_songs", return_value=mock_result),
        patch("jam_session_processor.metadata.extract_metadata", return_value=mock_meta),
    ):
        resp = client.post(
            "/api/sessions/upload",
            files={"file": ("dup.m4a", BytesIO(b"\x00" * 50), "audio/mp4")},
        )
    assert resp.status_code == 200

    # Second upload of same filename should 409
    resp = client.post(
        "/api/sessions/upload",
        files={"file": ("dup.m4a", BytesIO(b"\x00" * 50), "audio/mp4")},
    )
    assert resp.status_code == 409


def test_upload_too_large(auth_client, monkeypatch):
    """Upload exceeding max size should return 413."""
    from io import BytesIO

    from jam_session_processor.config import reset_config

    client, uid, gid = auth_client
    monkeypatch.setenv("JAM_MAX_UPLOAD_MB", "0")
    reset_config()

    content = b"\x00" * 2048
    resp = client.post(
        "/api/sessions/upload",
        files={"file": ("big.m4a", BytesIO(content), "audio/mp4")},
    )
    assert resp.status_code == 413
    assert "too large" in resp.json()["detail"].lower()
    reset_config()


def test_upload_with_api_key(client, tmp_path):
    from io import BytesIO
    from unittest.mock import MagicMock, patch

    from jam_session_processor.splitter import SplitResult

    db = api._db
    gid = db.create_group("TestBand")

    mock_result = SplitResult(segments=[], total_duration_sec=100.0)
    mock_meta = MagicMock()
    mock_meta.recording_date = None

    with (
        patch("jam_session_processor.splitter.detect_songs", return_value=mock_result),
        patch("jam_session_processor.metadata.extract_metadata", return_value=mock_meta),
    ):
        resp = client.post(
            f"/api/sessions/upload?group_id={gid}",
            files={"file": ("apikey.m4a", BytesIO(b"\x00" * 50), "audio/mp4")},
            headers={"X-API-Key": "test-api-key"},
        )

    assert resp.status_code == 200


def test_upload_api_key_missing_group_id(client, tmp_path):
    from io import BytesIO

    resp = client.post(
        "/api/sessions/upload",
        files={"file": ("test.m4a", BytesIO(b"\x00" * 50), "audio/mp4")},
        headers={"X-API-Key": "test-api-key"},
    )
    assert resp.status_code == 400
    assert "group_id" in resp.json()["detail"].lower()


# --- Path stripping tests ---


def test_track_response_no_audio_path(seeded_client):
    client, uid, gid = seeded_client
    resp = client.get("/api/sessions/1/tracks")
    assert resp.status_code == 200
    tracks = resp.json()
    assert len(tracks) > 0
    for track in tracks:
        assert "audio_path" not in track


def test_song_track_response_no_audio_path(seeded_client):
    client, uid, gid = seeded_client
    client.post("/api/tracks/1/tag", json={"song_name": "Fat Cat"})

    songs = client.get("/api/songs").json()
    song_id = songs[0]["id"]

    resp = client.get(f"/api/songs/{song_id}/tracks")
    assert resp.status_code == 200
    tracks = resp.json()
    assert len(tracks) > 0
    for track in tracks:
        assert "audio_path" not in track


def test_session_source_file_is_basename(seeded_client):
    client, uid, gid = seeded_client
    resp = client.get("/api/sessions/1")
    assert resp.status_code == 200
    source = resp.json()["source_file"]
    assert "/" not in source
    assert "\\" not in source
    assert source == "session1.m4a"


def test_song_track_source_file_is_basename(seeded_client):
    client, uid, gid = seeded_client
    client.post("/api/tracks/1/tag", json={"song_name": "Fat Cat"})

    songs = client.get("/api/songs").json()
    song_id = songs[0]["id"]

    resp = client.get(f"/api/songs/{song_id}/tracks")
    tracks = resp.json()
    for track in tracks:
        assert "/" not in track["source_file"]
        assert "\\" not in track["source_file"]


# --- Group scoping tests ---


def test_cannot_see_other_groups_sessions(client, tmp_path):
    db = api._db
    # User 1 in Group A
    uid1 = db.create_user("user1@example.com", hash_password("pw"), name="User1", role="admin")
    gid_a = db.create_group("GroupA")
    db.assign_user_to_group(uid1, gid_a)
    # User 2 in Group B
    uid2 = db.create_user("user2@example.com", hash_password("pw"), name="User2", role="admin")
    gid_b = db.create_group("GroupB")
    db.assign_user_to_group(uid2, gid_b)

    # Create session in Group A
    db.create_session("groupA.m4a", gid_a, date="2026-02-01")
    # Create session in Group B
    db.create_session("groupB.m4a", gid_b, date="2026-02-02")

    # User 1 should only see Group A sessions
    # Login as user1
    resp = client.post("/api/auth/login", json={"email": "user1@example.com", "password": "pw"})
    assert resp.status_code == 200

    resp = client.get("/api/sessions")
    sessions = resp.json()
    assert len(sessions) == 1
    assert sessions[0]["source_file"] == "groupA.m4a"

    # User 1 should get 404 for Group B session
    resp = client.get("/api/sessions/2")
    assert resp.status_code == 404


def test_cannot_see_other_groups_songs(client, tmp_path):
    db = api._db
    uid1 = db.create_user("user1@example.com", hash_password("pw"), role="admin")
    gid_a = db.create_group("GroupA")
    db.assign_user_to_group(uid1, gid_a)

    uid2 = db.create_user("user2@example.com", hash_password("pw"), role="admin")
    gid_b = db.create_group("GroupB")
    db.assign_user_to_group(uid2, gid_b)

    # Create songs in each group
    sid_a = db.create_session("a.m4a", gid_a)
    tid_a = db.create_track(sid_a, 1, 0, 300, "ta.wav")
    db.tag_track(tid_a, "Song A", gid_a)

    sid_b = db.create_session("b.m4a", gid_b)
    tid_b = db.create_track(sid_b, 1, 0, 300, "tb.wav")
    db.tag_track(tid_b, "Song B", gid_b)

    # User 1 sees only Song A
    resp = client.post("/api/auth/login", json={"email": "user1@example.com", "password": "pw"})
    assert resp.status_code == 200
    songs = client.get("/api/songs").json()
    assert len(songs) == 1
    assert songs[0]["name"] == "Song A"


# --- Role enforcement tests ---


def _login_as(client, db, email, role="editor", group_name="TestBand", group_id=None):
    """Create a user with a role, assign to a group, and login."""
    uid = db.create_user(email, hash_password("pw"), role=role)
    if group_id is None:
        group = db.get_group_by_name(group_name)
        if not group:
            group_id = db.create_group(group_name)
        else:
            group_id = group.id
    db.assign_user_to_group(uid, group_id)
    resp = client.post("/api/auth/login", json={"email": email, "password": "pw"})
    assert resp.status_code == 200
    return uid, group_id


def test_login_includes_role(client):
    db = api._db
    _create_user_and_group(db, role="admin")
    resp = client.post(
        "/api/auth/login",
        json={"email": "test@example.com", "password": "password"},
    )
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"


def test_get_me_includes_role(client):
    db = api._db
    _login_as(client, db, "editor@test.com", role="editor")
    resp = client.get("/api/auth/me")
    assert resp.status_code == 200
    assert resp.json()["role"] == "editor"


def test_readonly_cannot_edit_session_notes(client, tmp_path):
    db = api._db
    gid = db.create_group("Band")
    uid, _ = _login_as(client, db, "readonly@test.com", role="readonly", group_id=gid)
    sid = db.create_session("test.m4a", gid, date="2026-02-03")

    resp = client.put(f"/api/sessions/{sid}/notes", json={"notes": "new notes"})
    assert resp.status_code == 403


def test_readonly_cannot_tag_track(client, tmp_path):
    db = api._db
    gid = db.create_group("Band")
    _login_as(client, db, "readonly@test.com", role="readonly", group_id=gid)
    sid = db.create_session("test.m4a", gid, date="2026-02-03")
    tid = db.create_track(sid, 1, 0, 300, "t.wav")

    resp = client.post(f"/api/tracks/{tid}/tag", json={"song_name": "Song"})
    assert resp.status_code == 403


def test_readonly_can_view_sessions(client, tmp_path):
    db = api._db
    gid = db.create_group("Band")
    _login_as(client, db, "readonly@test.com", role="readonly", group_id=gid)
    db.create_session("test.m4a", gid, date="2026-02-03")

    resp = client.get("/api/sessions")
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_editor_cannot_delete_session(client, tmp_path):
    db = api._db
    gid = db.create_group("Band")
    _login_as(client, db, "editor@test.com", role="editor", group_id=gid)
    sid = db.create_session("test.m4a", gid, date="2026-02-03")

    resp = client.request("DELETE", f"/api/sessions/{sid}", json={"delete_files": False})
    assert resp.status_code == 403


def test_editor_can_edit_session_notes(client, tmp_path):
    db = api._db
    gid = db.create_group("Band")
    _login_as(client, db, "editor@test.com", role="editor", group_id=gid)
    sid = db.create_session("test.m4a", gid, date="2026-02-03")

    resp = client.put(f"/api/sessions/{sid}/notes", json={"notes": "new notes"})
    assert resp.status_code == 200
    assert resp.json()["notes"] == "new notes"


def test_admin_cannot_access_admin_users(client, tmp_path):
    db = api._db
    gid = db.create_group("Band")
    _login_as(client, db, "admin@test.com", role="admin", group_id=gid)

    resp = client.get("/api/admin/users")
    assert resp.status_code == 403


def test_superadmin_can_access_admin_users(client, tmp_path):
    db = api._db
    gid = db.create_group("Band")
    _login_as(client, db, "super@test.com", role="superadmin", group_id=gid)

    resp = client.get("/api/admin/users")
    assert resp.status_code == 200


def test_superadmin_can_update_role(client, tmp_path):
    db = api._db
    gid = db.create_group("Band")
    _login_as(client, db, "super@test.com", role="superadmin", group_id=gid)
    target_uid = db.create_user("target@test.com", hash_password("pw"), role="editor")

    resp = client.put(f"/api/admin/users/{target_uid}/role", json={"role": "admin"})
    assert resp.status_code == 200
    assert resp.json()["role"] == "admin"


def test_update_role_invalid(client, tmp_path):
    db = api._db
    gid = db.create_group("Band")
    _login_as(client, db, "super@test.com", role="superadmin", group_id=gid)
    target_uid = db.create_user("target@test.com", hash_password("pw"), role="editor")

    resp = client.put(f"/api/admin/users/{target_uid}/role", json={"role": "wizard"})
    assert resp.status_code == 400


def test_admin_create_user_with_role(client, tmp_path):
    db = api._db
    gid = db.create_group("Band")
    _login_as(client, db, "super@test.com", role="superadmin", group_id=gid)

    resp = client.post(
        "/api/admin/users",
        json={"email": "new@test.com", "password": "pw", "name": "New", "role": "readonly"},
    )
    assert resp.status_code == 201
    assert resp.json()["role"] == "readonly"
