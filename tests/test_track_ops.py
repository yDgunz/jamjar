from unittest.mock import patch

import pytest

from jam_session_processor.db import Database
from jam_session_processor.track_ops import merge_tracks, split_track


@pytest.fixture
def db(tmp_path):
    database = Database(tmp_path / "test.db")
    yield database
    database.close()


@pytest.fixture
def session_with_tracks(db, tmp_path):
    """Create a session with 3 tracks and dummy audio files."""
    output_dir = tmp_path / "output"
    output_dir.mkdir()

    sid = db.create_session(str(tmp_path / "source.m4a"), date="2026-02-03")

    tracks = []
    for i in range(1, 4):
        audio = output_dir / f"track{i}.wav"
        audio.write_bytes(b"RIFF" + b"\x00" * 100)
        tid = db.create_track(
            sid, track_number=i,
            start_sec=(i - 1) * 300.0, end_sec=i * 300.0,
            audio_path=str(audio), fingerprint=f"fp{i}",
        )
        tracks.append(tid)

    return sid, tracks, output_dir


def _mock_export(file_path, output_path, start_sec, end_sec):
    """Mock export_segment: just create an empty file."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(b"RIFF" + b"\x00" * 100)


def _mock_fingerprint(file_path, start_sec=0, duration_sec=0):
    return "mockfp"


@patch("jam_session_processor.track_ops.export_segment", side_effect=_mock_export)
@patch("jam_session_processor.track_ops.compute_chroma_fingerprint", side_effect=_mock_fingerprint)
def test_merge_adjacent_tracks(mock_fp, mock_export, db, session_with_tracks):
    sid, tids, output_dir = session_with_tracks

    result = merge_tracks(db, tids[0], tids[1])

    assert len(result) == 2
    assert result[0].track_number == 1
    assert result[0].start_sec == 0.0
    assert result[0].end_sec == 600.0  # Merged: track 1 + track 2
    assert result[1].track_number == 2
    assert result[1].start_sec == 600.0  # Old track 3, renumbered


@patch("jam_session_processor.track_ops.export_segment", side_effect=_mock_export)
@patch("jam_session_processor.track_ops.compute_chroma_fingerprint", side_effect=_mock_fingerprint)
def test_merge_preserves_first_track_metadata(mock_fp, mock_export, db, session_with_tracks):
    sid, tids, output_dir = session_with_tracks
    db.tag_track(tids[0], "Fat Cat")
    db.update_track_notes(tids[0], "Great take")

    result = merge_tracks(db, tids[0], tids[1])

    assert result[0].song_name == "Fat Cat"
    assert result[0].notes == "Great take"


@patch("jam_session_processor.track_ops.export_segment", side_effect=_mock_export)
@patch("jam_session_processor.track_ops.compute_chroma_fingerprint", side_effect=_mock_fingerprint)
def test_merge_swaps_order_if_reversed(mock_fp, mock_export, db, session_with_tracks):
    """Passing track2, track1 should still merge correctly."""
    sid, tids, output_dir = session_with_tracks

    result = merge_tracks(db, tids[1], tids[0])

    assert len(result) == 2
    assert result[0].start_sec == 0.0
    assert result[0].end_sec == 600.0


def test_merge_non_adjacent_fails(db, session_with_tracks):
    sid, tids, output_dir = session_with_tracks

    with pytest.raises(ValueError, match="adjacent"):
        merge_tracks(db, tids[0], tids[2])


def test_merge_different_sessions_fails(db, tmp_path):
    output_dir = tmp_path / "output"
    output_dir.mkdir()

    sid1 = db.create_session("s1.m4a", date="2026-02-03")
    sid2 = db.create_session("s2.m4a", date="2026-02-04")

    audio1 = output_dir / "t1.wav"
    audio2 = output_dir / "t2.wav"
    audio1.write_bytes(b"RIFF" + b"\x00" * 100)
    audio2.write_bytes(b"RIFF" + b"\x00" * 100)

    tid1 = db.create_track(sid1, 1, 0, 300, str(audio1))
    tid2 = db.create_track(sid2, 1, 0, 300, str(audio2))

    with pytest.raises(ValueError, match="same session"):
        merge_tracks(db, tid1, tid2)


@patch("jam_session_processor.track_ops.export_segment", side_effect=_mock_export)
@patch("jam_session_processor.track_ops.compute_chroma_fingerprint", side_effect=_mock_fingerprint)
def test_split_track(mock_fp, mock_export, db, session_with_tracks):
    sid, tids, output_dir = session_with_tracks

    # Split track 1 (0-300s) at 150s
    result = split_track(db, tids[0], 150.0)

    assert len(result) == 4  # 2 halves + original tracks 2 and 3
    assert result[0].track_number == 1
    assert result[0].start_sec == 0.0
    assert result[0].end_sec == 150.0
    assert result[1].track_number == 2
    assert result[1].start_sec == 150.0
    assert result[1].end_sec == 300.0
    assert result[2].track_number == 3  # Old track 2, renumbered
    assert result[3].track_number == 4  # Old track 3, renumbered


@patch("jam_session_processor.track_ops.export_segment", side_effect=_mock_export)
@patch("jam_session_processor.track_ops.compute_chroma_fingerprint", side_effect=_mock_fingerprint)
def test_split_preserves_first_half_metadata(mock_fp, mock_export, db, session_with_tracks):
    sid, tids, output_dir = session_with_tracks
    db.tag_track(tids[0], "Fat Cat")
    db.update_track_notes(tids[0], "Great take")

    result = split_track(db, tids[0], 150.0)

    assert result[0].song_name == "Fat Cat"
    assert result[0].notes == "Great take"
    assert result[1].song_name is None
    assert result[1].notes == ""


def test_split_at_edge_fails(db, session_with_tracks):
    sid, tids, output_dir = session_with_tracks

    with pytest.raises(ValueError, match="more than 1 second"):
        split_track(db, tids[0], 0.5)

    with pytest.raises(ValueError, match="more than 1 second"):
        split_track(db, tids[0], 299.5)


def test_merge_nonexistent_track_fails(db, session_with_tracks):
    sid, tids, output_dir = session_with_tracks

    with pytest.raises(ValueError, match="not found"):
        merge_tracks(db, tids[0], 9999)


def test_split_nonexistent_track_fails(db):
    with pytest.raises(ValueError, match="not found"):
        split_track(db, 9999, 150.0)


@patch("jam_session_processor.track_ops.export_segment", side_effect=_mock_export)
@patch("jam_session_processor.track_ops.compute_chroma_fingerprint", side_effect=_mock_fingerprint)
def test_merge_deletes_old_audio_files(mock_fp, mock_export, db, session_with_tracks):
    sid, tids, output_dir = session_with_tracks

    # Get audio paths before merge
    t1 = db.get_track(tids[0])
    t2 = db.get_track(tids[1])
    from pathlib import Path
    assert Path(t1.audio_path).exists()
    assert Path(t2.audio_path).exists()

    merge_tracks(db, tids[0], tids[1])

    # Old files should be deleted
    assert not Path(t1.audio_path).exists()
    assert not Path(t2.audio_path).exists()
