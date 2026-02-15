import hashlib
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

# Analysis parameters
FINGERPRINT_SAMPLE_RATE = 11025  # Low rate is fine for chroma
HOP_SECONDS = 0.5  # Chroma resolution: one frame per 0.5s
N_FFT = 8192  # FFT size for frequency resolution at 11025 Hz
N_CHROMA = 12  # 12 pitch classes
SUMMARY_BINS = 32  # Time bins for sequence fingerprint/matching
EDGE_TRIM_PERCENT = 0.10  # Trim 10% from each edge to reduce noodling contamination

# Reference note frequencies (A4 = 440 Hz)
_A4 = 440.0


def _decode_audio(file_path: Path, start_sec: float = 0, duration_sec: float = 0) -> np.ndarray:
    """Decode audio to mono float samples using ffmpeg."""
    cmd = ["ffmpeg"]
    if start_sec > 0:
        cmd += ["-ss", str(start_sec)]
    cmd += ["-i", str(file_path)]
    if duration_sec > 0:
        cmd += ["-t", str(duration_sec)]
    cmd += ["-ac", "1", "-ar", str(FINGERPRINT_SAMPLE_RATE), "-f", "s16le", "-"]
    proc = subprocess.run(cmd, capture_output=True)
    samples = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    return samples


def _compute_chromagram(samples: np.ndarray) -> np.ndarray:
    """Compute a chromagram from audio samples using FFT and pitch class binning."""
    hop_samples = int(HOP_SECONDS * FINGERPRINT_SAMPLE_RATE)
    freqs = np.fft.rfftfreq(N_FFT, d=1.0 / FINGERPRINT_SAMPLE_RATE)

    # Build a mapping from FFT bins to chroma bins
    chroma_map = np.zeros((N_CHROMA, len(freqs)))
    for i, f in enumerate(freqs):
        if f < 60 or f > 4200:
            continue
        chroma_bin = int(round(12 * np.log2(f / _A4))) % 12
        chroma_map[chroma_bin, i] = 1.0

    frames = []
    window = np.hanning(N_FFT)
    for start in range(0, len(samples) - N_FFT, hop_samples):
        chunk = samples[start : start + N_FFT] * window
        spectrum = np.abs(np.fft.rfft(chunk)) ** 2
        chroma_frame = chroma_map @ spectrum
        frames.append(chroma_frame)

    if not frames:
        return np.zeros((0, N_CHROMA))

    chromagram = np.array(frames)
    # Normalize each frame to unit norm (pitch class distribution)
    norms = np.linalg.norm(chromagram, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    chromagram = chromagram / norms
    return chromagram


def _trim_edges(chromagram: np.ndarray) -> np.ndarray:
    """Trim a percentage from each edge to reduce noodling/talking contamination."""
    n = chromagram.shape[0]
    if n < 10:
        return chromagram
    trim = int(n * EDGE_TRIM_PERCENT)
    return chromagram[trim : n - trim]


def _summarize_chromagram(chromagram: np.ndarray, n_bins: int = SUMMARY_BINS) -> np.ndarray:
    """Divide a chromagram into n_bins time segments and average each.

    Returns an (n_bins, 12) array capturing the chord progression over time,
    normalized to the song's proportional structure regardless of absolute duration.
    """
    n_frames = chromagram.shape[0]
    if n_frames == 0:
        return np.zeros((n_bins, N_CHROMA))

    if n_frames < n_bins:
        pad = np.tile(chromagram[-1:], (n_bins - n_frames, 1))
        chromagram = np.vstack([chromagram, pad])
        n_frames = n_bins

    bin_size = n_frames / n_bins
    summary = np.zeros((n_bins, N_CHROMA))
    for i in range(n_bins):
        start = int(i * bin_size)
        end = int((i + 1) * bin_size)
        summary[i] = chromagram[start:end].mean(axis=0)

    # Re-normalize
    norms = np.linalg.norm(summary, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    summary = summary / norms
    return summary


def compute_chromagram_for_file(
    file_path: Path,
    start_sec: float = 0,
    duration_sec: float = 0,
) -> np.ndarray:
    """Compute the full chromagram for an audio file or segment."""
    samples = _decode_audio(file_path, start_sec, duration_sec)
    if len(samples) < N_FFT:
        return np.zeros((0, N_CHROMA))
    return _compute_chromagram(samples)


def compute_chroma_fingerprint(
    file_path: Path,
    start_sec: float = 0,
    duration_sec: float = 0,
) -> str:
    """Compute a sequence-based chroma fingerprint hash.

    Trims edges, divides into time bins, and hashes the chord progression.
    """
    chromagram = compute_chromagram_for_file(file_path, start_sec, duration_sec)
    if chromagram.shape[0] == 0:
        return ""

    trimmed = _trim_edges(chromagram)
    summary = _summarize_chromagram(trimmed)
    quantized = np.round(summary, 2)
    raw = quantized.tobytes()
    return hashlib.sha256(raw).hexdigest()[:16]


@dataclass
class ReferenceMatch:
    name: str
    similarity: float
    distance: float


def _dtw_distance(seq_a: np.ndarray, seq_b: np.ndarray) -> float:
    """Compute Dynamic Time Warping distance between two chroma sequences.

    Uses cosine distance (1 - cosine_similarity) as the frame-level cost.
    Returns normalized DTW distance (lower = more similar).
    """
    n, m = len(seq_a), len(seq_b)
    if n == 0 or m == 0:
        return float("inf")

    norm_a = np.linalg.norm(seq_a, axis=1, keepdims=True)
    norm_b = np.linalg.norm(seq_b, axis=1, keepdims=True)
    norm_a[norm_a == 0] = 1.0
    norm_b[norm_b == 0] = 1.0
    a_normed = seq_a / norm_a
    b_normed = seq_b / norm_b

    cost_matrix = 1.0 - (a_normed @ b_normed.T)

    dtw = np.full((n + 1, m + 1), float("inf"))
    dtw[0, 0] = 0.0
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            dtw[i, j] = cost_matrix[i - 1, j - 1] + min(
                dtw[i - 1, j],
                dtw[i, j - 1],
                dtw[i - 1, j - 1],
            )

    return dtw[n, m] / (n + m)


def _clean_reference_name(name: str) -> str:
    """Strip date prefixes like '2023-10-25-' from reference song names."""
    return re.sub(r"^\d{4}-\d{2}-\d{2}-", "", name)


def build_reference_db(reference_dir: Path) -> dict[str, np.ndarray]:
    """Build a dictionary of song name → summarized chroma sequence from reference files.

    Trims edges and summarizes to capture the core chord progression.
    """
    db = {}
    for f in sorted(reference_dir.iterdir()):
        if f.suffix.lower() in (".m4a", ".wav", ".mp3", ".mp4"):
            chromagram = compute_chromagram_for_file(f)
            trimmed = _trim_edges(chromagram)
            name = _clean_reference_name(f.stem)
            db[name] = _summarize_chromagram(trimmed)
    return db


def match_against_references(
    chromagram: np.ndarray,
    reference_db: dict[str, np.ndarray],
    threshold: float = 0.04,
) -> ReferenceMatch | None:
    """Find the best matching reference song using DTW on chroma sequences.

    threshold: maximum DTW distance to count as a match (lower = stricter).
    Default 0.04 is conservative — only high-confidence matches pass.
    """
    trimmed = _trim_edges(chromagram)
    summary = _summarize_chromagram(trimmed)
    best_match = None
    best_dist = float("inf")

    for name, ref_summary in reference_db.items():
        dist = _dtw_distance(summary, ref_summary)
        if dist < best_dist:
            best_dist = dist
            best_match = name

    if best_match and best_dist <= threshold:
        similarity = 1.0 - best_dist
        return ReferenceMatch(name=best_match, similarity=similarity, distance=best_dist)

    return None
