"""Automatic song tagging of untagged tracks: matching, the nightly run, and the API."""

from jam_session_processor import api, identify, song_match
from jam_session_processor.auth import hash_password
from tests.test_api import client  # noqa: F401

H = {"x-api-key": "test-api-key"}

# Invented lyrics, long enough to count as a chart with lyrics
HARBOR = " ".join(
    f"{a} lanterns drift across the {b} harbor while the ferryman hums a tune"
    for a, b in [("copper", "sleeping"), ("paper", "frozen"), ("silver", "busy"), ("amber", "old")]
)
ORCHARD = " ".join(
    f"{a} apples tumble through the {b} orchard and grandma counts the crows"
    for a, b in [("crimson", "windy"), ("golden", "muddy"), ("bitter", "quiet"), ("tiny", "empty")]
)
GARAGE = (
    "seven broken amplifiers buzzing in the cellar and nobody remembers the bridge again"
    " so we circle round the chorus till the neighbors bang the wall"
)
CHATTER = "okay one two three four that was too fast let us try it again from the top everybody"


class FakeTranscriber:
    model = "fake"

    def __init__(self, texts):
        self.texts = texts
        self.calls = []

    def transcribe(self, path):
        self.calls.append(str(path))
        return self.texts[path.name]


def _band(db, name="Band"):
    gid = db.create_group(name)
    sid = db.create_session("jam.m4a", gid, date="2026-01-01")
    return gid, sid


def _track(db, session_id, n, song=None, group_id=None):
    tid = db.create_track(session_id, n, 0.0, 100.0, f"tracks/{session_id}/{n}.m4a")
    if song:
        db.tag_track(tid, song, group_id)
    return tid


def test_extract_lyrics_skips_chords_headings_and_tab():
    sheet = "[Verse 1]\nC  G  Am  F\nCopper lanterns drift\ne|--3--0--|\nAm   F/C\nacross the bay"
    assert song_match.extract_lyrics(sheet) == "copper lanterns drift across the bay"


def test_clean_transcript_collapses_loops():
    looped = ", ".join(["I'm alone"] * 30)
    text = song_match.clean_transcript([("Real line here", 1.2), (looped, 9.0)] + [("oh", 1.0)] * 5)
    assert text == "real line here i'm alone oh oh"


def _songs(db, session_id):
    return {t.id: t.song_name for t in db.get_tracks_for_session(session_id)}


def test_run_tags_from_lyrics_and_from_tagged_takes(client, tmp_path):  # noqa: F811
    db = api._db
    gid, sid = _band(db)
    db.update_song_details(db._get_or_create_song("Harbor Song", gid), sheet=HARBOR, notes="")
    db.update_song_details(db._get_or_create_song("Orchard Song", gid), sheet=ORCHARD, notes="")
    reference = _track(db, sid, 1, song="Garage Original", group_id=gid)
    cover = _track(db, sid, 2)
    original = _track(db, sid, 3)
    noise = _track(db, sid, 4)
    silent = _track(db, sid, 5)
    garbled = (
        "copper lanterns drift across the sleeping harbor oh yeah"
        " the ferryman hums a tune la la paper lanterns"
    )
    fake = FakeTranscriber(
        {
            "1.m4a": GARAGE + " hey hey",
            "2.m4a": garbled,
            "3.m4a": "uh " + GARAGE,
            "4.m4a": CHATTER,
            "5.m4a": "",
        }
    )

    summary = identify.run(db, transcriber=fake, max_minutes=5)
    assert summary["transcribed"] == 5 and summary["remaining"] == 0 and summary["tagged"] == 2
    assert _songs(db, sid) == {
        reference: "Garage Original",
        cover: "Harbor Song",
        original: "Garage Original",
        noise: None,  # chatter and silence stay untagged
        silent: None,
    }

    # A second run transcribes nothing new and changes nothing
    assert identify.run(db, transcriber=fake, max_minutes=5)["tagged"] == 0
    assert len(fake.calls) == 5

    # The API marks which tags were automatic
    tracks = {t["id"]: t for t in client.get(f"/api/sessions/{sid}/tracks", headers=H).json()}
    assert tracks[cover]["auto_tagged"] is True and tracks[original]["auto_tagged"] is True
    assert tracks[reference]["auto_tagged"] is False and tracks[noise]["auto_tagged"] is False
    # ...until a person changes the tag
    client.post(f"/api/tracks/{cover}/tag", json={"song_name": "Orchard Song"}, headers=H)
    tracks = {t["id"]: t for t in client.get(f"/api/sessions/{sid}/tracks", headers=H).json()}
    assert tracks[cover]["auto_tagged"] is False


def test_removed_auto_tag_is_not_put_back(client):  # noqa: F811
    db = api._db
    gid, sid = _band(db)
    db.update_song_details(db._get_or_create_song("Harbor Song", gid), sheet=HARBOR, notes="")
    tid = _track(db, sid, 1)
    fake = FakeTranscriber({"1.m4a": HARBOR})
    identify.run(db, transcriber=fake)
    assert _songs(db, sid)[tid] == "Harbor Song"

    client.delete(f"/api/tracks/{tid}/tag", headers=H)
    assert identify.run(db, transcriber=fake)["tagged"] == 0
    assert _songs(db, sid)[tid] is None


def test_auto_tagged_takes_are_not_references(client):  # noqa: F811
    db = api._db
    gid, sid = _band(db)
    db.update_song_details(db._get_or_create_song("Harbor Song", gid), sheet=HARBOR, notes="")
    first = _track(db, sid, 1)
    fake = FakeTranscriber({"1.m4a": HARBOR + " " + GARAGE, "2.m4a": "uh " + GARAGE})
    identify.run(db, transcriber=fake)
    assert _songs(db, sid)[first] == "Harbor Song"  # tagged automatically, from the lyrics
    # A later take that only resembles that auto-tagged take is left alone
    second = _track(db, sid, 2)
    identify.run(db, transcriber=fake)
    assert _songs(db, sid)[second] is None


def test_manual_tags_are_never_changed(client):  # noqa: F811
    db = api._db
    gid, sid = _band(db)
    db.update_song_details(db._get_or_create_song("Harbor Song", gid), sheet=HARBOR, notes="")
    tid = _track(db, sid, 1, song="Something Else", group_id=gid)
    identify.run(db, transcriber=FakeTranscriber({"1.m4a": HARBOR}))
    assert _songs(db, sid)[tid] == "Something Else"


def test_only_the_tracks_band_is_considered(client):  # noqa: F811
    db = api._db
    gid, sid = _band(db)
    other, _ = _band(db, "Other Band")
    db.update_song_details(db._get_or_create_song("Harbor Song", other), sheet=HARBOR, notes="")
    tid = _track(db, sid, 1)
    identify.run(db, transcriber=FakeTranscriber({"1.m4a": HARBOR}))
    assert _songs(db, sid)[tid] is None


def test_changed_audio_is_transcribed_again(client):  # noqa: F811
    db = api._db
    _, sid = _band(db)
    tid = _track(db, sid, 1)
    fake = FakeTranscriber({"1.m4a": CHATTER, "1b.m4a": CHATTER})
    identify.run(db, transcriber=fake)
    assert db.tracks_needing_transcript() == []
    db.update_track(tid, audio_path=f"tracks/{sid}/1b.m4a")  # e.g. after a trim
    assert [r["id"] for r in db.tracks_needing_transcript()] == [tid]
    assert db.get_transcripts() == []  # the stale transcript isn't used
    identify.run(db, transcriber=fake)
    assert len(fake.calls) == 2


def test_failed_track_does_not_stop_the_run(client):  # noqa: F811
    db = api._db
    _, sid = _band(db)
    _track(db, sid, 1)
    _track(db, sid, 2)
    summary = identify.run(db, transcriber=FakeTranscriber({"2.m4a": CHATTER}))
    assert summary["transcribed"] == 1 and summary["failed"] == 1


def test_run_without_speech_to_text_only_rematches(client, monkeypatch):  # noqa: F811
    db = api._db
    _, sid = _band(db)
    _track(db, sid, 1)
    monkeypatch.setattr("jam_session_processor.transcribe.is_available", lambda: False)
    summary = identify.run(db)
    assert summary["skipped"] and summary["transcribed"] == 0


def test_run_skips_transcribing_when_memory_is_short(client, monkeypatch):  # noqa: F811
    db = api._db
    monkeypatch.setattr("jam_session_processor.transcribe.is_available", lambda: True)
    monkeypatch.setattr(identify, "available_memory_mb", lambda: 100)
    assert "memory" in identify.run(db)["skipped"]
    monkeypatch.setattr(identify, "available_memory_mb", lambda: 4000)
    gid = db.create_group("Busy")
    db.create_job("j1", gid)
    db.update_job_progress("j1", "splitting")
    assert "processed" in identify.run(db)["skipped"]


def test_admin_endpoints_need_superadmin(client):  # noqa: F811
    db = api._db
    gid, sid = _band(db)
    _track(db, sid, 1)
    uid = db.create_user("r@x.com", hash_password("password"), name="R", role="readonly")
    db.assign_user_to_group(uid, gid)
    client.post("/api/auth/login", json={"email": "r@x.com", "password": "password"})
    assert client.get("/api/admin/song-identification").status_code == 403
    assert client.post("/api/admin/song-identification/run").status_code == 403


def test_admin_status_and_run(client, monkeypatch):  # noqa: F811
    db = api._db
    _, sid = _band(db)
    _track(db, sid, 1)
    monkeypatch.setattr("jam_session_processor.transcribe.is_available", lambda: False)
    status = client.get("/api/admin/song-identification", headers=H).json()
    assert status["available"] is False and status["running"] is False
    assert status["tracks"] == 1 and status["pending_transcripts"] == 1
    assert status["nightly_hour_utc"] == 8
    assert client.post("/api/admin/song-identification/run", headers=H).status_code == 503

    started = []

    async def fake_start():
        started.append(1)
        return len(started) == 1

    monkeypatch.setattr("jam_session_processor.transcribe.is_available", lambda: True)
    monkeypatch.setattr(api, "_start_identify_run", fake_start)
    assert client.post("/api/admin/song-identification/run", headers=H).status_code == 202
    assert client.post("/api/admin/song-identification/run", headers=H).status_code == 409


def test_nightly_hour_setting(monkeypatch):
    from datetime import datetime, timezone

    monkeypatch.setenv("JAM_IDENTIFY_HOUR", "off")
    assert api._identify_hour() is None
    monkeypatch.setenv("JAM_IDENTIFY_HOUR", "3")
    assert api._identify_hour() == 3
    now = datetime(2026, 1, 1, 2, 30, tzinfo=timezone.utc)
    assert api._seconds_until_hour(3, now) == 1800
    assert api._seconds_until_hour(2, now) == 23.5 * 3600


def test_cli_match_only(client, monkeypatch):  # noqa: F811
    from click.testing import CliRunner

    from jam_session_processor import cli

    monkeypatch.setattr(cli, "_get_db", lambda: api._db)
    result = CliRunner().invoke(cli.cli, ["identify-songs", "--match-only"])
    assert result.exit_code == 0 and "tagged: 0" in result.output
