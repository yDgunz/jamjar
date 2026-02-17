import math
import struct
import subprocess
from dataclasses import dataclass
from pathlib import Path

DEFAULT_ENERGY_THRESHOLD_DB = -30
DEFAULT_MIN_SONG_DURATION_SEC = 120
ANALYSIS_SAMPLE_RATE = 8000
WINDOW_SEC = 1
SMOOTHING_WINDOW_SEC = 15


@dataclass(frozen=True)
class AudioFormat:
    extension: str  # ".ogg", ".m4a", ".wav"
    codec: str  # "libopus", "aac", "pcm_s16le"
    bitrate: str | None  # "192k", None for WAV


OPUS = AudioFormat(".ogg", "libopus", "192k")
AAC = AudioFormat(".m4a", "aac", "192k")
WAV = AudioFormat(".wav", "pcm_s16le", None)
DEFAULT_FORMAT = AAC


@dataclass
class SplitResult:
    segments: list[tuple[float, float]]  # list of (start_sec, end_sec)
    total_duration_sec: float


def compute_rms_profile(file_path: Path) -> list[float]:
    """Extract per-second RMS dB values using ffmpeg to decode and Python to compute."""
    cmd = [
        "ffmpeg", "-i", str(file_path),
        "-ac", "1",
        "-ar", str(ANALYSIS_SAMPLE_RATE),
        "-f", "s16le",
        "-",
    ]
    proc = subprocess.run(cmd, capture_output=True)
    raw = proc.stdout

    samples_per_window = ANALYSIS_SAMPLE_RATE * WINDOW_SEC
    bytes_per_window = samples_per_window * 2  # 16-bit = 2 bytes
    rms_db_values = []

    for offset in range(0, len(raw) - bytes_per_window + 1, bytes_per_window):
        chunk = raw[offset : offset + bytes_per_window]
        samples = struct.unpack(f"<{samples_per_window}h", chunk)
        mean_sq = sum(s * s for s in samples) / samples_per_window
        if mean_sq > 0:
            rms_db = 10 * math.log10(mean_sq / (32768 * 32768))
        else:
            rms_db = -100.0
        rms_db_values.append(rms_db)

    return rms_db_values


def smooth_profile(values: list[float], window: int) -> list[float]:
    """Simple rolling average to smooth out brief spikes and dips."""
    if len(values) <= window:
        return values
    smoothed = []
    half = window // 2
    for i in range(len(values)):
        start = max(0, i - half)
        end = min(len(values), i + half + 1)
        smoothed.append(sum(values[start:end]) / (end - start))
    return smoothed


def detect_songs(
    file_path: Path,
    energy_threshold_db: float = DEFAULT_ENERGY_THRESHOLD_DB,
    min_song_duration_sec: int = DEFAULT_MIN_SONG_DURATION_SEC,
) -> SplitResult:
    """Detect songs by finding sustained high-energy sections."""
    rms_profile = compute_rms_profile(file_path)
    if not rms_profile:
        return SplitResult(segments=[], total_duration_sec=0.0)

    total_duration = len(rms_profile) * WINDOW_SEC
    smoothed = smooth_profile(rms_profile, SMOOTHING_WINDOW_SEC)

    # Find contiguous regions above the energy threshold
    in_song = False
    song_start = 0
    raw_segments: list[tuple[int, int]] = []

    for i, db in enumerate(smoothed):
        if db >= energy_threshold_db:
            if not in_song:
                song_start = i
                in_song = True
        else:
            if in_song:
                raw_segments.append((song_start, i))
                in_song = False

    if in_song:
        raw_segments.append((song_start, len(smoothed)))

    # Filter out segments shorter than min_song_duration
    padding_sec = 2.0
    segments: list[tuple[float, float]] = []
    for start_idx, end_idx in raw_segments:
        duration = (end_idx - start_idx) * WINDOW_SEC
        if duration >= min_song_duration_sec:
            start_sec = max(0.0, start_idx * WINDOW_SEC - padding_sec)
            end_sec = min(float(total_duration), end_idx * WINDOW_SEC + padding_sec)
            segments.append((start_sec, end_sec))

    return SplitResult(segments=segments, total_duration_sec=float(total_duration))


def export_segment(
    file_path: Path,
    output_path: Path,
    start_sec: float,
    end_sec: float,
    audio_format: AudioFormat = DEFAULT_FORMAT,
) -> None:
    """Use ffmpeg to extract a segment to the specified format."""
    duration = end_sec - start_sec
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(start_sec),
        "-i", str(file_path),
        "-t", str(duration),
        "-c:a", audio_format.codec,
    ]
    if audio_format.bitrate:
        cmd += ["-b:a", audio_format.bitrate]
    cmd.append(output_path.as_posix())
    subprocess.run(cmd, capture_output=True, check=True)
