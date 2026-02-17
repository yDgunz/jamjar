from datetime import datetime

from jam_session_processor.output import export_segments, generate_output_name
from jam_session_processor.splitter import detect_songs


def test_generate_output_name_with_timestamps():
    name = generate_output_name(
        datetime(2026, 2, 14), track_number=1, total_tracks=5,
        start_sec=120.0, end_sec=360.0,
    )
    assert name == "2026-02-14_1_02m00s-06m00s.m4a"


def test_generate_output_name_zero_padded():
    name = generate_output_name(
        datetime(2026, 2, 14), track_number=3, total_tracks=12,
        start_sec=0.0, end_sec=90.0,
    )
    assert name == "2026-02-14_03_00m00s-01m30s.m4a"


def test_generate_output_name_with_song_name():
    name = generate_output_name(
        datetime(2026, 2, 14), track_number=1, total_tracks=5,
        start_sec=0.0, end_sec=300.0, song_name="Fat-Cat",
    )
    assert name == "2026-02-14_1_00m00s-05m00s_Fat-Cat.m4a"


def test_generate_output_name_with_fingerprint():
    name = generate_output_name(
        datetime(2026, 2, 14), track_number=1, total_tracks=5,
        start_sec=0.0, end_sec=300.0, fingerprint="abc123",
    )
    assert name == "2026-02-14_1_00m00s-05m00s_abc123.m4a"


def test_generate_output_name_song_name_overrides_fingerprint():
    name = generate_output_name(
        datetime(2026, 2, 14), track_number=1, total_tracks=5,
        start_sec=0.0, end_sec=300.0, fingerprint="abc123", song_name="Fat-Cat",
    )
    assert "Fat-Cat" in name
    assert "abc123" not in name


def test_generate_output_name_no_date():
    name = generate_output_name(None, track_number=1, total_tracks=1)
    assert name == "unknown-date_1.m4a"


def test_export_segments_creates_files(fake_session_file, tmp_output_dir):
    result = detect_songs(fake_session_file, energy_threshold_db=-40, min_song_duration_sec=3)
    exported = export_segments(fake_session_file, result.segments, tmp_output_dir)
    assert len(exported) == len(result.segments)
    for p in exported:
        assert p.exists()
        assert p.suffix == ".m4a"


def test_generate_output_name_explicit_extension():
    name = generate_output_name(
        datetime(2026, 2, 14), track_number=1, total_tracks=5,
        start_sec=0.0, end_sec=300.0, extension=".m4a",
    )
    assert name == "2026-02-14_1_00m00s-05m00s.m4a"
