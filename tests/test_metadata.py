from datetime import datetime

from jam_session_processor.metadata import extract_metadata, parse_date_from_filename


def test_extract_metadata_from_wav(fake_session_file):
    meta = extract_metadata(fake_session_file)
    assert meta.filename == "test_session.wav"
    assert meta.duration_seconds > 0
    assert meta.sample_rate == 44100
    assert meta.channels is not None


def test_metadata_summary_contains_filename(fake_session_file):
    meta = extract_metadata(fake_session_file)
    summary = meta.summary()
    assert "test_session.wav" in summary
    assert "Duration" in summary


def test_parse_date_m_d_yy():
    assert parse_date_from_filename("5Biz 2-3-26") == datetime(2026, 2, 3)


def test_parse_date_mm_dd_yy():
    assert parse_date_from_filename("good jams 11-11-25") == datetime(2025, 11, 11)


def test_parse_date_yyyy_mm_dd():
    assert parse_date_from_filename("session_2026-02-14_live") == datetime(2026, 2, 14)


def test_parse_date_no_date():
    assert parse_date_from_filename("unknown-date_02") is None


def test_parse_date_from_filename_in_metadata(tmp_path):
    """When file has no metadata date tag, fall back to filename."""
    from pydub import AudioSegment
    from pydub.generators import Sine

    audio = Sine(440).to_audio_segment(duration=1000)
    path = tmp_path / "jam 3-15-26.wav"
    audio.export(str(path), format="wav")

    meta = extract_metadata(path)
    assert meta.recording_date == datetime(2026, 3, 15)
