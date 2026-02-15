from pathlib import Path

import click

from jam_session_processor.fingerprint import build_reference_db
from jam_session_processor.metadata import extract_metadata
from jam_session_processor.output import export_segments
from jam_session_processor.splitter import (
    DEFAULT_ENERGY_THRESHOLD_DB,
    DEFAULT_MIN_SONG_DURATION_SEC,
    detect_songs,
)


@click.group()
def cli():
    """Process iPhone jam session recordings."""


@cli.command()
@click.argument("file", type=click.Path(exists=True, path_type=Path))
def info(file: Path):
    """Display metadata for an audio file."""
    meta = extract_metadata(file)
    click.echo(meta.summary())


@cli.command()
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option(
    "-o", "--output-dir",
    type=click.Path(path_type=Path),
    default=None,
    help="Output directory (default: ./output/<filename>/)",
)
@click.option(
    "-t", "--threshold",
    type=float,
    default=DEFAULT_ENERGY_THRESHOLD_DB,
    show_default=True,
    help="Energy threshold in dB. Higher values are more selective.",
)
@click.option(
    "-m", "--min-duration",
    type=int,
    default=DEFAULT_MIN_SONG_DURATION_SEC,
    show_default=True,
    help="Minimum song duration in seconds.",
)
@click.option(
    "-r", "--references",
    type=click.Path(exists=True, file_okay=False, path_type=Path),
    default=None,
    help="Directory of reference songs for matching.",
)
@click.option(
    "--match-threshold",
    type=float,
    default=0.04,
    show_default=True,
    help="DTW distance threshold for reference matching (lower = stricter).",
)
def process(
    file: Path,
    output_dir: Path | None,
    threshold: float,
    min_duration: int,
    references: Path | None,
    match_threshold: float,
):
    """Split a jam session recording into individual songs."""
    meta = extract_metadata(file)
    click.echo(meta.summary())
    click.echo()

    # Build reference DB if provided
    reference_db = None
    if references:
        click.echo(f"Loading reference songs from {references}/...")
        reference_db = build_reference_db(references)
        click.echo(f"  {len(reference_db)} reference(s) loaded")
        click.echo()

    click.echo("Analyzing energy levels...")
    result = detect_songs(file, energy_threshold_db=threshold, min_song_duration_sec=min_duration)

    if not result.segments:
        click.echo("No songs detected. Try lowering --threshold or --min-duration.")
        return

    click.echo(f"Found {len(result.segments)} song(s):")
    for i, (start, end) in enumerate(result.segments, start=1):
        duration = end - start
        click.echo(f"  {i}. {_format_sec(start)} - {_format_sec(end)}  ({_format_sec(duration)})")
    click.echo()

    if output_dir is None:
        output_dir = Path("output") / file.stem

    def on_progress(current, total, name, match_info=""):
        click.echo(f"  [{current}/{total}] {name}{match_info}")

    click.echo("Fingerprinting and exporting...")
    exported = export_segments(
        file, result.segments, output_dir,
        session_date=meta.recording_date,
        reference_db=reference_db,
        match_threshold=match_threshold,
        on_progress=on_progress,
    )
    click.echo(f"Done! {len(exported)} file(s) written to {output_dir}/")


def _format_sec(sec: float) -> str:
    total = int(sec)
    minutes, seconds = divmod(total, 60)
    return f"{minutes}:{seconds:02d}"
