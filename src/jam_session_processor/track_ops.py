"""Service layer for merge and split track operations.

Orchestrates re-export from source files, DB updates, and file renaming
when tracks are merged or split.
"""

import subprocess
from pathlib import Path
from uuid import uuid4

from jam_session_processor.config import get_config
from jam_session_processor.db import Database, Track
from jam_session_processor.metadata import extract_metadata
from jam_session_processor.output import generate_output_name
from jam_session_processor.splitter import DEFAULT_FORMAT, AudioFormat, export_segment
from jam_session_processor.storage import get_storage


def merge_tracks(
    db: Database,
    track_id_1: int,
    track_id_2: int,
    audio_format: AudioFormat = DEFAULT_FORMAT,
) -> list[Track]:
    """Merge two adjacent tracks into one.

    Re-exports from the original source file with widened time range.
    Keeps the first track's song tag and notes. Returns the full updated
    track list for the session.
    """
    t1 = db.get_track(track_id_1)
    t2 = db.get_track(track_id_2)
    if not t1 or not t2:
        raise ValueError("Track not found")
    if t1.session_id != t2.session_id:
        raise ValueError("Tracks must belong to the same session")

    # Ensure t1 is the earlier track
    if t1.track_number > t2.track_number:
        t1, t2 = t2, t1
    if t2.track_number - t1.track_number != 1:
        raise ValueError("Tracks must be adjacent")

    cfg = get_config()
    storage = get_storage()
    session = db.get_session(t1.session_id)
    source_file = cfg.resolve_path(session.source_file)
    output_dir = cfg.resolve_path(t1.audio_path).parent

    # Ensure source file is local if using remote storage
    if storage.is_remote:
        source_file = storage.get(session.source_file, source_file)

    # New time range spans both tracks
    new_start = t1.start_sec
    new_end = t2.end_sec

    # Re-export merged segment
    total_tracks = len(db.get_tracks_for_session(session.id)) - 1
    filename = generate_output_name(
        t1.track_number,
        max(total_tracks, 1),
        new_start,
        new_end,
        extension=audio_format.extension,
    )
    new_path = output_dir / filename
    export_segment(source_file, new_path, new_start, new_end, audio_format=audio_format)

    # Preserve first track's metadata
    song_id = t1.song_id
    notes = t1.notes

    # Remove old audio files
    storage.delete(t1.audio_path)
    storage.delete(t2.audio_path)

    # Delete both old tracks, create merged track
    db.delete_track(t1.id)
    db.delete_track(t2.id)
    new_rel_path = cfg.make_relative(new_path)
    new_track_id = db.create_track(
        session_id=session.id,
        track_number=t1.track_number,
        start_sec=new_start,
        end_sec=new_end,
        audio_path=new_rel_path,
    )

    # Upload new file to remote storage
    if storage.is_remote:
        storage.put(new_rel_path, new_path)

    # Restore tag and notes
    if song_id:
        db.update_track(new_track_id, song_id=song_id)
    if notes:
        db.update_track_notes(new_track_id, notes)

    # Renumber all tracks in the session
    _renumber_tracks(db, session.id, output_dir, audio_format=audio_format)

    return db.get_tracks_for_session(session.id)


def split_track(
    db: Database,
    track_id: int,
    split_at_sec: float,
    audio_format: AudioFormat = DEFAULT_FORMAT,
) -> list[Track]:
    """Split a track at the given position (relative to track start).

    Re-exports both halves from the original source file. First half keeps
    the original track's song tag and notes. Returns the full updated track list.
    """
    track = db.get_track(track_id)
    if not track:
        raise ValueError("Track not found")

    if split_at_sec <= 1.0 or split_at_sec >= track.duration_sec - 1.0:
        raise ValueError("Split point must be more than 1 second from either edge")

    # Convert relative position to absolute position in source file
    absolute_split = track.start_sec + split_at_sec

    cfg = get_config()
    storage = get_storage()
    session = db.get_session(track.session_id)
    source_file = cfg.resolve_path(session.source_file)
    output_dir = cfg.resolve_path(track.audio_path).parent

    # Ensure source file is local if using remote storage
    if storage.is_remote:
        source_file = storage.get(session.source_file, source_file)

    total_tracks = len(db.get_tracks_for_session(session.id)) + 1

    # Export first half
    filename_1 = generate_output_name(
        track.track_number,
        total_tracks,
        track.start_sec,
        absolute_split,
        extension=audio_format.extension,
    )
    path_1 = output_dir / filename_1
    export_segment(source_file, path_1, track.start_sec, absolute_split, audio_format=audio_format)

    # Export second half
    filename_2 = generate_output_name(
        track.track_number + 1,
        total_tracks,
        absolute_split,
        track.end_sec,
        extension=audio_format.extension,
    )
    path_2 = output_dir / filename_2
    export_segment(source_file, path_2, absolute_split, track.end_sec, audio_format=audio_format)

    # Preserve first track's metadata
    song_id = track.song_id
    notes = track.notes

    # Remove old audio file and DB row
    storage.delete(track.audio_path)
    db.delete_track(track.id)

    # Create first half (keeps metadata)
    rel_path_1 = cfg.make_relative(path_1)
    first_id = db.create_track(
        session_id=session.id,
        track_number=track.track_number,
        start_sec=track.start_sec,
        end_sec=absolute_split,
        audio_path=rel_path_1,
    )
    if storage.is_remote:
        storage.put(rel_path_1, path_1)

    if song_id:
        db.update_track(first_id, song_id=song_id)
    if notes:
        db.update_track_notes(first_id, notes)

    # Create second half (blank)
    rel_path_2 = cfg.make_relative(path_2)
    db.create_track(
        session_id=session.id,
        track_number=track.track_number + 1,
        start_sec=absolute_split,
        end_sec=track.end_sec,
        audio_path=rel_path_2,
    )
    if storage.is_remote:
        storage.put(rel_path_2, path_2)

    # Renumber all tracks in the session
    _renumber_tracks(db, session.id, output_dir, audio_format=audio_format)

    return db.get_tracks_for_session(session.id)


def trim_track(
    db: Database,
    track_id: int,
    start_delta: float = 0.0,
    end_delta: float = 0.0,
    audio_format: AudioFormat = DEFAULT_FORMAT,
) -> Track:
    """Trim a track by adjusting start/end boundaries and re-exporting.

    start_delta positive = remove from beginning, negative = extend earlier.
    end_delta positive = extend later, negative = remove from end.
    Returns the updated Track.
    """
    if start_delta == 0.0 and end_delta == 0.0:
        raise ValueError("Must provide at least one of start_delta or end_delta")

    track = db.get_track(track_id)
    if not track:
        raise ValueError("Track not found")

    new_start = track.start_sec + start_delta
    new_end = track.end_sec + end_delta

    if new_start < 0:
        raise ValueError("Cannot extend before start of recording")

    session = db.get_session(track.session_id)
    if session.duration_sec and new_end > session.duration_sec:
        raise ValueError("Cannot extend past end of recording")

    new_duration = new_end - new_start
    if new_duration < 1.0:
        raise ValueError("Trimmed track must be at least 1 second long")

    cfg = get_config()
    storage = get_storage()
    source_file = cfg.resolve_path(session.source_file)
    output_dir = cfg.resolve_path(track.audio_path).parent

    if storage.is_remote:
        source_file = storage.get(session.source_file, source_file)

    total_tracks = len(db.get_tracks_for_session(session.id))
    filename = generate_output_name(
        track.track_number,
        max(total_tracks, 1),
        new_start,
        new_end,
        extension=audio_format.extension,
    )
    new_path = output_dir / filename
    export_segment(source_file, new_path, new_start, new_end, audio_format=audio_format)

    old_audio_path = track.audio_path
    new_rel_path = cfg.make_relative(new_path)

    if old_audio_path != new_rel_path:
        storage.delete(old_audio_path)

    if storage.is_remote:
        storage.put(new_rel_path, new_path)

    db.update_track(
        track_id,
        start_sec=new_start,
        end_sec=new_end,
        duration_sec=new_duration,
        audio_path=new_rel_path,
    )

    return db.get_track(track_id)


def _renumber_tracks(
    db: Database,
    session_id: int,
    output_dir: Path,
    audio_format: AudioFormat = DEFAULT_FORMAT,
):
    """Renumber all tracks in a session sequentially by start_sec.

    Updates track_number and renames audio files in storage to match.
    """
    tracks = db.get_tracks_for_session(session_id)
    # Sort by start_sec for correct ordering after merge/split
    tracks.sort(key=lambda t: t.start_sec)
    total = len(tracks)

    cfg = get_config()
    storage = get_storage()
    for i, track in enumerate(tracks, start=1):
        expected_num = i
        if track.track_number != expected_num:
            new_name = generate_output_name(
                expected_num,
                total,
                track.start_sec,
                track.end_sec,
                extension=audio_format.extension,
            )
            new_path = output_dir / new_name
            new_rel = cfg.make_relative(new_path)
            storage.rename(track.audio_path, new_rel)
            db.update_track(track.id, track_number=expected_num, audio_path=new_rel)
            # Same audio under a new name: its transcript is still good
            db.rename_transcript_audio(track.id, track.audio_path, new_rel)


LOSSLESS_EXTENSIONS = {".wav", ".flac"}


def _concat_audio(sources: list[Path], output: Path, sample_rate: int) -> None:
    """Join audio files end to end into `output` (FLAC or AAC, by extension)."""
    cmd = ["ffmpeg", "-y", "-v", "error"]
    for src in sources:
        cmd += ["-i", str(src)]
    chains = "".join(
        f"[{i}:a:0]aresample={sample_rate},aformat=channel_layouts=stereo[a{i}];"
        for i in range(len(sources))
    )
    inputs = "".join(f"[a{i}]" for i in range(len(sources)))
    cmd += ["-filter_complex", f"{chains}{inputs}concat=n={len(sources)}:v=0:a=1[out]"]
    cmd += ["-map", "[out]"]
    if output.suffix == ".flac":
        cmd += ["-c:a", "flac"]
    else:
        cmd += ["-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart"]
    cmd.append(str(output))
    proc = subprocess.run(cmd, capture_output=True)
    if proc.returncode != 0:
        raise RuntimeError(f"ffmpeg could not join the recordings: {proc.stderr.decode()[-300:]}")


def merge_sessions(
    db: Database,
    target_id: int,
    other_ids: list[int],
    on_progress=None,
    updated_by: int | None = None,
) -> None:
    """Merge recordings into `target_id`, in the order given.

    The source files are joined end to end into one new source (FLAC when every
    source is lossless, AAC otherwise). Tracks keep their audio files, tags,
    notes and share links: they are moved to the kept recording, renumbered,
    and their times shifted to where they now sit in the joined source. The
    merged recordings and the old source files are then removed. The kept
    recording keeps its name, date and type; notes are combined.
    """

    def progress(msg: str):
        if on_progress:
            on_progress(msg)

    cfg = get_config()
    storage = get_storage()
    sessions = [db.get_session(sid) for sid in [target_id, *other_ids]]
    if any(s is None for s in sessions):
        raise ValueError("Recording not found")

    local_sources: list[Path] = []
    merged_path: Path | None = None
    try:
        # 1. Get every source locally and measure it
        durations: list[float] = []
        rates: list[int] = []
        for i, s in enumerate(sessions, start=1):
            progress(f"Fetching recording {i} of {len(sessions)}...")
            local = cfg.resolve_path(s.source_file)
            if storage.is_remote:
                local = storage.get(s.source_file, local)
            local_sources.append(local)
            if not local.exists():
                raise ValueError(f"Source audio for '{s.name or s.id}' was not found")
            meta = extract_metadata(local)
            durations.append(meta.duration_seconds)
            rates.append(meta.sample_rate or 44100)

        # 2. Join them into one new source file
        progress("Joining recordings...")
        lossless = all(p.suffix.lower() in LOSSLESS_EXTENSIONS for p in local_sources)
        ext = ".flac" if lossless else ".m4a"
        merged_path = cfg.input_dir / f"{target_id}-merged-{uuid4().hex[:8]}{ext}"
        merged_path.parent.mkdir(parents=True, exist_ok=True)
        _concat_audio(local_sources, merged_path, max(rates))
        merged_rel = cfg.make_relative(merged_path)
        total_duration = extract_metadata(merged_path).duration_seconds
        if storage.is_remote:
            progress("Saving joined recording...")
            storage.put(merged_rel, merged_path)

        # 3. Move the tracks over, shifted to their place in the joined source
        progress("Moving tracks...")
        target_tracks = db.get_tracks_for_session(target_id)
        if target_tracks:
            output_dir = cfg.resolve_path(target_tracks[0].audio_path).parent
        else:
            output_dir = cfg.output_dir_for_session(target_id)
        output_dir.mkdir(parents=True, exist_ok=True)
        moves = []
        offset = 0.0
        for s, duration in zip(sessions, durations):
            for t in db.get_tracks_for_session(s.id):
                moves.append((t, t.start_sec + offset, t.end_sec + offset))
            offset += duration
        for number, (t, start, end) in enumerate(moves, start=1):
            name = generate_output_name(
                number, len(moves), start, end, extension=Path(t.audio_path).suffix
            )
            new_rel = cfg.make_relative(output_dir / name)
            if new_rel != t.audio_path:
                storage.rename(t.audio_path, new_rel)
            db.move_track(t.id, target_id, number, start, end, new_rel)

        # 4. Switch the kept recording to the joined source; drop the others
        notes = "\n".join(n for n in ((s.notes or "").strip() for s in sessions) if n)
        db.finish_session_merge(
            target_id, other_ids, merged_rel, total_duration, notes, updated_by=updated_by
        )
        for s in sessions:
            if s.source_file and s.source_file != merged_rel:
                storage.delete(s.source_file)
    finally:
        if storage.is_remote:
            for p in local_sources:
                p.unlink(missing_ok=True)
            if merged_path:
                merged_path.unlink(missing_ok=True)
