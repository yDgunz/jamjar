import pytest
from pydub import AudioSegment
from pydub.generators import Sine


@pytest.fixture
def tmp_output_dir(tmp_path):
    d = tmp_path / "output"
    d.mkdir()
    return d


@pytest.fixture
def fake_session_file(tmp_path):
    """Create a synthetic jam session .wav: 3 'songs' (loud tones) separated by silence."""
    sample_rate = 44100
    # Loud songs (will be well above any energy threshold)
    song1 = Sine(440).to_audio_segment(duration=5000).set_frame_rate(sample_rate)
    song2 = Sine(523).to_audio_segment(duration=5000).set_frame_rate(sample_rate)
    song3 = Sine(659).to_audio_segment(duration=5000).set_frame_rate(sample_rate)
    silence = AudioSegment.silent(duration=5000, frame_rate=sample_rate)

    session = song1 + silence + song2 + silence + song3
    path = tmp_path / "test_session.wav"
    session.export(str(path), format="wav")
    return path


@pytest.fixture
def silence_only_file(tmp_path):
    """A file that is pure silence."""
    silence = AudioSegment.silent(duration=10000, frame_rate=44100)
    path = tmp_path / "silence.wav"
    silence.export(str(path), format="wav")
    return path


@pytest.fixture(autouse=True)
def _reset_rate_limiters():
    """Rate limiters are module-level state; clear them so tests don't interfere."""
    from jam_session_processor import api

    for limiter in (
        api._login_limiter,
        api._access_request_limiter,
        api._forgot_password_limiter,
        api._token_limiter,
    ):
        limiter._attempts.clear()
    yield
