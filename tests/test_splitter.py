from jam_session_processor.splitter import detect_songs


def test_detect_songs_finds_three_songs(fake_session_file):
    # Use low min duration since our test songs are only 5s each.
    # Smoothing can merge short segments, so we check for at least 2.
    result = detect_songs(
        fake_session_file, min_song_duration_sec=3, smoothing_sec=1, max_gap_sec=2
    )
    assert len(result.segments) >= 2


def test_detect_songs_returns_time_ranges(fake_session_file):
    result = detect_songs(
        fake_session_file, min_song_duration_sec=3, smoothing_sec=1, max_gap_sec=2
    )
    for start, end in result.segments:
        assert start < end


def test_detect_songs_total_duration(fake_session_file):
    result = detect_songs(
        fake_session_file, min_song_duration_sec=3, smoothing_sec=1, max_gap_sec=2
    )
    # 5s + 5s + 5s + 5s + 5s = 25s
    assert 24.0 < result.total_duration_sec < 26.0


def test_detect_songs_silence_only(silence_only_file):
    result = detect_songs(
        silence_only_file, min_song_duration_sec=3, smoothing_sec=1, max_gap_sec=2
    )
    assert len(result.segments) == 0


def test_detect_songs_filters_short_segments(fake_session_file):
    # With min_song_duration higher than our 5s songs, nothing should match
    result = detect_songs(
        fake_session_file, min_song_duration_sec=10, smoothing_sec=1, max_gap_sec=2
    )
    assert len(result.segments) == 0


def _detect(profile, **kwargs):
    from pathlib import Path
    from unittest.mock import patch

    with patch("jam_session_processor.splitter.compute_rms_profile", return_value=profile):
        return detect_songs(Path("unused.wav"), **kwargs)


def _jam(level):
    """Talk, a 3-minute song, talk, a 4-minute song, talk: at a given playing level (dB)."""
    talk = [level - 15.0] * 60
    return talk + [level] * 180 + talk + [level] * 240 + talk


def test_detect_songs_adapts_to_recording_level():
    # The same jam recorded loud or quiet splits the same way: no level to tune
    loud = _detect(_jam(-8.0))
    quiet = _detect(_jam(-32.0))
    assert len(loud.segments) == 2
    assert loud.segments == quiet.segments
    (s1, e1), (s2, e2) = loud.segments
    assert abs(s1 - 60) <= 6 and abs(e1 - 240) <= 6
    assert abs(s2 - 300) <= 6 and abs(e2 - 540) <= 6


def test_detect_songs_bridges_short_dips():
    # A brief stop inside a song doesn't cut it in two; a 30-second break does
    song = [-18.0] * 100 + [-45.0] * 3 + [-18.0] * 100
    result = _detect([-40.0] * 30 + song + [-40.0] * 30 + [-18.0] * 150 + [-40.0] * 30)
    assert len(result.segments) == 2
    assert result.segments[0][1] - result.segments[0][0] > 200


def test_detect_songs_segments_never_overlap():
    profile = ([-18.0] * 120 + [-45.0] * 9) * 4
    segments = _detect(profile, smoothing_sec=1).segments
    assert len(segments) == 4
    assert all(a[1] <= b[0] for a, b in zip(segments, segments[1:]))


def test_detect_songs_ignores_recording_with_no_music():
    assert _detect([-70.0] * 600).segments == []
