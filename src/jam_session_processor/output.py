from datetime import datetime
from pathlib import Path

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
    song_name: str = "",
    extension: str = ".m4a",
) -> str:
    date_str = session_date.strftime("%Y-%m-%d") if session_date else "unknown-date"
    width = len(str(total_tracks))
    name = f"{date_str}_{track_number:0{width}d}"
    if start_sec is not None and end_sec is not None:
        name += f"_{_format_timestamp(start_sec)}-{_format_timestamp(end_sec)}"
    if song_name:
        name += f"_{song_name}"
    return name + extension


def export_segments(
    file_path: Path,
    segments: list[tuple[float, float]],
    output_dir: Path,
    session_date: datetime | None = None,
    on_progress: callable = None,
    audio_format: AudioFormat = DEFAULT_FORMAT,
) -> list[Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    exported = []

    for i, (start, end) in enumerate(segments, start=1):
        name = generate_output_name(
            session_date,
            i,
            len(segments),
            start,
            end,
            extension=audio_format.extension,
        )
        out_path = output_dir / name
        export_segment(file_path, out_path, start, end, audio_format=audio_format)
        exported.append(out_path)

        if on_progress:
            on_progress(i, len(segments), name)

    return exported
