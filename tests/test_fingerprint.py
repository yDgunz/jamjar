import shutil

import pytest
from pydub.generators import Sine

from jam_session_processor.fingerprint import (
    build_reference_db,
    compute_chroma_fingerprint,
    compute_chromagram_for_file,
    match_against_references,
)


@pytest.fixture
def tone_440_file(tmp_path):
    """A 10-second 440 Hz sine tone."""
    audio = Sine(440).to_audio_segment(duration=10000).set_frame_rate(44100)
    path = tmp_path / "tone_440.wav"
    audio.export(str(path), format="wav")
    return path


@pytest.fixture
def tone_440_file_b(tmp_path):
    """Another 10-second 440 Hz sine tone (same pitch, different file)."""
    audio = Sine(440).to_audio_segment(duration=10000).set_frame_rate(44100)
    path = tmp_path / "tone_440_b.wav"
    audio.export(str(path), format="wav")
    return path


@pytest.fixture
def tone_261_file(tmp_path):
    """A 10-second 261 Hz (C4) sine tone — different pitch class."""
    audio = Sine(261).to_audio_segment(duration=10000).set_frame_rate(44100)
    path = tmp_path / "tone_261.wav"
    audio.export(str(path), format="wav")
    return path


@pytest.fixture
def complex_tone_file(tmp_path):
    """A tone that changes pitch halfway through — tests sequence sensitivity."""
    part1 = Sine(440).to_audio_segment(duration=5000).set_frame_rate(44100)
    part2 = Sine(523).to_audio_segment(duration=5000).set_frame_rate(44100)
    audio = part1 + part2
    path = tmp_path / "complex_tone.wav"
    audio.export(str(path), format="wav")
    return path


def test_fingerprint_same_tone_is_identical(tone_440_file, tone_440_file_b):
    fp1 = compute_chroma_fingerprint(tone_440_file)
    fp2 = compute_chroma_fingerprint(tone_440_file_b)
    assert fp1 == fp2
    assert len(fp1) == 16


def test_fingerprint_different_tones_differ(tone_440_file, tone_261_file):
    fp1 = compute_chroma_fingerprint(tone_440_file)
    fp2 = compute_chroma_fingerprint(tone_261_file)
    assert fp1 != fp2


def test_fingerprint_captures_key_change(tone_440_file, complex_tone_file):
    """A tone that changes key should have a different fingerprint than a steady tone."""
    fp1 = compute_chroma_fingerprint(tone_440_file)
    fp2 = compute_chroma_fingerprint(complex_tone_file)
    assert fp1 != fp2


def test_chromagram_shape(tone_440_file):
    chromagram = compute_chromagram_for_file(tone_440_file)
    assert chromagram.shape[1] == 12
    assert chromagram.shape[0] > 0


def test_match_against_references_finds_match(tone_440_file, tone_440_file_b, tmp_path):
    ref_dir = tmp_path / "refs"
    ref_dir.mkdir()
    shutil.copy(tone_440_file, ref_dir / "My-Song.wav")
    db = build_reference_db(ref_dir)

    chromagram = compute_chromagram_for_file(tone_440_file_b)
    match = match_against_references(chromagram, db)
    assert match is not None
    assert match.name == "My-Song"
    assert match.similarity > 0.90


def test_match_against_references_no_match(tone_261_file, tmp_path):
    ref_dir = tmp_path / "refs"
    ref_dir.mkdir()
    audio = Sine(440).to_audio_segment(duration=10000)
    audio.export(str(ref_dir / "Other-Song.wav"), format="wav")
    db = build_reference_db(ref_dir)

    chromagram = compute_chromagram_for_file(tone_261_file)
    match = match_against_references(chromagram, db, threshold=0.05)
    assert match is None


def test_sequence_matching_distinguishes_key_change(tone_440_file, complex_tone_file, tmp_path):
    """DTW sequence matching should NOT match a steady tone against a key-changing tone."""
    ref_dir = tmp_path / "refs"
    ref_dir.mkdir()
    shutil.copy(tone_440_file, ref_dir / "Steady-A.wav")
    db = build_reference_db(ref_dir)

    chromagram = compute_chromagram_for_file(complex_tone_file)
    match = match_against_references(chromagram, db, threshold=0.05)
    assert match is None
