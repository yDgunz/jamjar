"""Tag untagged tracks with the song they are recognised as.

One run (nightly for everything, right after an upload or re-split for that recording,
or ``jam-session identify-songs`` by hand):

1. Transcribes tracks that have no transcript yet (or whose audio changed), newest
   recordings first, within a time budget. Tagged tracks are transcribed too: they are
   the reference for recognising other takes of the same song.
2. Refines the split of freshly detected recordings from what is sung: cuts tracks
   that hold two songs, joins takes cut in two (``refine``).
3. Re-assesses every untagged track against its band's songs (chart lyrics and
   transcripts of takes tagged by a person) and tags it when one song clearly stands
   out. A wrong tag is cheap to fix by hand; a removed one is not put back.

Step 3 is cheap and runs over everything each time, so more tracks get recognised as
more takes are tagged by hand and more charts get lyrics.
"""

from __future__ import annotations

import logging
import os
import tempfile
import time
from collections import defaultdict
from pathlib import Path

from jam_session_processor import song_match
from jam_session_processor.config import get_config
from jam_session_processor.db import Database
from jam_session_processor.storage import get_storage

logger = logging.getLogger(__name__)

DEFAULT_MAX_MINUTES = 180
DEFAULT_MIN_FREE_MB = 950
# How long a run waits for the server to be free before it gives up on transcribing
DEFAULT_WAIT_MINUTES = 30
WAIT_STEP_SEC = 30


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "") or default)
    except ValueError:
        return default


def available_memory_mb() -> int | None:
    """MemAvailable from /proc/meminfo, or None where that doesn't exist."""
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) // 1024
    except (OSError, ValueError, IndexError):
        pass
    return None


def transcribe_pending(
    db: Database, transcriber, max_seconds: float, session_id: int | None = None
) -> dict:
    """Transcribe tracks lacking a current transcript until the time budget runs out."""
    cfg = get_config()
    storage = get_storage()
    deadline = time.monotonic() + max_seconds
    pending = db.tracks_needing_transcript(session_id)
    done = failed = 0
    for row in pending:
        if time.monotonic() >= deadline:
            break
        tmp_dir = None
        try:
            if storage.is_remote:
                tmp_dir = tempfile.TemporaryDirectory(prefix="jam-transcribe-")
                suffix = Path(row["audio_path"]).suffix or ".m4a"
                local = storage.get(row["audio_path"], Path(tmp_dir.name) / f"track{suffix}")
            else:
                local = cfg.resolve_path(row["audio_path"])
            if hasattr(transcriber, "transcribe_timed"):
                found = transcriber.transcribe_timed(local)
                db.save_transcript(
                    row["id"],
                    row["audio_path"],
                    transcriber.model,
                    found.text,
                    found.segments,
                    found.levels,
                )
            else:
                text = transcriber.transcribe(local)
                db.save_transcript(row["id"], row["audio_path"], transcriber.model, text)
            done += 1
        except Exception:
            # Keep going: one unreadable file shouldn't stop the run. It stays pending.
            logger.exception("Could not transcribe track %s", row["id"])
            failed += 1
        finally:
            if tmp_dir is not None:
                tmp_dir.cleanup()
    return {"transcribed": done, "failed": failed, "remaining": len(pending) - done - failed}


def _candidates(db: Database):
    """What transcripts are matched against: chart lyrics and takes tagged by a person."""
    transcripts = db.get_transcripts()
    lyrics = {}
    for song_id, sheet in db.get_song_sheets():
        text = song_match.extract_lyrics(sheet)
        if len(text.split()) >= song_match.MIN_LYRIC_WORDS:
            lyrics[song_id] = text
    song_groups: dict[int, set[int]] = defaultdict(set)
    for group_id, song_id in db.get_group_song_links():
        song_groups[song_id].add(group_id)

    index = song_match.TextIndex(list(lyrics.values()) + [t["text"] for t in transcripts])
    by_lyrics = song_match.Candidates(index)
    for song_id, text in lyrics.items():
        by_lyrics.add(song_id, text)
    by_takes = song_match.Candidates(index)
    for t in transcripts:
        # Only takes a person tagged are references: an automatic tag could be wrong, and
        # matching against it would spread the mistake.
        if t["song_id"] is not None and t["text"] and not t["auto"]:
            # key: the take's band, so a track is only compared with its own band's takes
            by_takes.add(t["song_id"], t["text"], t["group_id"])
    return transcripts, index, by_lyrics, by_takes, song_groups


def refine_splits(db: Database) -> dict:
    """Split and merge the tracks of freshly detected recordings by what is sung
    (see ``refine``). Each recording is done once, when all its tracks are transcribed."""
    from jam_session_processor import refine

    session_ids = db.sessions_to_refine()
    splits = merges = 0
    if not session_ids:
        return {"splits": 0, "merges": 0}
    _, index, by_lyrics, by_takes, song_groups = _candidates(db)
    for session_id in session_ids:
        try:
            session = db.get_session(session_id)
            group_id = session.group_id
            matcher = refine.Matcher(
                index,
                by_lyrics,
                by_takes,
                allow_lyrics=lambda song, _key, g=group_id: g in song_groups[song],
                allow_takes=lambda song, key, g=group_id: key == g and g in song_groups[song],
            )
            timed = db.get_timed_transcripts(session_id)
            tracks = [
                refine.Piece(
                    t.start_sec, t.end_sec, timed[t.id]["segments"], timed[t.id]["levels"], [t.id]
                )
                for t in db.get_tracks_for_session(session_id)
            ]
            pieces = refine.plan(tracks, matcher)
            # Mark it first: a failure half-way must not be retried every night
            db.set_split_state(session_id, "refined")
            if len(pieces) != len(tracks) or any(p.was_cut for p in pieces):
                model = db.get_transcript_model(tracks[0].track_ids[0])
                done = refine.apply(db, session_id, tracks, pieces, model)
                splits += done["splits"]
                merges += done["merges"]
                logger.info("Recording %s: %s", session_id, done)
        except Exception:
            logger.exception("Could not refine the split of recording %s", session_id)
    return {"splits": splits, "merges": merges}


def tag_untagged(db: Database) -> dict:
    """Re-assess every untagged track that has a transcript; tag the recognised ones."""
    transcripts, _, by_lyrics, by_takes, song_groups = _candidates(db)

    tagged = 0
    for t in transcripts:
        if t["song_id"] is not None:
            continue
        group_id = t["group_id"]
        found = song_match.suggest(
            t["text"],
            by_lyrics,
            by_takes,
            allow_lyrics=lambda song, _key, g=group_id: g in song_groups[song],
            allow_takes=lambda song, key, g=group_id: key == g and g in song_groups[song],
        )
        if found and db.auto_tag_track(t["track_id"], found.song_id, found.score, found.source):
            tagged += 1
    return {"tagged": tagged}


def _busy(db: Database) -> str:
    """Why the server can't transcribe right now ('' when it can)."""
    if db.has_active_jobs():
        return "a recording is being processed"
    free = available_memory_mb()
    need = _env_int("JAM_TRANSCRIBE_MIN_FREE_MB", DEFAULT_MIN_FREE_MB)
    if free is not None and free < need:
        return f"only {free} MB of memory free (needs {need})"
    return ""


def _wait_until_free(db: Database, wait_minutes: float) -> str:
    """Wait for the server to be free to transcribe; the reason it still isn't, or ''.

    Several recordings are often uploaded or re-detected together: the run for the
    first starts while the others are still being split, and used to give up at once."""
    deadline = time.monotonic() + wait_minutes * 60
    reason = _busy(db)
    while reason and time.monotonic() < deadline:
        logger.info("Waiting to transcribe: %s", reason)
        time.sleep(WAIT_STEP_SEC)
        reason = _busy(db)
    return reason


def run(
    db: Database,
    transcriber=None,
    max_minutes: int | None = None,
    session_id: int | None = None,
    wait_minutes: float | None = None,
) -> dict:
    """One identification run. ``transcriber=None`` uses the local model if installed.
    ``session_id`` limits transcribing to one recording (the run after an upload).
    ``wait_minutes``: how long to wait for other processing to finish and memory to be
    free before skipping the transcribing (default ``JAM_IDENTIFY_WAIT_MINUTES``)."""
    from jam_session_processor import transcribe

    summary: dict = {"transcribed": 0, "failed": 0, "remaining": 0, "skipped": ""}
    if transcriber is None and not transcribe.is_available():
        summary["skipped"] = "speech-to-text is not installed"
    else:
        if transcriber is None:
            if wait_minutes is None:
                wait_minutes = _env_int("JAM_IDENTIFY_WAIT_MINUTES", DEFAULT_WAIT_MINUTES)
            summary["skipped"] = _wait_until_free(db, wait_minutes)
        if not summary["skipped"]:
            if transcriber is None:
                transcriber = transcribe.Transcriber(model_dir=get_config().data_dir / "models")
            if max_minutes is None:
                max_minutes = _env_int("JAM_IDENTIFY_MAX_MINUTES", DEFAULT_MAX_MINUTES)
            summary.update(transcribe_pending(db, transcriber, max_minutes * 60, session_id))
    if summary["skipped"]:
        logger.warning("Not transcribing this run: %s", summary["skipped"])
    summary.update(refine_splits(db))
    summary.update(tag_untagged(db))
    logger.info("Song identification run: %s", summary)
    return summary
