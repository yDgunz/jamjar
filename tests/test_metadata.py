from jam_session_processor.metadata import extract_metadata


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
