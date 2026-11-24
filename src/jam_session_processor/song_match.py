"""Guess which song a track is from a (rough) transcript of its vocals.

Two sources of evidence, both plain text matching (no network, no ML here):

- ``lyrics``: the transcript against the lyrics in each candidate song's chart.
- ``takes``: the transcript against transcripts of takes already tagged with a song,
  which is what works for originals that have no lyrics written down.

Speech-to-text on a band recording is poor, but a few right phrases are enough to
pick a song out of a catalog. Texts are compared as TF-IDF vectors over word 1-3-grams
(cosine similarity); a suggestion is only made when the best candidate clearly stands
out from the runner-up.
"""

from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass

# Minimum lyric words for a chart to be a usable candidate / a transcript to be matched
MIN_LYRIC_WORDS = 40
MIN_TRANSCRIPT_WORDS = 15

# Confidence rules, tuned on 174 labeled takes (see docs/pipeline.md). ``ratio`` is the
# best candidate's score over the runner-up's.
LYRICS_MIN_SCORE = 0.10
LYRICS_ALT_MIN_SCORE = 0.06
LYRICS_ALT_MIN_RATIO = 2.0
TAKES_MIN_SCORE = 0.10
TAKES_MIN_RATIO = 1.5

_WORD = re.compile(r"[a-z']+")
_CHORD = re.compile(
    r"^[A-G][#b]?(m|maj|min|dim|aug|sus|add|M)?\d*(sus\d|add\d|b\d|#\d)*(/[A-G][#b]?)?$"
)
_SECTION = re.compile(r"\[[^\]]*\]")
_TAB_LINE = re.compile(r"\|-|-{3,}")


def words(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def extract_lyrics(sheet: str) -> str:
    """The lyric lines of a chart: no chord lines, section headings or tab staves."""
    out = []
    for line in (sheet or "").splitlines():
        line = _SECTION.sub("", line)
        if _TAB_LINE.search(line):
            continue
        tokens = line.split()
        if not tokens:
            continue
        chords = sum(bool(_CHORD.match(t.strip("|()x,."))) for t in tokens)
        if chords >= len(tokens) * 0.6:
            continue
        out.append(line)
    return " ".join(words(" ".join(out)))


def clean_transcript(segments: list[tuple[str, float]]) -> str:
    """Join transcript segments ``(text, compression_ratio)`` into matchable text.

    Speech-to-text loops on music ("I'm alone, I'm alone, ..."): a segment that is
    mostly repetition keeps one copy of each word, and a line is kept at most twice.
    """
    seen: Counter[str] = Counter()
    out = []
    for text, compression_ratio in segments:
        t = " ".join(words(text))
        if not t:
            continue
        if compression_ratio > 2.4:
            t = " ".join(dict.fromkeys(t.split()))
        seen[t] += 1
        if seen[t] > 2:
            continue
        out.append(t)
    return " ".join(out)


def _ngrams(text: str) -> Counter[str]:
    toks = words(text)
    grams: Counter[str] = Counter()
    for n in (1, 2, 3):
        for i in range(len(toks) - n + 1):
            grams[" ".join(toks[i : i + n])] += 1
    return grams


class TextIndex:
    """TF-IDF vectors (sublinear tf, smoothed idf, L2-normalised) over word 1-3-grams."""

    def __init__(self, corpus: list[str]):
        df: Counter[str] = Counter()
        for doc in corpus:
            df.update(_ngrams(doc).keys())
        n = len(corpus)
        self._idf = {g: math.log((1 + n) / (1 + c)) + 1 for g, c in df.items()}

    def vector(self, text: str) -> dict[str, float]:
        vec = {}
        for gram, tf in _ngrams(text).items():
            idf = self._idf.get(gram)
            if idf is not None:
                vec[gram] = (1 + math.log(tf)) * idf
        norm = math.sqrt(sum(w * w for w in vec.values()))
        return {g: w / norm for g, w in vec.items()} if norm else {}


class Candidates:
    """Documents to match against, each labelled with a song (inverted index)."""

    def __init__(self, index: TextIndex):
        self._index = index
        self._postings: dict[str, list[tuple[int, float]]] = defaultdict(list)
        self._songs: list[int] = []
        self._keys: list[object] = []

    def add(self, song_id: int, text: str, key: object = None) -> None:
        doc = len(self._songs)
        self._songs.append(song_id)
        self._keys.append(key)
        for gram, w in self._index.vector(text).items():
            self._postings[gram].append((doc, w))

    def song_scores(self, text: str, allow=None) -> list[tuple[int, float]]:
        """Best similarity per song, highest first. ``allow(song_id, key)`` filters docs."""
        sims: dict[int, float] = defaultdict(float)
        for gram, w in self._index.vector(text).items():
            for doc, dw in self._postings.get(gram, ()):
                sims[doc] += w * dw
        best: dict[int, float] = {}
        for doc, sim in sims.items():
            song = self._songs[doc]
            if allow is not None and not allow(song, self._keys[doc]):
                continue
            if sim > best.get(song, 0.0):
                best[song] = sim
        return sorted(best.items(), key=lambda kv: -kv[1])


@dataclass
class Suggestion:
    song_id: int
    score: float
    ratio: float
    source: str  # "lyrics" | "takes"


def _confident(ranked: list[tuple[int, float]], source: str) -> Suggestion | None:
    if not ranked:
        return None
    song_id, score = ranked[0]
    runner_up = ranked[1][1] if len(ranked) > 1 else 0.0
    ratio = score / runner_up if runner_up > 0 else 99.0
    if source == "lyrics":
        ok = score >= LYRICS_MIN_SCORE or (
            score >= LYRICS_ALT_MIN_SCORE and ratio >= LYRICS_ALT_MIN_RATIO
        )
    else:
        ok = score >= TAKES_MIN_SCORE and ratio >= TAKES_MIN_RATIO
    return Suggestion(song_id, round(score, 4), round(min(ratio, 99.0), 2), source) if ok else None


def suggest(
    transcript: str,
    lyrics: Candidates,
    takes: Candidates,
    allow_lyrics=None,
    allow_takes=None,
) -> Suggestion | None:
    """The song this transcript most likely is, or None when nothing stands out."""
    if len(words(transcript)) < MIN_TRANSCRIPT_WORDS:
        return None
    by_lyrics = _confident(lyrics.song_scores(transcript, allow_lyrics), "lyrics")
    by_takes = _confident(takes.song_scores(transcript, allow_takes), "takes")
    if by_lyrics and by_takes and by_lyrics.song_id != by_takes.song_id:
        return max(by_lyrics, by_takes, key=lambda s: s.ratio)
    return by_lyrics or by_takes
