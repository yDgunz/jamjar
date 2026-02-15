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
