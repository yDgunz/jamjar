from datetime import datetime
from pathlib import Path

import numpy as np

from jam_session_processor.fingerprint import (
    compute_chroma_fingerprint,
    compute_chromagram_for_file,
    match_against_references,
)
from jam_session_processor.splitter import DEFAULT_FORMAT, AudioFormat, export_segment


def _format_timestamp(sec: float) -> str:
    total = int(sec)
    m, s = divmod(total, 60)
    return f"{m:02d}m{s:02d}s"


def generate_output_name(
    session_date: datetime | None,
    track_number: int,
    total_tracks: int,
    start_sec: float | None = None,
    end_sec: float | None = None,
    fingerprint: str = "",
    song_name: str = "",
    extension: str = ".ogg",
) -> str:
    date_str = session_date.strftime("%Y-%m-%d") if session_date else "unknown-date"
    width = len(str(total_tracks))
    name = f"{date_str}_{track_number:0{width}d}"
    if start_sec is not None and end_sec is not None:
        name += f"_{_format_timestamp(start_sec)}-{_format_timestamp(end_sec)}"
    if song_name:
        name += f"_{song_name}"
    elif fingerprint:
        name += f"_{fingerprint}"
    return name + extension


def export_segments(
    file_path: Path,
    segments: list[tuple[float, float]],
    output_dir: Path,
    session_date: datetime | None = None,
    reference_db: dict[str, np.ndarray] | None = None,
    match_threshold: float = 0.04,
    on_progress: callable = None,
    audio_format: AudioFormat = DEFAULT_FORMAT,
) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    exported = []

    for i, (start, end) in enumerate(segments, start=1):
        # Compute fingerprint and match against references using chroma sequences
        fp = compute_chroma_fingerprint(file_path, start_sec=start, duration_sec=end - start)
        song_name = ""
        match = None
        if reference_db:
            chromagram = compute_chromagram_for_file(
                file_path, start_sec=start, duration_sec=end - start,
            )
            match = match_against_references(chromagram, reference_db, threshold=match_threshold)
            if match:
                song_name = match.name

        name = generate_output_name(
            session_date, i, len(segments), start, end,
            fingerprint=fp, song_name=song_name,
            extension=audio_format.extension,
        )
        out_path = output_dir / name
        export_segment(file_path, out_path, start, end, audio_format=audio_format)
        exported.append(out_path)

        if on_progress:
            if match:
                match_info = f" → {match.name} (dist={match.distance:.3f})"
            else:
                match_info = ""
            on_progress(i, len(segments), name, match_info)

    return exported
