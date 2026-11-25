"""Mechanical cleanup of guitar tabs pasted or fetched from tab sites.

A tab should hold what you play from: tuning/capo, section labels, staffs with
the chord names and short directions that belong to them. Tab sites wrap that
in a lot more: a title block, credits, e-mail addresses, a symbol legend, chord
diagrams and the whole song again as chords over lyrics. `clean_tab` removes
those, by deleting whole lines only (staff lines are never edited), and pulls
the "where this came from" line out as the tab's source.

Everything here is pattern matching, so it only takes out what is clear-cut.
Commentary in prose and alternate versions are left for a reader (the
library-curation routine) to judge.
"""

import html
import re
from dataclasses import dataclass

# "e|---3---", "B|-0-1-3-", "D:--2--": a string name, a bar, and dashes
_STAFF_RE = re.compile(r"^\s*[A-Ga-g][#b]?\s?[|:]")
_HEADER_RE = re.compile(r"^\s*\[.*\]\s*$")
_CHORD_RE = re.compile(
    r"^[A-G][#b]?(?:maj|Maj|min|dim|aug|sus|add|m|M|\+|°|ø|[0-9]|[#b](?=[0-9]))*"
    r"(?:\([0-9]\))?(?:/[A-G][#b]?)?$"
)
_CHORD_EXTRA_RE = re.compile(r"^(-+|/+|\|+|%|\.{2,}|\*+|\(?(?:x\d+|\d+x)\)?|N\.?C\.?)$", re.I)

# "(Full tab: Ultimate Guitar, 186 votes, 4.8★)"
_SOURCE_RE = re.compile(
    r"^\s*\(?\s*(?:full\s+)?(?:tab|tabs|chart|chords)\s*:\s*(.+?(?:votes?|★).*?)\s*\)?\s*$", re.I
)
_CREDIT_RE = re.compile(
    r"^\s*(?:artist|band|song|title|album|year|released|writers?|composers?|author|"
    r"e-?mail|date|from the album|written by|music by|words by|lyrics by|"
    r"tabbed by|tab by|transcribed by|transcription by|submitted by|corrections? by)"
    r"\s*[:\-–]",
    re.I,
)
_CREDIT_PHRASE_RE = re.compile(r"\b(?:tabbed|transcribed|submitted|tab|transcription)\s+by\b", re.I)
_EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_URL_RE = re.compile(r"(?:https?://|www\.)\S+", re.I)
_RULE_RE = re.compile(r"^\s*([*=_~#+-])\1{5,}\s*$")
_LEGEND_ENTRY_RE = re.compile(
    r"^[\s|*]*\(?(?:[hpbrstvxHPBRSTVX]|br|pb|b\^|sl|[/\\~^<>*x.()]{1,3}|[npa]\.[hm]\.?|\d+[hpb/\\]\d+)\)?"
    r"\s*[-=:.>]*\s*"
    r"(?:hammer|pull|bend|release|slide|vibrato|dead note|mute|muted|palm mut|sustain|return|"
    r"harmonic|natural harm|pinch harm|tap|tapping|ghost note|let ring|tremolo|trill)"
    r"[\w\s\-/().,']{0,40}$",
    re.I,
)
_LEGEND_TITLE_RE = re.compile(
    r"^\W*(?:tab(?:lature)?\s+)?(?:legend|symbols?|key|notation)\W*$", re.I
)
_CHORDS_USED_RE = re.compile(r"^\W*chords?(?:\s+used)?(?:\s+in\s+this\s+song)?\W*$", re.I)
# Lines worth keeping at the top of a tab even though they aren't music
_INFO_RE = re.compile(
    r"\b(?:capo|tuning|tuned|tune|key|tempo|bpm|standard|drop\s?[a-g]|half[\s-]step|"
    r"time signature|\d/\d)\b",
    re.I,
)
# Words a title line is made of besides the song and artist names
_TITLE_FILLER = set(
    "a an the by from of and for on in with guitar guitars tab tabs tablature tabbed chords "
    "chord intro solo riff lesson version ver alternate album acoustic electric live studio "
    "full complete correct lead rhythm bass pro official song".split()
)


@dataclass
class CleanedTab:
    text: str
    source: str  # "Ultimate Guitar, 186 votes, 4.8★" (or a URL); "" when the tab had none


def is_staff_line(line: str) -> bool:
    return bool(_STAFF_RE.match(line)) and line.count("-") >= 4


def _is_chord_token(token: str) -> bool:
    t = token.lstrip("(").rstrip(")*_,")
    parts = [p for p in t.split("-") if p]
    return bool(parts) and all(_CHORD_RE.match(p) for p in parts)


def is_chord_line(line: str) -> bool:
    tokens = line.split()
    return (
        bool(tokens)
        and all(_is_chord_token(t) or _CHORD_EXTRA_RE.match(t) for t in tokens)
        and any(_is_chord_token(t) for t in tokens)
    )


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9]+", text.lower().replace("'", "").replace("’", ""))


def _trigrams(words: list[str]) -> set[tuple[str, ...]]:
    return {tuple(words[k : k + 3]) for k in range(len(words) - 2)}


def _lyric_trigrams(sheet: str) -> set[tuple[str, ...]]:
    """Every run of three words in the chart's lyrics, for spotting them in a tab."""
    out: set[tuple[str, ...]] = set()
    for line in sheet.split("\n"):
        if is_staff_line(line) or is_chord_line(line) or _HEADER_RE.match(line):
            continue
        out |= _trigrams(_words(line))
    return out


def _has_chords_over_lyrics(sheet: str) -> bool:
    lines = sheet.split("\n")
    return any(
        is_chord_line(a) and b.strip() and not is_chord_line(b) and not is_staff_line(b)
        for a, b in zip(lines, lines[1:])
    )


def _is_title_line(line: str, name_words: list[str], artist_words: list[str]) -> bool:
    """A line that only names the song (and artist, album, "guitar tab"…)."""
    words = _words(line)
    if not words or _INFO_RE.search(line):
        return False
    rest = [w for w in words if w not in _TITLE_FILLER and not w.isdigit()]
    joined = " ".join(words)
    has_name = bool(name_words) and " ".join(name_words) in joined
    has_artist = bool(artist_words) and " ".join(artist_words) in joined
    for known in (name_words if has_name else []), (artist_words if has_artist else []):
        for w in known:
            if w in rest:
                rest.remove(w)
    if not has_name and not has_artist:
        return not rest  # "Guitar Tabs"
    return len(rest) <= 2  # "Dogs (Pink Floyd - Animals) [Alternate]"


def _strip_edges(line: str) -> str:
    """What is left of a label after an e-mail address or link is cut out of it."""
    line = re.sub(r"\s*[\[(<{]\s*[\])>}]", "", line)  # the emptied brackets
    return (
        re.sub(r"\s{2,}(?=\S)", " ", line.rstrip()) if not line.startswith(" ") else line.rstrip()
    )


def clean_tab(tab: str, song_name: str = "", artist: str = "", sheet: str = "") -> CleanedTab:
    """Remove site clutter from a tab. `sheet` is the song's chart: when it has
    the chords and lyrics, the tab's own copy of them is dropped."""
    text = html.unescape(tab.replace("\r\n", "\n").replace("\t", "    "))
    lines = [ln.rstrip() for ln in text.split("\n")]
    name_words, artist_words = _words(song_name), _words(artist)
    lyrics = _lyric_trigrams(sheet)
    drop_lyrics = _has_chords_over_lyrics(sheet)
    source = ""

    def nxt(i: int) -> str:
        return lines[i + 1] if i + 1 < len(lines) else ""

    # --- Pass 1: single lines ---------------------------------------------
    first_music = next(
        (i for i, ln in enumerate(lines) if is_staff_line(ln) or _HEADER_RE.match(ln)),
        len(lines),
    )
    keep: list[str | None] = list(lines)
    in_legend = False
    for i, line in enumerate(lines):
        if not line.strip() or is_staff_line(line):
            in_legend = in_legend and not is_staff_line(line)
            continue
        m = _SOURCE_RE.match(line)
        if m:
            source = source or m.group(1).strip()
            keep[i] = None
            continue
        if _RULE_RE.match(line):
            keep[i] = None
            continue
        if _LEGEND_TITLE_RE.match(line) and not _INFO_RE.search(nxt(i)):
            # "Legend:" counts only when legend entries follow
            following = [ln for ln in lines[i + 1 : i + 4] if ln.strip()]
            if following and _LEGEND_ENTRY_RE.match(following[0]):
                keep[i] = None
                in_legend = True
                continue
        if len(line.strip()) <= 60 and _LEGEND_ENTRY_RE.match(line) and not is_chord_line(line):
            keep[i] = None
            in_legend = True
            continue
        in_legend = False
        if _CREDIT_RE.match(line) and not _INFO_RE.search(line):
            keep[i] = None
            continue
        if _EMAIL_RE.search(line) or _URL_RE.search(line) or _CREDIT_PHRASE_RE.search(line):
            if is_staff_line(nxt(i)) and not _CREDIT_PHRASE_RE.search(line):
                # A label over a staff ("Zach's [zach@…] version:"): keep it, minus the address
                keep[i] = _strip_edges(_URL_RE.sub("", _EMAIL_RE.sub("", line)))
            else:
                keep[i] = None
            continue
        if i < first_music and _is_title_line(line, name_words, artist_words):
            keep[i] = None
    lines = [ln for ln in keep if ln is not None]

    # --- Pass 2: the chord-diagram block ("Chords used:" + shapes) ---------
    out: list[str] = []
    i = 0
    while i < len(lines):
        if _CHORDS_USED_RE.match(lines[i]):
            j = i + 1
            while j < len(lines):
                if not lines[j].strip():
                    j += 1
                elif _mostly_chords(lines[j]) and is_staff_line(nxt_line(lines, j)):
                    j += 1
                    while j < len(lines) and is_staff_line(lines[j]):
                        j += 1
                elif is_chord_line(lines[j]) or re.match(
                    r"^\s*[A-G]\S*\s*[:=]?\s*[x\d]{6}\s*$", lines[j]
                ):
                    j += 1  # "Am  x02210"
                else:
                    break
            i = j
            continue
        out.append(lines[i])
        i += 1
    lines = out

    # --- Pass 3: chords and lyrics the chart already has -------------------
    if drop_lyrics:
        lines = _drop_chart_copy(lines, lyrics)

    # --- Pass 4: headers left with nothing under them, blank lines ---------
    out = []
    for i, line in enumerate(lines):
        if _HEADER_RE.match(line):
            rest = next((ln for ln in lines[i + 1 :] if ln.strip()), None)
            if rest is None or _HEADER_RE.match(rest):
                continue
        if not line.strip() and out and _HEADER_RE.match(out[-1]):
            continue  # no gap between a section label and its first line
        out.append(line)
    cleaned = re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip("\n")
    return CleanedTab(text=cleaned, source=source)


def _mostly_chords(line: str) -> bool:
    """A row of chord names over chord shapes, allowing odd ones like "Em(2)C(2)"."""
    tokens = line.split()
    return len(tokens) >= 2 and sum(map(_is_chord_token, tokens)) / len(tokens) >= 0.6


def nxt_line(lines: list[str], i: int) -> str:
    return lines[i + 1] if i + 1 < len(lines) else ""


def _drop_chart_copy(lines: list[str], lyrics: set[tuple[str, ...]]) -> list[str]:
    """Drop lyric lines (with the chord line over them) and whole sections that
    hold only chords and lyrics. Lines sitting directly on a staff are labels
    and stay."""

    def is_lyric(i: int) -> bool:
        line = lines[i]
        if not line.strip() or is_staff_line(line) or is_chord_line(line):
            return False
        if _HEADER_RE.match(line) or re.match(r"^\s*\(.*\)[:.]?\s*$", line):
            return False
        over_chords = i > 0 and is_chord_line(lines[i - 1])
        below = [ln for ln in lines[i + 1 : i + 3] if ln.strip()][:1]
        if is_staff_line(nxt_line(lines, i)) or (
            not over_chords and below and is_staff_line(below[0])
        ):
            return False  # a label or a sung cue for the staff under it
        words = _words(line)
        if not words:
            return False
        grams = _trigrams(words)
        if grams and len(grams & lyrics) / len(grams) >= 0.6:
            return True
        # Not in the chart word for word: a sentence under a chord line still is one
        return (
            i > 0
            and is_chord_line(lines[i - 1])
            and len(words) >= 4
            and (
                not re.search(
                    r"[():]|\bx\d\b|\bplay\b|\brepeat\b|\bchords?\b|\btwice\b", line, re.I
                )
            )
        )

    gone = [False] * len(lines)
    for i in range(len(lines)):
        if is_lyric(i):
            gone[i] = True
            if i > 0 and is_chord_line(lines[i - 1]):
                gone[i - 1] = True

    # Sections without any staff: a verse written out, or only chords. Drop it all
    starts = [i for i, ln in enumerate(lines) if _HEADER_RE.match(ln)] + [len(lines)]
    for a, b in zip(starts, starts[1:]):
        body = range(a + 1, b)
        if any(is_staff_line(lines[k]) for k in body):
            continue
        left = [k for k in body if lines[k].strip() and not gone[k]]
        if any(gone[k] for k in body) or (left and all(is_chord_line(lines[k]) for k in left)):
            for k in range(a, b):
                # Directions in brackets ("(arpeggios as in verse 2)") stay, under their header
                direction = k > a and re.match(r"^\s*\(.*\)[:.]?\s*$", lines[k])
                gone[k] = gone[k] or bool(lines[k].strip() and not direction)
            if any(lines[k].strip() and not gone[k] for k in body):
                gone[a] = False

    # A chord line left alone between dropped lyrics (not over a staff) goes too
    for i, line in enumerate(lines):
        if gone[i] or not is_chord_line(line):
            continue
        prev = next((k for k in range(i - 1, -1, -1) if lines[k].strip()), None)
        after = next((k for k in range(i + 1, len(lines)) if lines[k].strip()), None)
        if prev is not None and after is not None and gone[prev] and gone[after]:
            if not is_staff_line(lines[after]):
                gone[i] = True
    return [ln for k, ln in enumerate(lines) if not gone[k]]
