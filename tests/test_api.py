import pytest
from fastapi.testclient import TestClient

from jam_session_processor import api
from jam_session_processor.db import Database


@pytest.fixture
def client(tmp_path):
    db = Database(tmp_path / "test.db")
    api._db = db
    yield TestClient(api.app)
    db.close()
    api._db = None


@pytest.fixture
def seeded_client(client, tmp_path):
    """Client with a session and tracks already in the DB."""
    db = api._db
    sid = db.create_session("session1.m4a", date="2026-02-03", notes="Test session")
    # Create audio files so streaming works
    for i in range(1, 4):
        audio = tmp_path / f"track{i}.wav"
        audio.write_bytes(b"RIFF" + b"\x00" * 100)
        db.create_track(sid, track_number=i, start_sec=(i - 1) * 300.0,
                        end_sec=i * 300.0, audio_path=str(audio))
    return client


def test_list_sessions_empty(client):
    resp = client.get("/api/sessions")
    assert resp.status_code == 200
    assert resp.json() == []


def test_list_sessions(seeded_client):
    resp = seeded_client.get("/api/sessions")
    assert resp.status_code == 200
    sessions = resp.json()
    assert len(sessions) == 1
    assert sessions[0]["source_file"] == "session1.m4a"
    assert sessions[0]["track_count"] == 3
    assert sessions[0]["song_names"] == ""


def test_session_song_names(seeded_client):
    seeded_client.post("/api/tracks/1/tag", json={"song_name": "Fat Cat"})
    seeded_client.post("/api/tracks/2/tag", json={"song_name": "Spit Me Out"})

    resp = seeded_client.get("/api/sessions")
    sessions = resp.json()
    names = sessions[0]["song_names"].split(",")
    assert "Fat Cat" in names
    assert "Spit Me Out" in names

    # Also verify in get_session
    resp = seeded_client.get("/api/sessions/1")
    assert "Fat Cat" in resp.json()["song_names"]


def test_get_session(seeded_client):
    resp = seeded_client.get("/api/sessions/1")
    assert resp.status_code == 200
    assert resp.json()["date"] == "2026-02-03"


def test_get_session_not_found(client):
    resp = client.get("/api/sessions/999")
    assert resp.status_code == 404


def test_get_session_tracks(seeded_client):
    resp = seeded_client.get("/api/sessions/1/tracks")
    assert resp.status_code == 200
    tracks = resp.json()
    assert len(tracks) == 3
    assert tracks[0]["track_number"] == 1
    assert tracks[2]["track_number"] == 3


def test_tag_and_untag_track(seeded_client):
    # Tag
    resp = seeded_client.post("/api/tracks/1/tag", json={"song_name": "Fat Cat"})
    assert resp.status_code == 200
    assert resp.json()["song_name"] == "Fat Cat"

    # Verify in session tracks
    resp = seeded_client.get("/api/sessions/1/tracks")
    assert resp.json()[0]["song_name"] == "Fat Cat"

    # Untag
    resp = seeded_client.delete("/api/tracks/1/tag")
    assert resp.status_code == 200

    resp = seeded_client.get("/api/sessions/1/tracks")
    assert resp.json()[0]["song_name"] is None


def test_update_track_notes(seeded_client):
    resp = seeded_client.put("/api/tracks/1/notes", json={"notes": "Great take"})
    assert resp.status_code == 200
    assert resp.json()["notes"] == "Great take"


def test_stream_audio(seeded_client):
    resp = seeded_client.get("/api/tracks/1/audio")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "audio/wav"


def test_stream_audio_not_found(client):
    resp = client.get("/api/tracks/999/audio")
    assert resp.status_code == 404


def test_list_songs(seeded_client):
    # Tag two tracks with different songs
    seeded_client.post("/api/tracks/1/tag", json={"song_name": "Fat Cat"})
    seeded_client.post("/api/tracks/2/tag", json={"song_name": "Spit Me Out"})

    resp = seeded_client.get("/api/songs")
    assert resp.status_code == 200
    songs = resp.json()
    assert len(songs) == 2


def test_update_session_notes(seeded_client):
    resp = seeded_client.put("/api/sessions/1/notes", json={"notes": "Great rehearsal"})
    assert resp.status_code == 200
    assert resp.json()["notes"] == "Great rehearsal"

    # Verify it persisted
    resp = seeded_client.get("/api/sessions/1")
    assert resp.json()["notes"] == "Great rehearsal"


def test_get_song_tracks(seeded_client):
    seeded_client.post("/api/tracks/1/tag", json={"song_name": "Fat Cat"})
    seeded_client.post("/api/tracks/3/tag", json={"song_name": "Fat Cat"})

    # Find the song ID
    songs = seeded_client.get("/api/songs").json()
    song_id = songs[0]["id"]

    resp = seeded_client.get(f"/api/songs/{song_id}/tracks")
    assert resp.status_code == 200
    tracks = resp.json()
    assert len(tracks) == 2


@pytest.fixture
def seeded_client_with_source(client, tmp_path):
    """Client with a session whose source_file is a real path (for merge/split)."""
    from unittest.mock import patch

    db = api._db
    source = tmp_path / "source.m4a"
    source.write_bytes(b"\x00" * 100)
    sid = db.create_session(str(source), date="2026-02-03")

    output_dir = tmp_path / "output"
    output_dir.mkdir()
    for i in range(1, 4):
        audio = output_dir / f"track{i}.wav"
        audio.write_bytes(b"RIFF" + b"\x00" * 100)
        db.create_track(sid, track_number=i, start_sec=(i - 1) * 300.0,
                        end_sec=i * 300.0, audio_path=str(audio))

    def mock_export(file_path, output_path, start_sec, end_sec):
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_bytes(b"RIFF" + b"\x00" * 100)

    with patch("jam_session_processor.track_ops.export_segment", side_effect=mock_export), \
         patch("jam_session_processor.track_ops.compute_chroma_fingerprint", return_value="mockfp"):
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


def test_reprocess_session(client, tmp_path):
    from unittest.mock import patch, MagicMock
    from jam_session_processor.splitter import SplitResult

    db = api._db
    source = tmp_path / "source.m4a"
    source.write_bytes(b"\x00" * 100)
    sid = db.create_session(str(source), date="2026-02-03")

    output_dir = tmp_path / "output"
    output_dir.mkdir()
    # Create 2 old tracks
    for i in range(1, 3):
        audio = output_dir / f"track{i}.wav"
        audio.write_bytes(b"RIFF" + b"\x00" * 100)
        db.create_track(sid, track_number=i, start_sec=(i - 1) * 300.0,
                        end_sec=i * 300.0, audio_path=str(audio))

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

    with patch("jam_session_processor.splitter.detect_songs", return_value=mock_result), \
         patch("jam_session_processor.output.export_segments", side_effect=mock_export), \
         patch("jam_session_processor.fingerprint.compute_chroma_fingerprint", return_value="mockfp"), \
         patch("jam_session_processor.metadata.extract_metadata", return_value=mock_meta):
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


def test_reprocess_source_not_found(client, tmp_path):
    db = api._db
    sid = db.create_session("/nonexistent/file.m4a", date="2026-02-03")

    resp = client.post(
        f"/api/sessions/{sid}/reprocess",
        json={"threshold": -30.0, "min_duration": 120},
    )
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


def test_delete_session_endpoint(seeded_client):
    resp = seeded_client.request("DELETE", "/api/sessions/1",
                                json={"delete_files": False})
    assert resp.status_code == 200
    assert resp.json()["ok"] is True

    # Session should be gone
    resp = seeded_client.get("/api/sessions/1")
    assert resp.status_code == 404


def test_rename_song_endpoint(seeded_client):
    seeded_client.post("/api/tracks/1/tag", json={"song_name": "Fat Cat"})

    songs = seeded_client.get("/api/songs").json()
    song_id = songs[0]["id"]

    resp = seeded_client.put(f"/api/songs/{song_id}/name", json={"name": "Fat Cat Blues"})
    assert resp.status_code == 200
    assert resp.json()["name"] == "Fat Cat Blues"

    # Verify tracks still tagged
    resp = seeded_client.get("/api/sessions/1/tracks")
    assert resp.json()[0]["song_name"] == "Fat Cat Blues"


def test_rename_song_collision_returns_400(seeded_client):
    seeded_client.post("/api/tracks/1/tag", json={"song_name": "Fat Cat"})
    seeded_client.post("/api/tracks/2/tag", json={"song_name": "Spit Me Out"})

    songs = seeded_client.get("/api/songs").json()
    fat_cat_id = next(s["id"] for s in songs if s["name"] == "Fat Cat")

    resp = seeded_client.put(f"/api/songs/{fat_cat_id}/name", json={"name": "Spit Me Out"})
    assert resp.status_code == 400


# --- Upload endpoint tests ---


def test_upload_session(client, tmp_path, monkeypatch):
    from io import BytesIO
    from unittest.mock import MagicMock, patch

    from jam_session_processor.splitter import SplitResult

    # Point input/ to tmp_path so files are saved there
    monkeypatch.chdir(tmp_path)

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

    with patch("jam_session_processor.splitter.detect_songs", return_value=mock_result), \
         patch("jam_session_processor.output.export_segments", side_effect=mock_export), \
         patch("jam_session_processor.fingerprint.compute_chroma_fingerprint", return_value="mockfp"), \
         patch("jam_session_processor.metadata.extract_metadata", return_value=mock_meta):
        resp = client.post(
            "/api/sessions/upload",
            files={"file": ("test-session.m4a", BytesIO(b"\x00" * 100), "audio/mp4")},
        )

    assert resp.status_code == 200
    data = resp.json()
    assert data["track_count"] == 2
    assert "test-session" in data["source_file"]


def test_upload_invalid_type(client, tmp_path, monkeypatch):
    from io import BytesIO

    monkeypatch.chdir(tmp_path)

    resp = client.post(
        "/api/sessions/upload",
        files={"file": ("notes.txt", BytesIO(b"hello"), "text/plain")},
    )
    assert resp.status_code == 400
    assert "Invalid file type" in resp.json()["detail"]


def test_upload_duplicate(client, tmp_path, monkeypatch):
    from io import BytesIO
    from unittest.mock import MagicMock, patch

    from jam_session_processor.splitter import SplitResult

    monkeypatch.chdir(tmp_path)

    mock_result = SplitResult(segments=[], total_duration_sec=100.0)
    mock_meta = MagicMock()
    mock_meta.recording_date = None

    with patch("jam_session_processor.splitter.detect_songs", return_value=mock_result), \
         patch("jam_session_processor.metadata.extract_metadata", return_value=mock_meta):
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
