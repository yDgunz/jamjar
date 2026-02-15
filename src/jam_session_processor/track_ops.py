"""Service layer for merge and split track operations.

Orchestrates re-export from source files, fingerprinting, DB updates,
and file renaming when tracks are merged or split.
"""

import os
from datetime import datetime
from pathlib import Path

from jam_session_processor.db import Database, Track
from jam_session_processor.fingerprint import compute_chroma_fingerprint
from jam_session_processor.output import generate_output_name
from jam_session_processor.splitter import export_segment


def merge_tracks(db: Database, track_id_1: int, track_id_2: int) -> list[Track]:
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

    session = db.get_session(t1.session_id)
    source_file = Path(session.source_file)
    session_date = _parse_date(session.date)
    output_dir = Path(t1.audio_path).parent

    # New time range spans both tracks
    new_start = t1.start_sec
    new_end = t2.end_sec

    # Re-export merged segment
    total_tracks = len(db.get_tracks_for_session(session.id)) - 1
    filename = generate_output_name(
        session_date, t1.track_number, max(total_tracks, 1),
        new_start, new_end,
    )
    new_path = output_dir / filename
    export_segment(source_file, new_path, new_start, new_end)

    # Compute fingerprint for new file
    fp = compute_chroma_fingerprint(source_file, start_sec=new_start, duration_sec=new_end - new_start)

    # Preserve first track's metadata
    song_id = t1.song_id
    notes = t1.notes

    # Remove old audio files
    _safe_remove(t1.audio_path)
    _safe_remove(t2.audio_path)

    # Delete both old tracks, create merged track
    db.delete_track(t1.id)
    db.delete_track(t2.id)
    new_track_id = db.create_track(
        session_id=session.id,
        track_number=t1.track_number,
        start_sec=new_start,
        end_sec=new_end,
        audio_path=str(new_path),
        fingerprint=fp,
    )

    # Restore tag and notes
    if song_id:
        db.conn.execute("UPDATE tracks SET song_id = ? WHERE id = ?", (song_id, new_track_id))
        db.conn.commit()
    if notes:
        db.update_track_notes(new_track_id, notes)

    # Renumber all tracks in the session
    _renumber_tracks(db, session.id, session_date, output_dir)

    return db.get_tracks_for_session(session.id)


def split_track(db: Database, track_id: int, split_at_sec: float) -> list[Track]:
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

    session = db.get_session(track.session_id)
    source_file = Path(session.source_file)
    session_date = _parse_date(session.date)
    output_dir = Path(track.audio_path).parent

    total_tracks = len(db.get_tracks_for_session(session.id)) + 1

    # Export first half
    filename_1 = generate_output_name(
        session_date, track.track_number, total_tracks,
        track.start_sec, absolute_split,
    )
    path_1 = output_dir / filename_1
    export_segment(source_file, path_1, track.start_sec, absolute_split)
    fp_1 = compute_chroma_fingerprint(
        source_file, start_sec=track.start_sec, duration_sec=split_at_sec,
    )

    # Export second half
    filename_2 = generate_output_name(
        session_date, track.track_number + 1, total_tracks,
        absolute_split, track.end_sec,
    )
    path_2 = output_dir / filename_2
    export_segment(source_file, path_2, absolute_split, track.end_sec)
    fp_2 = compute_chroma_fingerprint(
        source_file, start_sec=absolute_split, duration_sec=track.end_sec - absolute_split,
    )

    # Preserve first track's metadata
    song_id = track.song_id
    notes = track.notes

    # Remove old audio file and DB row
    _safe_remove(track.audio_path)
    db.delete_track(track.id)

    # Create first half (keeps metadata)
    first_id = db.create_track(
        session_id=session.id,
        track_number=track.track_number,
        start_sec=track.start_sec,
        end_sec=absolute_split,
        audio_path=str(path_1),
        fingerprint=fp_1,
    )
    if song_id:
        db.conn.execute("UPDATE tracks SET song_id = ? WHERE id = ?", (song_id, first_id))
        db.conn.commit()
    if notes:
        db.update_track_notes(first_id, notes)

    # Create second half (blank)
    db.create_track(
        session_id=session.id,
        track_number=track.track_number + 1,
        start_sec=absolute_split,
        end_sec=track.end_sec,
        audio_path=str(path_2),
        fingerprint=fp_2,
    )

    # Renumber all tracks in the session
    _renumber_tracks(db, session.id, session_date, output_dir)

    return db.get_tracks_for_session(session.id)


def _renumber_tracks(db: Database, session_id: int, session_date: datetime | None, output_dir: Path):
    """Renumber all tracks in a session sequentially by start_sec.

    Updates track_number and renames audio files on disk to match.
    """
    tracks = db.get_tracks_for_session(session_id)
    # Sort by start_sec for correct ordering after merge/split
    tracks.sort(key=lambda t: t.start_sec)
    total = len(tracks)

    for i, track in enumerate(tracks, start=1):
        expected_num = i
        if track.track_number != expected_num:
            new_name = generate_output_name(
                session_date, expected_num, total,
                track.start_sec, track.end_sec,
            )
            new_path = output_dir / new_name
            old_path = Path(track.audio_path)
            if old_path.exists() and old_path != new_path:
                old_path.rename(new_path)
            db.update_track(track.id, track_number=expected_num, audio_path=str(new_path))


def _parse_date(date_str: str | None) -> datetime | None:
    """Parse a date string from the database into a datetime."""
    if not date_str:
        return None
    try:
        return datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return None


def _safe_remove(path: str):
    """Remove a file if it exists, ignore if it doesn't."""
    try:
        os.remove(path)
    except OSError:
        pass
