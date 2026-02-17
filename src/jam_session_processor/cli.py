from pathlib import Path

import click

from jam_session_processor.config import get_config
from jam_session_processor.db import Database
from jam_session_processor.fingerprint import build_reference_db, compute_chroma_fingerprint
from jam_session_processor.metadata import extract_metadata
from jam_session_processor.output import export_segments
from jam_session_processor.splitter import (
    AAC,
    DEFAULT_ENERGY_THRESHOLD_DB,
    DEFAULT_MIN_SONG_DURATION_SEC,
    OPUS,
    WAV,
    detect_songs,
)

FORMAT_CHOICES = {"opus": OPUS, "aac": AAC, "wav": WAV}


def _get_db() -> Database:
    return Database()


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
@click.option(
    "-f", "--format",
    "audio_format_name",
    type=click.Choice(["opus", "aac", "wav"], case_sensitive=False),
    default="aac",
    show_default=True,
    help="Output audio format.",
)
def process(
    file: Path,
    output_dir: Path | None,
    threshold: float,
    min_duration: int,
    references: Path | None,
    match_threshold: float,
    audio_format_name: str,
):
    """Split a jam session recording into individual songs."""
    audio_format = FORMAT_CHOICES[audio_format_name]
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

    cfg = get_config()
    if output_dir is None:
        output_dir = cfg.output_dir_for_source(file.stem)

    # Save to database
    db = _get_db()
    source_file = cfg.make_relative(file.resolve())
    date_str = meta.recording_date.strftime("%Y-%m-%d") if meta.recording_date else None

    # Check if session already exists
    existing = db.find_session_by_source(source_file)
    if existing:
        click.echo(f"Session for '{source_file}' already exists (id={existing.id}). Skipping DB insert.")
        click.echo("Use 'jam-session reset-db' to clear and re-process.")
        session_id = existing.id
    else:
        session_id = db.create_session(source_file, date=date_str)
        click.echo(f"Created session id={session_id}")

    def on_progress(current, total, name, match_info=""):
        click.echo(f"  [{current}/{total}] {name}{match_info}")

    click.echo("Fingerprinting and exporting...")
    exported = export_segments(
        file, result.segments, output_dir,
        session_date=meta.recording_date,
        reference_db=reference_db,
        match_threshold=match_threshold,
        on_progress=on_progress,
        audio_format=audio_format,
    )

    # Save tracks to database (only if we created a new session)
    if not existing:
        for i, ((start, end), audio_path) in enumerate(zip(result.segments, exported), start=1):
            fp = compute_chroma_fingerprint(file, start_sec=start, duration_sec=end - start)
            db.create_track(
                session_id,
                track_number=i,
                start_sec=start,
                end_sec=end,
                audio_path=cfg.make_relative(audio_path.resolve()),
                fingerprint=fp,
            )
        click.echo(f"Saved {len(exported)} track(s) to database.")

    db.close()
    click.echo(f"Done! {len(exported)} file(s) written to {output_dir}/")


@cli.command()
def sessions():
    """List all processed sessions."""
    db = _get_db()
    session_list = db.list_sessions()
    if not session_list:
        click.echo("No sessions in database. Use 'jam-session process <file>' to add one.")
        db.close()
        return

    click.echo(f"{'ID':>4}  {'Date':>12}  {'Tracks':>6}  {'Tagged':>6}  Source")
    click.echo("-" * 70)
    for s in session_list:
        date = s.date or "unknown"
        click.echo(f"{s.id:>4}  {date:>12}  {s.track_count:>6}  {s.tagged_count:>6}  {s.source_file}")
    db.close()


@cli.command("tracks")
@click.argument("session_id", type=int)
def tracks(session_id: int):
    """List tracks for a session."""
    db = _get_db()
    session = db.get_session(session_id)
    if not session:
        click.echo(f"Session {session_id} not found.")
        db.close()
        return

    click.echo(f"Session {session.id}: {session.source_file} ({session.date or 'unknown date'})")
    click.echo()

    track_list = db.get_tracks_for_session(session_id)
    if not track_list:
        click.echo("  No tracks.")
        db.close()
        return

    for t in track_list:
        duration = t.duration_sec
        song = f" → {t.song_name}" if t.song_name else ""
        notes = f" [{t.notes}]" if t.notes else ""
        click.echo(
            f"  {t.track_number:>2}. {_format_sec(t.start_sec)} - {_format_sec(t.end_sec)}"
            f"  ({_format_sec(duration)}){song}{notes}"
        )
    db.close()


@cli.command("reset-db")
@click.confirmation_option(prompt="This will delete all session data. Continue?")
def reset_db():
    """Clear all data from the database."""
    db = _get_db()
    db.reset()
    db.close()
    click.echo("Database cleared.")


@cli.command()
@click.option("-p", "--port", type=int, default=None, help="Port to listen on (default: JAM_PORT or 8000).")
@click.option("--reload", "use_reload", is_flag=True, help="Enable auto-reload for development.")
def serve(port: int | None, use_reload: bool):
    """Start the API server."""
    import uvicorn
    if port is None:
        port = get_config().port
    click.echo(f"Starting server on http://localhost:{port}")
    uvicorn.run(
        "jam_session_processor.api:app",
        host="0.0.0.0",
        port=port,
        reload=use_reload,
    )


@cli.command("process-all")
@click.argument("directory", type=click.Path(exists=True, file_okay=False, path_type=Path))
@click.option("-t", "--threshold", type=float, default=DEFAULT_ENERGY_THRESHOLD_DB, show_default=True)
@click.option("-m", "--min-duration", type=int, default=DEFAULT_MIN_SONG_DURATION_SEC, show_default=True)
@click.option(
    "-f", "--format",
    "audio_format_name",
    type=click.Choice(["opus", "aac", "wav"], case_sensitive=False),
    default="aac",
    show_default=True,
    help="Output audio format.",
)
def process_all(directory: Path, threshold: float, min_duration: int, audio_format_name: str):
    """Process all audio files in a directory."""
    extensions = {".m4a", ".wav", ".mp3", ".flac", ".ogg"}
    files = sorted(f for f in directory.iterdir() if f.suffix.lower() in extensions)
    if not files:
        click.echo(f"No audio files found in {directory}/")
        return

    click.echo(f"Found {len(files)} audio file(s) in {directory}/")
    for f in files:
        click.echo(f"\n{'='*60}")
        click.echo(f"Processing: {f.name}")
        click.echo(f"{'='*60}")
        ctx = click.get_current_context()
        ctx.invoke(process, file=f, output_dir=None, threshold=threshold,
                   min_duration=min_duration, references=None, match_threshold=0.04,
                   audio_format_name=audio_format_name)


UPLOAD_EXTENSIONS = {".m4a", ".wav", ".mp3", ".flac", ".ogg"}


@cli.command()
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option(
    "-s", "--server",
    required=True,
    help="Server URL (e.g. http://localhost:8000).",
)
def upload(file: Path, server: str):
    """Upload an audio file to a remote server for processing."""
    import requests

    ext = file.suffix.lower()
    if ext not in UPLOAD_EXTENSIONS:
        allowed = ", ".join(sorted(UPLOAD_EXTENSIONS))
        click.echo(f"Error: Invalid file type '{ext}'. Allowed: {allowed}")
        raise SystemExit(1)

    url = f"{server.rstrip('/')}/api/sessions/upload"
    file_size = file.stat().st_size
    size_mb = file_size / (1024 * 1024)
    click.echo(f"Uploading {file.name} ({size_mb:.1f} MB) to {server}...")

    try:
        with open(file, "rb") as f:
            resp = requests.post(
                url,
                files={"file": (file.name, f)},
                timeout=600,
            )
    except requests.ConnectionError:
        click.echo(f"Error: Could not connect to {server}")
        raise SystemExit(1)
    except requests.Timeout:
        click.echo("Error: Upload timed out (10 minutes)")
        raise SystemExit(1)

    if resp.status_code != 200:
        detail = ""
        try:
            detail = resp.json().get("detail", "")
        except Exception:
            pass
        msg = f"Error: Server returned {resp.status_code}"
        if detail:
            msg += f" — {detail}"
        click.echo(msg)
        raise SystemExit(1)

    data = resp.json()
    click.echo(f"Session created (id={data['id']})")
    click.echo(f"  Date: {data.get('date') or 'unknown'}")
    click.echo(f"  Tracks: {data.get('track_count', 0)}")
    click.echo(f"  Source: {data.get('source_file', '')}")


def _format_sec(sec: float) -> str:
    total = int(sec)
    minutes, seconds = divmod(total, 60)
    return f"{minutes}:{seconds:02d}"
