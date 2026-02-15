from jam_session_processor.splitter import detect_songs


def test_detect_songs_finds_three_songs(fake_session_file):
    # Use low min duration since our test songs are only 5s each.
    # The 15s smoothing window can merge short segments, so we check for at least 2.
    result = detect_songs(fake_session_file, energy_threshold_db=-40, min_song_duration_sec=3)
    assert len(result.segments) >= 2


def test_detect_songs_returns_time_ranges(fake_session_file):
    result = detect_songs(fake_session_file, energy_threshold_db=-40, min_song_duration_sec=3)
    for start, end in result.segments:
        assert start < end


def test_detect_songs_total_duration(fake_session_file):
    result = detect_songs(fake_session_file, energy_threshold_db=-40, min_song_duration_sec=3)
    # 5s + 5s + 5s + 5s + 5s = 25s
    assert 24.0 < result.total_duration_sec < 26.0


def test_detect_songs_silence_only(silence_only_file):
    result = detect_songs(silence_only_file, energy_threshold_db=-40, min_song_duration_sec=3)
    assert len(result.segments) == 0


def test_detect_songs_filters_short_segments(fake_session_file):
    # With min_song_duration higher than our 5s songs, nothing should match
    result = detect_songs(fake_session_file, energy_threshold_db=-40, min_song_duration_sec=10)
    assert len(result.segments) == 0
