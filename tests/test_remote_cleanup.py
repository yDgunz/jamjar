"""Tests that local files are cleaned up after processing when using remote (R2) storage.

These tests use a mock storage backend that behaves like R2 (is_remote=True)
but operates on local files, verifying that temporary local copies of source
recordings and exported tracks are deleted after processing completes.
"""

import time
from io import BytesIO
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from jam_session_processor import api
from jam_session_processor.auth import hash_password
from jam_session_processor.config import reset_config
from jam_session_processor.db import Database
from jam_session_processor.splitter import SplitResult
from jam_session_processor.storage import LocalStorage, reset_storage


class FakeRemoteStorage(LocalStorage):
    """A storage backend that acts like R2 but uses local files.

    is_remote=True triggers the cleanup code paths, while the actual
    file operations work locally so tests can verify files are deleted.
    """

    @property
    def is_remote(self) -> bool:
        return True

    def url(self, key: str) -> str | None:
        return f"https://fake-r2.example.com/{key}"

    def presigned_put_url(self, key: str, content_type: str, ttl: int = 900) -> str | None:
        return f"https://fake-r2.example.com/upload/{key}"


def _poll_job(client, job_id, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        resp = client.get(f"/api/jobs/{job_id}")
        assert resp.status_code == 200
        job = resp.json()
        if job["status"] in ("completed", "failed"):
            return job
        time.sleep(0.1)
    raise TimeoutError(f"Job {job_id} did not complete within {timeout}s")


@pytest.fixture
def remote_client(tmp_path, monkeypatch):
    """Test client with a fake remote storage backend."""
    monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("JAM_JWT_SECRET", "test-secret")
    monkeypatch.setenv("JAM_API_KEY", "test-api-key")
    monkeypatch.delenv("JAM_R2_BUCKET", raising=False)
    monkeypatch.delenv("JAM_R2_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("JAM_R2_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("JAM_R2_SECRET_ACCESS_KEY", raising=False)
    reset_config()
    reset_storage()

    fake_storage = FakeRemoteStorage()

    db = Database(tmp_path / "test.db")
    api._db = db

    with patch("jam_session_processor.storage.get_storage", return_value=fake_storage):
        # Create user and group
        uid = db.create_user(
            "test@example.com", hash_password("password"), name="Test User", role="admin"
        )
        gid = db.create_group("TestBand")
        db.assign_user_to_group(uid, gid)

        client = TestClient(api.app)
        resp = client.post(
            "/api/auth/login",
            json={"email": "test@example.com", "password": "password"},
        )
        assert resp.status_code == 200

        yield client, db, uid, gid, tmp_path, fake_storage

    db.close()
    api._db = None
    reset_storage()
    reset_config()


def _mock_export(file_path, segments, output_dir, **kwargs):
    """Create fake track files and return their paths."""
    output_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for i, (s, e) in enumerate(segments, 1):
        p = output_dir / f"track{i}.m4a"
        p.write_bytes(b"\x00" * 100)
        paths.append(p)
    return paths


def _make_mock_meta(duration=400.0, recording_date=None):
    meta = MagicMock()
    meta.duration_seconds = duration
    meta.recording_date = recording_date
    return meta


# --- Upload tests ---


def test_upload_cleans_up_local_source_and_tracks(remote_client):
    """After a multi-track upload with remote storage, local source and track files are deleted."""
    client, db, uid, gid, tmp_path, storage = remote_client

    segments = [(0.0, 200.0), (210.0, 400.0)]
    mock_result = SplitResult(segments=segments, total_duration_sec=400.0)

    with (
        patch("jam_session_processor.splitter.detect_songs", return_value=mock_result),
        patch("jam_session_processor.output.export_segments", side_effect=_mock_export),
        patch("jam_session_processor.metadata.extract_metadata", return_value=_make_mock_meta()),
    ):
        resp = client.post(
            "/api/sessions/upload",
            files={"file": ("test-session.m4a", BytesIO(b"\x00" * 100), "audio/mp4")},
        )
        assert resp.status_code == 202
        result = _poll_job(client, resp.json()["id"])

    assert result["status"] == "completed"

    # Source recording should be cleaned up
    recordings = list((tmp_path / "recordings").glob("*"))
    assert recordings == [], f"Source files should be deleted but found: {recordings}"

    # Exported track files should be cleaned up
    tracks_dir = tmp_path / "tracks"
    if tracks_dir.exists():
        track_files = list(tracks_dir.rglob("*.m4a"))
        assert track_files == [], f"Track files should be deleted but found: {track_files}"


def test_upload_single_track_cleans_up(remote_client):
    """Single-track upload (single=true) also cleans up local files."""
    client, db, uid, gid, tmp_path, storage = remote_client

    with (
        patch("jam_session_processor.output.export_segments", side_effect=_mock_export),
        patch("jam_session_processor.metadata.extract_metadata", return_value=_make_mock_meta()),
    ):
        resp = client.post(
            "/api/sessions/upload?single=true",
            files={"file": ("single-song.m4a", BytesIO(b"\x00" * 100), "audio/mp4")},
        )
        assert resp.status_code == 202
        result = _poll_job(client, resp.json()["id"])

    assert result["status"] == "completed"

    recordings = list((tmp_path / "recordings").glob("*"))
    assert recordings == [], f"Source files should be deleted but found: {recordings}"


def test_upload_no_segments_cleans_up_source(remote_client):
    """When song detection finds no segments, the local source file is still cleaned up."""
    client, db, uid, gid, tmp_path, storage = remote_client

    mock_result = SplitResult(segments=[], total_duration_sec=400.0)

    with (
        patch("jam_session_processor.splitter.detect_songs", return_value=mock_result),
        patch("jam_session_processor.metadata.extract_metadata", return_value=_make_mock_meta()),
    ):
        resp = client.post(
            "/api/sessions/upload",
            files={"file": ("empty-session.m4a", BytesIO(b"\x00" * 100), "audio/mp4")},
        )
        assert resp.status_code == 202
        result = _poll_job(client, resp.json()["id"])

    assert result["status"] == "completed"

    recordings = list((tmp_path / "recordings").glob("*"))
    assert recordings == [], f"Source files should be deleted but found: {recordings}"


def test_upload_processing_error_cleans_up(remote_client):
    """When processing fails with an exception, local files are still cleaned up."""
    client, db, uid, gid, tmp_path, storage = remote_client

    with (
        patch(
            "jam_session_processor.splitter.detect_songs",
            side_effect=RuntimeError("processing failed"),
        ),
        patch("jam_session_processor.metadata.extract_metadata", return_value=_make_mock_meta()),
    ):
        resp = client.post(
            "/api/sessions/upload",
            files={"file": ("error-session.m4a", BytesIO(b"\x00" * 100), "audio/mp4")},
        )
        assert resp.status_code == 202
        result = _poll_job(client, resp.json()["id"])

    assert result["status"] == "failed"

    recordings = list((tmp_path / "recordings").glob("*"))
    assert recordings == [], f"Source files should be deleted after error but found: {recordings}"


# --- Reprocess tests ---


def test_reprocess_cleans_up_local_files(remote_client):
    """After reprocessing with remote storage, local source and track files are deleted."""
    client, db, uid, gid, tmp_path, storage = remote_client

    # Create a session with a source file
    recordings_dir = tmp_path / "recordings"
    recordings_dir.mkdir(parents=True, exist_ok=True)
    source = recordings_dir / "source.m4a"
    source.write_bytes(b"\x00" * 100)
    source_rel = "recordings/source.m4a"

    sid = db.create_session("source.m4a", gid, date="2026-02-03")
    db.update_session_source_file(sid, source_rel)

    # Create existing tracks
    output_dir = tmp_path / "tracks" / str(sid)
    output_dir.mkdir(parents=True, exist_ok=True)
    for i in range(1, 3):
        audio = output_dir / f"track{i}.m4a"
        audio.write_bytes(b"\x00" * 100)
        rel = f"tracks/{sid}/track{i}.m4a"
        db.create_track(
            sid, track_number=i, start_sec=(i - 1) * 300.0, end_sec=i * 300.0, audio_path=rel
        )

    new_segments = [(0.0, 200.0), (210.0, 400.0), (420.0, 600.0)]
    mock_result = SplitResult(segments=new_segments, total_duration_sec=600.0)

    with (
        patch("jam_session_processor.splitter.detect_songs", return_value=mock_result),
        patch("jam_session_processor.output.export_segments", side_effect=_mock_export),
        patch(
            "jam_session_processor.metadata.extract_metadata", return_value=_make_mock_meta(600.0)
        ),
    ):
        resp = client.post(
            f"/api/sessions/{sid}/reprocess",
            json={"threshold": -25.0, "min_duration": 60},
        )
        assert resp.status_code == 202
        result = _poll_job(client, resp.json()["id"])

    assert result["status"] == "completed"

    # Source file should be cleaned up
    assert not source.exists(), "Source file should be deleted after reprocessing"

    # Newly exported track files should be cleaned up (uploaded to remote)
    track_files = list(output_dir.glob("*.m4a"))
    assert track_files == [], f"Track files should be deleted but found: {track_files}"


def test_reprocess_no_segments_cleans_up_source(remote_client):
    """When reprocessing finds no segments, the local source file is still cleaned up."""
    client, db, uid, gid, tmp_path, storage = remote_client

    recordings_dir = tmp_path / "recordings"
    recordings_dir.mkdir(parents=True, exist_ok=True)
    source = recordings_dir / "source.m4a"
    source.write_bytes(b"\x00" * 100)
    source_rel = "recordings/source.m4a"

    sid = db.create_session("source.m4a", gid, date="2026-02-03")
    db.update_session_source_file(sid, source_rel)

    mock_result = SplitResult(segments=[], total_duration_sec=400.0)

    with (
        patch("jam_session_processor.splitter.detect_songs", return_value=mock_result),
        patch("jam_session_processor.metadata.extract_metadata", return_value=_make_mock_meta()),
    ):
        resp = client.post(
            f"/api/sessions/{sid}/reprocess",
            json={"threshold": -25.0, "min_duration": 60},
        )
        assert resp.status_code == 202
        result = _poll_job(client, resp.json()["id"])

    assert result["status"] == "completed"
    assert not source.exists(), "Source file should be deleted even with no segments"


def test_reprocess_error_cleans_up(remote_client):
    """When reprocessing fails, the local source file is still cleaned up."""
    client, db, uid, gid, tmp_path, storage = remote_client

    recordings_dir = tmp_path / "recordings"
    recordings_dir.mkdir(parents=True, exist_ok=True)
    source = recordings_dir / "source.m4a"
    source.write_bytes(b"\x00" * 100)
    source_rel = "recordings/source.m4a"

    sid = db.create_session("source.m4a", gid, date="2026-02-03")
    db.update_session_source_file(sid, source_rel)

    with (
        patch(
            "jam_session_processor.splitter.detect_songs",
            side_effect=RuntimeError("reprocess failed"),
        ),
        patch("jam_session_processor.metadata.extract_metadata", return_value=_make_mock_meta()),
    ):
        resp = client.post(
            f"/api/sessions/{sid}/reprocess",
            json={"threshold": -25.0, "min_duration": 60},
        )
        assert resp.status_code == 202
        result = _poll_job(client, resp.json()["id"])

    assert result["status"] == "failed"
    assert not source.exists(), "Source file should be deleted after error"


# --- Local storage tests (files should NOT be cleaned up) ---


def test_local_storage_preserves_files(tmp_path, monkeypatch):
    """With local storage (not remote), source and track files are preserved."""
    monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("JAM_JWT_SECRET", "test-secret")
    monkeypatch.delenv("JAM_R2_BUCKET", raising=False)
    monkeypatch.delenv("JAM_R2_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("JAM_R2_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("JAM_R2_SECRET_ACCESS_KEY", raising=False)
    reset_config()
    reset_storage()

    db = Database(tmp_path / "test.db")
    api._db = db

    try:
        uid = db.create_user(
            "test@example.com", hash_password("password"), name="Test User", role="admin"
        )
        gid = db.create_group("TestBand")
        db.assign_user_to_group(uid, gid)

        client = TestClient(api.app)
        client.post(
            "/api/auth/login",
            json={"email": "test@example.com", "password": "password"},
        )

        segments = [(0.0, 200.0), (210.0, 400.0)]
        mock_result = SplitResult(segments=segments, total_duration_sec=400.0)

        with (
            patch("jam_session_processor.splitter.detect_songs", return_value=mock_result),
            patch("jam_session_processor.output.export_segments", side_effect=_mock_export),
            patch(
                "jam_session_processor.metadata.extract_metadata",
                return_value=_make_mock_meta(),
            ),
        ):
            resp = client.post(
                "/api/sessions/upload",
                files={"file": ("local-test.m4a", BytesIO(b"\x00" * 100), "audio/mp4")},
            )
            assert resp.status_code == 202
            result = _poll_job(client, resp.json()["id"])

        assert result["status"] == "completed"

        # Source file should still exist with local storage
        recordings = list((tmp_path / "recordings").glob("*"))
        assert len(recordings) == 1, "Source file should be preserved with local storage"

        # Track files should still exist
        track_files = list((tmp_path / "tracks").rglob("*.m4a"))
        assert len(track_files) == 2, "Track files should be preserved with local storage"

    finally:
        db.close()
        api._db = None
        reset_storage()
        reset_config()
