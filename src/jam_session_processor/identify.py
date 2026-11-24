"""Suggest songs for untagged tracks ("Looks like: ...").

One run (nightly, or ``jam-session identify-songs``):

1. Transcribes tracks that have no transcript yet (or whose audio changed), newest
   recordings first, within a time budget. Tagged tracks are transcribed too: they are
   the reference for recognising other takes of the same song.
2. Re-assesses every untagged track against its band's songs (chart lyrics and
   transcripts of tagged takes) and stores, replaces or clears its suggestion.

Step 2 is cheap and runs over everything each time, so suggestions improve as more
tracks get tagged and more charts get lyrics.
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


def transcribe_pending(db: Database, transcriber, max_seconds: float) -> dict:
    """Transcribe tracks lacking a current transcript until the time budget runs out."""
    cfg = get_config()
    storage = get_storage()
    deadline = time.monotonic() + max_seconds
    pending = db.tracks_needing_transcript()
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


def refresh_suggestions(db: Database) -> dict:
    """Re-assess every untagged track that has a transcript."""
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
        if t["song_id"] is not None and t["text"]:
            # key: the take's band, so a track is only compared with its own band's takes
            by_takes.add(t["song_id"], t["text"], t["group_id"])

    suggested = cleared = 0
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
        if found:
            db.set_suggestion(t["track_id"], found.song_id, found.score, found.source)
            suggested += 1
        elif db.clear_suggestion(t["track_id"]):
            cleared += 1
    return {"suggested": suggested, "cleared": cleared}


def run(db: Database, transcriber=None, max_minutes: int | None = None) -> dict:
    """One identification run. ``transcriber=None`` uses the local model if installed."""
    from jam_session_processor import transcribe

    summary: dict = {"transcribed": 0, "failed": 0, "remaining": 0, "skipped": ""}
    if transcriber is None and not transcribe.is_available():
        summary["skipped"] = "speech-to-text is not installed"
    elif transcriber is None and db.has_active_jobs():
        summary["skipped"] = "a recording is being processed"
    else:
        free = available_memory_mb()
        need = _env_int("JAM_TRANSCRIBE_MIN_FREE_MB", DEFAULT_MIN_FREE_MB)
        if transcriber is None and free is not None and free < need:
            summary["skipped"] = f"only {free} MB of memory free (needs {need})"
        else:
            if transcriber is None:
                transcriber = transcribe.Transcriber(model_dir=get_config().data_dir / "models")
            if max_minutes is None:
                max_minutes = _env_int("JAM_IDENTIFY_MAX_MINUTES", DEFAULT_MAX_MINUTES)
            summary.update(transcribe_pending(db, transcriber, max_minutes * 60))
    if summary["skipped"]:
        logger.warning("Not transcribing this run: %s", summary["skipped"])
    summary.update(refresh_suggestions(db))
    logger.info("Song identification run: %s", summary)
    return summary
