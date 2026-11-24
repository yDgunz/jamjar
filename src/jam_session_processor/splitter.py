import math
import struct
import subprocess
from dataclasses import dataclass
from pathlib import Path

DEFAULT_MIN_SONG_DURATION_SEC = 90
ANALYSIS_SAMPLE_RATE = 8000
WINDOW_SEC = 1
SMOOTHING_WINDOW_SEC = 9
# A dip in the smoothed level shorter than this doesn't end a song (a stop, a breakdown)
MAX_GAP_SEC = 8
# The level that counts as "playing" is set per recording: this far below how loud the
# recording gets when the band is playing (its LOUD_PERCENTILE loudest second). Phones
# and rooms differ by 10+ dB, so no fixed level works for every recording.
LOUD_PERCENTILE = 0.9
LOUD_MARGIN_DB = 7.5
# A recording that never gets louder than this has no music in it
MIN_LOUD_DB = -50.0


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
        "ffmpeg",
        "-i",
        str(file_path),
        "-ac",
        "1",
        "-ar",
        str(ANALYSIS_SAMPLE_RATE),
        "-f",
        "s16le",
        "-",
    ]
    samples_per_window = ANALYSIS_SAMPLE_RATE * WINDOW_SEC
    bytes_per_window = samples_per_window * 2  # 16-bit = 2 bytes
    rms_db_values = []

    # Read a second at a time: holding a 3-hour recording's PCM in memory (and Python's
    # copies of it) cost the server hundreds of MB it never gave back
    with subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL) as proc:
        while True:
            chunk = proc.stdout.read(bytes_per_window)
            if len(chunk) < bytes_per_window:
                break
            samples = struct.unpack(f"<{samples_per_window}h", chunk)
            mean_sq = sum(s * s for s in samples) / samples_per_window
            if mean_sq > 0:
                rms_db = 10 * math.log10(mean_sq / (32768 * 32768))
            else:
                rms_db = -100.0
            rms_db_values.append(rms_db)
        proc.stdout.read()  # drain a trailing partial second so ffmpeg can exit

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


def playing_threshold_db(rms_profile: list[float]) -> float | None:
    """The level above which this recording counts as music, or None if it's all quiet."""
    if not rms_profile:
        return None
    ordered = sorted(rms_profile)
    loud = ordered[min(len(ordered) - 1, int(len(ordered) * LOUD_PERCENTILE))]
    if loud < MIN_LOUD_DB:
        return None
    return loud - LOUD_MARGIN_DB


def detect_songs(
    file_path: Path,
    min_song_duration_sec: int = DEFAULT_MIN_SONG_DURATION_SEC,
    smoothing_sec: int = SMOOTHING_WINDOW_SEC,
    max_gap_sec: int = MAX_GAP_SEC,
) -> SplitResult:
    """Detect songs: sustained stretches near the recording's own playing level."""
    rms_profile = compute_rms_profile(file_path)
    if not rms_profile:
        return SplitResult(segments=[], total_duration_sec=0.0)

    total_duration = len(rms_profile) * WINDOW_SEC
    threshold = playing_threshold_db(rms_profile)
    if threshold is None:
        return SplitResult(segments=[], total_duration_sec=float(total_duration))
    smoothed = smooth_profile(rms_profile, smoothing_sec)

    # Find contiguous regions above the threshold
    in_song = False
    song_start = 0
    regions: list[list[int]] = []

    for i, db in enumerate(smoothed):
        if db >= threshold:
            if not in_song:
                song_start = i
                in_song = True
        else:
            if in_song:
                regions.append([song_start, i])
                in_song = False

    if in_song:
        regions.append([song_start, len(smoothed)])

    # Join regions separated by only a brief dip
    raw_segments: list[list[int]] = []
    for start_idx, end_idx in regions:
        if raw_segments and (start_idx - raw_segments[-1][1]) * WINDOW_SEC < max_gap_sec:
            raw_segments[-1][1] = end_idx
        else:
            raw_segments.append([start_idx, end_idx])

    # Filter out segments shorter than min_song_duration; pad the rest a little
    # (never past the middle of the gap to a neighbouring region, so songs can't overlap)
    padding_sec = 2.0
    segments: list[tuple[float, float]] = []
    for n, (start_idx, end_idx) in enumerate(raw_segments):
        duration = (end_idx - start_idx) * WINDOW_SEC
        if duration < min_song_duration_sec:
            continue
        before = (start_idx - raw_segments[n - 1][1]) * WINDOW_SEC / 2 if n else padding_sec
        after = (
            (raw_segments[n + 1][0] - end_idx) * WINDOW_SEC / 2
            if n + 1 < len(raw_segments)
            else padding_sec
        )
        start_sec = max(0.0, start_idx * WINDOW_SEC - min(padding_sec, before))
        end_sec = min(float(total_duration), end_idx * WINDOW_SEC + min(padding_sec, after))
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
        "ffmpeg",
        "-y",
        "-ss",
        str(start_sec),
        "-i",
        str(file_path),
        "-t",
        str(duration),
        "-c:a",
        audio_format.codec,
    ]
    if audio_format.bitrate:
        cmd += ["-b:a", audio_format.bitrate]
    cmd.append(output_path.as_posix())
    subprocess.run(cmd, capture_output=True, check=True)
