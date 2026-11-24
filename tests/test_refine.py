"""Refining an automatic split from what is sung: cut two-song tracks, join split takes."""

from dataclasses import dataclass

from jam_session_processor import api, identify, refine, song_match, track_ops
from tests.test_api import client  # noqa: F401
from tests.test_song_identification import HARBOR, ORCHARD

H = {"x-api-key": "test-api-key"}
HARBOR_LINES = [" ".join(HARBOR.split()[i : i + 12]) for i in range(0, 48, 12)]
ORCHARD_LINES = [" ".join(ORCHARD.split()[i : i + 12]) for i in range(0, 48, 12)]
# Sung words that are neither song (enough of them to count as "another song")
OTHER_LINES = [
    "midnight tractors rumble past our diner where waitresses know my order by heart",
    "seventeen umbrellas folded on some staircase waiting for storms that never showed",
    "postcards from my cousin in her town without rivers say weather is always fine",
    "yellow bicycles lean against that bakery and nobody has locked even one",
    "radio stations play static through every afternoon as pigeons argue on rooftops",
]
# A song whose lines differ from each other (its first and second half share nothing)
RIVER_LINES = [
    "barefoot on gravel we waded where minnows scatter under willow shade",
    "your brother skipped flat stones clear over to that rusted trestle bridge",
    "nobody told us summer ends before these peaches finish ripening",
    "so we carved initials deep into every picnic table by midnight",
    "later came freight trains hauling winter down from northern mountains",
    "and letters stopped arriving once your family sold their orchard cabin",
    "still I return each August pretending nothing changed since childhood",
    "watching dragonflies hover where your laughter used to echo loudest",
]


def _sing(lines, start, end):
    """Timed transcript segments: the lines spread evenly over [start, end)."""
    step = (end - start) / len(lines)
    return [
        [start + i * step, start + (i + 1) * step - 1, line, 1.2] for i, line in enumerate(lines)
    ]


def _levels(seconds, dips=(), blip=None):
    levels = [-18] * seconds
    for n, (a, b) in enumerate(dips):
        levels[a:b] = [blip if blip and n else -45] * (b - a)
    return levels


def _matcher(*extra_texts):
    lyrics = {1: HARBOR, 2: ORCHARD, 3: " ".join(RIVER_LINES)}
    index = song_match.TextIndex(list(lyrics.values()) + list(extra_texts))
    by_lyrics = song_match.Candidates(index)
    for song_id, text in lyrics.items():
        by_lyrics.add(song_id, text)
    return refine.Matcher(index, by_lyrics, song_match.Candidates(index))


def test_find_dips_ignores_short_tracks_and_blips():
    assert refine.find_dips(_levels(100, [(50, 55)])) == []  # too short to hold two songs
    dips = refine.find_dips(_levels(400, [(200, 205), (300, 302)], blip=-24))
    assert [(a, b) for a, b, _ in dips] == [(199, 206)]  # a slight drop isn't a dip
    assert 200 <= dips[0][2] <= 204


def test_cuts_a_track_holding_two_songs():
    segments = _sing(HARBOR_LINES, 5, 195) + _sing(ORCHARD_LINES, 210, 395)
    track = refine.Piece(1000.0, 1400.0, segments, _levels(400, [(200, 205)]), [7])
    first, second = refine.plan([track], _matcher())
    assert (first.start, second.end) == (1000.0, 1400.0)
    assert 1200 <= first.end == second.start <= 1204
    assert first.was_cut and second.was_cut
    assert "lanterns" in first.text() and "apples" not in first.text()
    assert "apples" in second.text() and "lanterns" not in second.text()
    assert second.segments[0][0] < 15  # times are from the new track's start
    assert len(first.levels) + len(second.levels) == 400


def test_leaves_one_song_with_a_pause_alone():
    segments = _sing(HARBOR_LINES[:2], 5, 195) + _sing(HARBOR_LINES[2:], 210, 395)
    track = refine.Piece(0.0, 400.0, segments, _levels(400, [(200, 205)]), [7])
    assert refine.plan([track], _matcher()) == [track]


def test_cuts_a_known_song_from_singing_that_is_clearly_another_song():
    segments = _sing(OTHER_LINES, 5, 195) + _sing(HARBOR_LINES, 210, 395)
    track = refine.Piece(0.0, 400.0, segments, _levels(400, [(200, 205)]), [7])
    assert len(refine.plan([track], _matcher(" ".join(OTHER_LINES)))) == 2
    # ...but not from a few stray words (banter, a count-in)
    segments = _sing(OTHER_LINES[:1], 5, 195) + _sing(HARBOR_LINES, 210, 395)
    track = refine.Piece(0.0, 400.0, segments, _levels(400, [(200, 205)]), [7])
    assert len(refine.plan([track], _matcher(" ".join(OTHER_LINES)))) == 1


def test_never_cuts_without_words_or_without_a_dip():
    two_songs = _sing(HARBOR_LINES, 5, 195) + _sing(ORCHARD_LINES, 210, 395)
    no_dip = refine.Piece(0.0, 400.0, two_songs, _levels(400), [7])
    instrumental = refine.Piece(0.0, 400.0, [], _levels(400, [(200, 205)]), [8])
    assert refine.plan([no_dip], _matcher()) == [no_dip]
    assert refine.plan([instrumental], _matcher()) == [instrumental]


def test_joins_a_take_that_was_cut_in_two():
    first = refine.Piece(0.0, 150.0, _sing(RIVER_LINES[:4], 5, 145), _levels(150), [1])
    second = refine.Piece(156.0, 300.0, _sing(RIVER_LINES[4:], 5, 140), _levels(144), [2])
    (joined,) = refine.plan([first, second], _matcher())
    assert (joined.start, joined.end, joined.track_ids) == (0.0, 300.0, [1, 2])
    assert len(joined.levels) == 300
    assert joined.segments[-1][1] > 156  # the second take's words moved to their place


def test_does_not_join_a_second_take_or_distant_or_different_songs():
    take = lambda start, ids, lines=HARBOR_LINES: refine.Piece(  # noqa: E731
        start, start + 150.0, _sing(lines, 5, 145), _levels(150), ids
    )
    assert len(refine.plan([take(0.0, [1]), take(156.0, [2])], _matcher())) == 2  # restart
    halves = [take(0.0, [1], RIVER_LINES[:4]), take(400.0, [2], RIVER_LINES[4:])]
    assert len(refine.plan(halves, _matcher())) == 2  # minutes apart
    assert len(refine.plan([take(0.0, [1]), take(156.0, [2], ORCHARD_LINES)], _matcher())) == 2


# --- The run: transcribe, refine, tag ---


@dataclass
class _Timed:
    text: str
    segments: list
    levels: list


class FakeTimedTranscriber:
    model = "fake"

    def __init__(self, by_file):
        self.by_file = by_file
        self.calls = []

    def transcribe_timed(self, path):
        self.calls.append(path.name)
        segments, levels = self.by_file[path.name]
        text = song_match.clean_transcript([(s[2], s[3]) for s in segments])
        return _Timed(text, segments, levels)


def _fake_split(db, track_id, split_at_sec):
    """track_ops.split_track without the audio work."""
    t = db.get_track(track_id)
    cut = t.start_sec + split_at_sec
    db.delete_track(t.id)
    db.create_track(t.session_id, t.track_number, t.start_sec, cut, f"tracks/{t.id}-a.m4a")
    db.create_track(t.session_id, t.track_number + 1, cut, t.end_sec, f"tracks/{t.id}-b.m4a")


def _recording(db, monkeypatch):
    monkeypatch.setattr(track_ops, "split_track", _fake_split)
    gid = db.create_group("Band")
    sid = db.create_session("jam.m4a", gid, date="2026-01-01")
    db.update_song_details(db._get_or_create_song("Harbor Song", gid), sheet=HARBOR, notes="")
    db.update_song_details(db._get_or_create_song("Orchard Song", gid), sheet=ORCHARD, notes="")
    db.create_track(sid, 1, 100.0, 500.0, "tracks/both.m4a")
    two_songs = _sing(HARBOR_LINES, 5, 195) + _sing(ORCHARD_LINES, 210, 395)
    return gid, sid, FakeTimedTranscriber({"both.m4a": (two_songs, _levels(400, [(200, 205)]))})


def test_run_splits_a_detected_recording_by_song_and_tags_both(client, monkeypatch):  # noqa: F811
    db = api._db
    _, sid, fake = _recording(db, monkeypatch)
    db.set_split_state(sid, "auto")

    summary = identify.run(db, transcriber=fake, max_minutes=5)
    assert (summary["splits"], summary["merges"], summary["tagged"]) == (1, 0, 2)
    tracks = db.get_tracks_for_session(sid)
    assert [t.song_name for t in tracks] == ["Harbor Song", "Orchard Song"]
    assert tracks[0].start_sec == 100.0 and tracks[1].end_sec == 500.0
    assert 300 <= tracks[0].end_sec == tracks[1].start_sec <= 304
    assert db.get_session(sid).split_state == "refined"

    # The new tracks got their transcripts from the old one: nothing is transcribed
    # again, and a recording is only refined once
    again = identify.run(db, transcriber=fake, max_minutes=5)
    assert (again["transcribed"], again["splits"], again["tagged"]) == (0, 0, 0)
    assert fake.calls == ["both.m4a"]


def test_run_leaves_recordings_cut_or_tagged_by_hand_alone(client, monkeypatch):  # noqa: F811
    db = api._db
    gid, sid, fake = _recording(db, monkeypatch)

    # Not split by detection (or split before this existed): never refined
    assert identify.run(db, transcriber=fake, max_minutes=5)["splits"] == 0
    assert len(db.get_tracks_for_session(sid)) == 1

    # Detected, but a person has tagged a track since
    db.set_split_state(sid, "auto")
    (track,) = db.get_tracks_for_session(sid)
    db.untag_track(track.id)
    db.tag_track(track.id, "Some Other Song", gid)
    assert identify.run(db, transcriber=fake, max_minutes=5)["splits"] == 0
    assert len(db.get_tracks_for_session(sid)) == 1


def test_editing_tracks_by_hand_stops_refinement(client, monkeypatch):  # noqa: F811
    db = api._db
    _, sid, _ = _recording(db, monkeypatch)
    db.set_split_state(sid, "auto")
    (track,) = db.get_tracks_for_session(sid)
    monkeypatch.setattr(track_ops, "trim_track", lambda db, track_id, **kw: db.get_track(track_id))
    r = client.put(
        f"/api/tracks/{track.id}/trim", json={"start_delta": 1, "end_delta": 0}, headers=H
    )
    assert r.status_code == 200
    assert db.get_session(sid).split_state == ""


def _fake_merge(db, first_id, second_id):
    """track_ops.merge_tracks without the audio work."""
    a, b = db.get_track(first_id), db.get_track(second_id)
    db.delete_track(a.id)
    db.delete_track(b.id)
    db.create_track(a.session_id, a.track_number, a.start_sec, b.end_sec, "tracks/merged.m4a")


def test_run_joins_a_take_cut_in_two_and_tags_it(client, monkeypatch):  # noqa: F811
    db = api._db
    monkeypatch.setattr(track_ops, "merge_tracks", _fake_merge)
    gid = db.create_group("Band")
    sid = db.create_session("jam.m4a", gid, date="2026-01-01")
    river = db._get_or_create_song("River Song", gid)
    db.update_song_details(river, sheet="\n".join(RIVER_LINES), notes="")
    db.create_track(sid, 1, 0.0, 150.0, "tracks/one.m4a")
    db.create_track(sid, 2, 156.0, 300.0, "tracks/two.m4a")
    db.set_split_state(sid, "auto")
    fake = FakeTimedTranscriber(
        {
            "one.m4a": (_sing(RIVER_LINES[:4], 5, 145), _levels(150)),
            "two.m4a": (_sing(RIVER_LINES[4:], 5, 140), _levels(144)),
        }
    )

    summary = identify.run(db, transcriber=fake, max_minutes=5)
    assert (summary["splits"], summary["merges"], summary["tagged"]) == (0, 1, 1)
    (track,) = db.get_tracks_for_session(sid)
    assert (track.start_sec, track.end_sec, track.song_name) == (0.0, 300.0, "River Song")
    assert identify.run(db, transcriber=fake, max_minutes=5)["transcribed"] == 0
