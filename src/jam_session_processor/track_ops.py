"""Service layer for merge and split track operations.

Orchestrates re-export from source files, DB updates, and file renaming
when tracks are merged or split.
"""

from datetime import datetime
from pathlib import Path

from jam_session_processor.config import get_config
from jam_session_processor.db import Database, Track
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
    session_date = _parse_date(session.date)
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
        session_date,
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
        db.conn.execute("UPDATE tracks SET song_id = ? WHERE id = ?", (song_id, new_track_id))
        db.conn.commit()
    if notes:
        db.update_track_notes(new_track_id, notes)

    # Renumber all tracks in the session
    _renumber_tracks(db, session.id, session_date, output_dir, audio_format=audio_format)

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
    session_date = _parse_date(session.date)
    output_dir = cfg.resolve_path(track.audio_path).parent

    # Ensure source file is local if using remote storage
    if storage.is_remote:
        source_file = storage.get(session.source_file, source_file)

    total_tracks = len(db.get_tracks_for_session(session.id)) + 1

    # Export first half
    filename_1 = generate_output_name(
        session_date,
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
        session_date,
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
        db.conn.execute("UPDATE tracks SET song_id = ? WHERE id = ?", (song_id, first_id))
        db.conn.commit()
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
    _renumber_tracks(db, session.id, session_date, output_dir, audio_format=audio_format)

    return db.get_tracks_for_session(session.id)


def _renumber_tracks(
    db: Database,
    session_id: int,
    session_date: datetime | None,
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
                session_date,
                expected_num,
                total,
                track.start_sec,
                track.end_sec,
                extension=audio_format.extension,
            )
            new_path = output_dir / new_name
            new_rel = cfg.make_relative(new_path)
            storage.rename(track.audio_path, new_rel)
            db.update_track(
                track.id, track_number=expected_num, audio_path=new_rel
            )


def _parse_date(date_str: str | None) -> datetime | None:
    """Parse a date string from the database into a datetime."""
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return None
