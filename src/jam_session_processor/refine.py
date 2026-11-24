"""Refine an automatic split from what is sung: cut tracks that hold two songs, join
takes that were cut in two.

Loudness alone (``splitter.detect_songs``) can't tell a pause inside a song from the
pause between two songs played back to back. The transcripts can, when the band has a
chart or a tagged take of the songs: loudness proposes where a cut could go (a dip in
level), and the words on either side decide whether it is one.

- **Split** a track at a dip when the two sides are different songs: both recognised
  as different songs, or one recognised and the other a good stretch of singing that
  clearly isn't that song.
- **Merge** two neighbouring tracks a few seconds apart when both are recognised as the
  same song and the second doesn't start the song over (that would be a second take).

Everything here is plain computation on stored transcripts; ``apply`` does the audio
work through ``track_ops``. Instrumentals and songs the band has nothing written down
for are left as loudness cut them.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from jam_session_processor import song_match
from jam_session_processor.splitter import (
    DEFAULT_MIN_SONG_DURATION_SEC,
    LOUD_MARGIN_DB,
    LOUD_PERCENTILE,
)

logger = logging.getLogger(__name__)

# A dip is a stretch at least this long below the track's playing level (3 s smoothing)
DIP_MIN_SEC = 2
DIP_SMOOTHING_SEC = 3
# A side that isn't recognised counts as "another song" only with this much singing in
# it, none of which looks like the song on the other side
OTHER_SONG_MIN_WORDS = 60
OTHER_SONG_MAX_SCORE = 0.04
# Takes further apart than this are never joined
MERGE_MAX_GAP_SEC = 20
# The opening of a take, compared with the opening of the one before to spot a restart
OPENING_SEC = 60
RESTART_MIN_SIMILARITY = 0.25
QUIET_DB = -60


@dataclass
class Piece:
    """A stretch of a recording that is (or should become) one track."""

    start: float  # seconds into the recording
    end: float
    segments: list[list]  # [start, end, text, compression_ratio], times from ``start``
    levels: list[int]  # dB per second from ``start``
    track_ids: list[int] = field(default_factory=list)  # the tracks it is made from
    was_cut: bool = False  # one part of a track that was cut

    def text(self, lo: float = 0.0, hi: float | None = None) -> str:
        hi = self.end - self.start if hi is None else hi
        return song_match.clean_transcript(
            [(s[2], s[3]) for s in self.segments if lo <= (s[0] + s[1]) / 2 < hi]
        )


class Matcher:
    """Which of a band's songs a piece of transcript is."""

    def __init__(self, index, lyrics, takes, allow_lyrics=None, allow_takes=None):
        self._index = index
        self._lyrics, self._takes = lyrics, takes
        self._allow_lyrics, self._allow_takes = allow_lyrics, allow_takes

    def best(self, text: str) -> int | None:
        found = song_match.suggest(
            text, self._lyrics, self._takes, self._allow_lyrics, self._allow_takes
        )
        return found.song_id if found else None

    def score(self, text: str, song_id: int) -> float:
        by_lyrics = dict(self._lyrics.song_scores(text, self._allow_lyrics))
        by_takes = dict(self._takes.song_scores(text, self._allow_takes))
        return max(by_lyrics.get(song_id, 0.0), by_takes.get(song_id, 0.0))

    def similarity(self, a: str, b: str) -> float:
        va, vb = self._index.vector(a), self._index.vector(b)
        return sum(w * vb.get(gram, 0.0) for gram, w in va.items())


def find_dips(levels: list[int]) -> list[tuple[int, int, int]]:
    """Brief drops in level inside a track: ``(start_sec, end_sec, lowest_sec)``."""
    if len(levels) < 2 * DEFAULT_MIN_SONG_DURATION_SEC:
        return []
    ordered = sorted(levels)
    loud = ordered[min(len(ordered) - 1, int(len(ordered) * LOUD_PERCENTILE))]
    threshold = loud - LOUD_MARGIN_DB
    half = DIP_SMOOTHING_SEC // 2
    smoothed = []
    for i in range(len(levels)):
        window = levels[max(0, i - half) : i + half + 1]
        smoothed.append(sum(window) / len(window))
    dips = []
    start = None
    for i, level in enumerate(smoothed + [threshold]):
        if level < threshold and start is None:
            start = i
        elif level >= threshold and start is not None:
            if i - start >= DIP_MIN_SEC:
                lowest = min(range(start, i), key=lambda k: smoothed[k])
                dips.append((start, i, lowest))
            start = None
    return dips


def _different_songs(matcher: Matcher, left: str, right: str) -> int:
    """How sure it is that two texts are different songs: 2 (both recognised, as
    different songs), 1 (one recognised, the other clearly something else) or 0."""
    song_left, song_right = matcher.best(left), matcher.best(right)
    if song_left and song_right:
        return 2 if song_left != song_right else 0
    for song, other in ((song_left, right), (song_right, left)):
        if (
            song
            and len(song_match.words(other)) >= OTHER_SONG_MIN_WORDS
            and matcher.score(other, song) < OTHER_SONG_MAX_SCORE
        ):
            return 1
    return 0


def find_cuts(piece: Piece, matcher: Matcher, lo: float = 0.0, hi: float | None = None):
    """Where to cut a piece (seconds from its start), best cut first, recursively."""
    hi = piece.end - piece.start if hi is None else hi
    min_len = DEFAULT_MIN_SONG_DURATION_SEC
    best = None
    for start, end, lowest in find_dips(piece.levels):
        if lowest - lo < min_len or hi - lowest < min_len:
            continue
        sure = _different_songs(matcher, piece.text(lo, lowest), piece.text(lowest, hi))
        if sure and (best is None or (sure, end - start) > best[:2]):
            best = (sure, end - start, lowest)
    if best is None:
        return []
    cut = float(best[2])
    return sorted(find_cuts(piece, matcher, lo, cut) + [cut] + find_cuts(piece, matcher, cut, hi))


def _cut(piece: Piece, cuts: list[float]) -> list[Piece]:
    if not cuts:
        return [piece]
    edges = [0.0, *cuts, piece.end - piece.start]
    out = []
    for a, b in zip(edges, edges[1:]):
        segments = [
            [round(s[0] - a, 1), round(s[1] - a, 1), s[2], s[3]]
            for s in piece.segments
            if a <= (s[0] + s[1]) / 2 < b
        ]
        out.append(
            Piece(
                piece.start + a,
                piece.start + b,
                segments,
                piece.levels[int(a) : int(b)],
                list(piece.track_ids),
            )
        )
    return out


def _should_join(first: Piece, second: Piece, matcher: Matcher) -> bool:
    if second.start - first.end > MERGE_MAX_GAP_SEC:
        return False
    song = matcher.best(first.text())
    if not song or matcher.best(second.text()) != song:
        return False
    # Both start with the same lines: the band started the song again (a second take)
    restart = matcher.similarity(first.text(0, OPENING_SEC), second.text(0, OPENING_SEC))
    return restart < RESTART_MIN_SIMILARITY


def _join(first: Piece, second: Piece) -> Piece:
    offset = second.start - first.start
    length = int(first.end - first.start)
    gap = max(0, int(round(offset)) - length)
    levels = (first.levels + [QUIET_DB] * length)[:length] + [QUIET_DB] * gap + second.levels
    segments = first.segments + [
        [round(s[0] + offset, 1), round(s[1] + offset, 1), s[2], s[3]] for s in second.segments
    ]
    return Piece(first.start, second.end, segments, levels, first.track_ids + second.track_ids)


def plan(tracks: list[Piece], matcher: Matcher) -> list[Piece]:
    """The pieces a recording's tracks should become (unchanged ones included)."""
    out: list[Piece] = []
    for track in sorted(tracks, key=lambda p: p.start):
        pieces = _cut(track, find_cuts(track, matcher))
        # Only whole neighbouring tracks are joined, never the halves of a fresh cut
        if out and len(pieces) == 1 and not out[-1].was_cut:
            if _should_join(out[-1], pieces[0], matcher):
                out[-1] = _join(out[-1], pieces[0])
                continue
        for piece in pieces:
            piece.was_cut = len(pieces) > 1
        out.extend(pieces)
    return out


def apply(db, session_id: int, tracks: list[Piece], pieces: list[Piece], model: str) -> dict:
    """Re-cut a recording's tracks into ``pieces`` and store each new track's transcript
    (taken from the old ones, so nothing is transcribed again)."""
    from jam_session_processor import track_ops

    def track_at(start: float):
        for t in db.get_tracks_for_session(session_id):
            if abs(t.start_sec - start) < 0.05:
                return t
        raise LookupError(f"no track starting at {start}")

    changed = [p for p in pieces if p.was_cut or len(p.track_ids) > 1]
    for track_id in {tid for p in changed for tid in p.track_ids}:
        db.clear_auto_tag(track_id)

    splits = merges = 0
    starts = {t.start for t in tracks}
    for piece in pieces:
        # A cut: the piece starts inside a track rather than at its beginning
        if piece.was_cut and piece.start not in starts:
            inside = next(
                t
                for t in db.get_tracks_for_session(session_id)
                if t.start_sec < piece.start < t.end_sec
            )
            track_ops.split_track(db, inside.id, piece.start - inside.start_sec)
            splits += 1
    for piece in pieces:
        for _ in range(len(piece.track_ids) - 1):
            first = track_at(piece.start)
            following = [
                t for t in db.get_tracks_for_session(session_id) if t.start_sec > first.start_sec
            ]
            track_ops.merge_tracks(db, first.id, min(following, key=lambda t: t.start_sec).id)
            merges += 1
    for piece in changed:
        track = track_at(piece.start)
        db.save_transcript(
            track.id, track.audio_path, model, piece.text(), piece.segments, piece.levels
        )
    return {"splits": splits, "merges": merges}
