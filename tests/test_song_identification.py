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
    assert "memory" in identify.run(db, wait_minutes=0)["skipped"]
    monkeypatch.setattr(identify, "available_memory_mb", lambda: 4000)
    gid = db.create_group("Busy")
    db.create_job("j1", gid)
    db.update_job_progress("j1", "splitting")
    assert "processed" in identify.run(db, wait_minutes=0)["skipped"]


def test_run_waits_for_other_processing_to_finish(client, monkeypatch):  # noqa: F811
    # Recordings re-detected together: the first one's run starts while the others are
    # still being split. It waits for them instead of giving up.
    db = api._db
    monkeypatch.setattr(identify, "available_memory_mb", lambda: 4000)
    gid = db.create_group("Busy")
    db.create_job("j1", gid)
    db.update_job_progress("j1", "splitting")
    waits = []

    def sleep(seconds):
        waits.append(seconds)
        if len(waits) == 3:
            db.complete_job("j1", None)

    monkeypatch.setattr(identify.time, "sleep", sleep)
    assert identify._wait_until_free(db, wait_minutes=30) == ""
    assert len(waits) == 3


def test_interrupted_tagging_is_found_again_after_a_restart(client):  # noqa: F811
    db = api._db
    _, sid = _band(db)
    done, pending = _track(db, sid, 1), _track(db, sid, 2)
    db.save_transcript(done, db.get_track(done).audio_path, "fake", "words")
    assert db.sessions_awaiting_tagging() == []  # not a detected split: left alone
    db.set_split_state(sid, "auto")
    assert db.sessions_awaiting_tagging() == [sid]
    db.save_transcript(pending, db.get_track(pending).audio_path, "fake", "words")
    assert db.sessions_awaiting_tagging() == []


def test_recording_reports_tagging_in_progress(client, monkeypatch):  # noqa: F811
    db = api._db
    _, sid = _band(db)
    done = _track(db, sid, 1)
    _track(db, sid, 2)
    db.save_transcript(done, db.get_track(done).audio_path, "fake", "words")
    get = lambda: client.get(f"/api/sessions/{sid}", headers=H).json()["tagging"]  # noqa: E731
    assert get() is None

    monkeypatch.setattr(api, "_identify_pending", [sid])
    assert get() == {"state": "queued", "transcribed": 1, "total": 2}
    monkeypatch.setattr(api, "_identify_pending", [])
    monkeypatch.setattr(api, "_identify_running", lambda: True)
    monkeypatch.setattr(api, "_identify_current", sid)
    assert get() == {"state": "running", "transcribed": 1, "total": 2}
    # A run for another recording says nothing about this one
    monkeypatch.setattr(api, "_identify_current", sid + 1)
    assert get() is None
    # The nightly run (no recording) covers it while it has tracks left to transcribe
    monkeypatch.setattr(api, "_identify_current", None)
    assert get()["state"] == "running"


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

    monkeypatch.setattr("jam_session_processor.transcribe.is_available", lambda: True)
    launched = _fake_launcher(monkeypatch)
    assert client.post("/api/admin/song-identification/run", headers=H).status_code == 202
    assert client.post("/api/admin/song-identification/run", headers=H).status_code == 409
    assert launched == [None]
    assert client.get("/api/admin/song-identification", headers=H).json()["running"] is True


class _FakeProc:
    def __init__(self):
        self.done = False

    def poll(self):
        return 0 if self.done else None

    def terminate(self):
        self.done = True


def _fake_launcher(monkeypatch):
    """Replace the child process with a fake that runs until told to finish."""
    launched = []

    def launch(session_id):
        launched.append(session_id)
        api._identify_proc = _FakeProc()
        api._identify_current = session_id

    monkeypatch.setattr(api, "_launch_identify", launch)
    monkeypatch.setattr(api, "_identify_proc", None)
    monkeypatch.setattr(api, "_identify_current", None)
    monkeypatch.setattr(api, "_identify_pending", [])
    return launched


def test_runs_queue_one_at_a_time(monkeypatch):
    launched = _fake_launcher(monkeypatch)
    assert api._request_identify(7) is True  # starts
    assert api._request_identify(7) is False  # already running
    assert api._request_identify(8) is True  # queued behind it
    assert api._request_identify(8) is False  # already queued
    assert api._request_identify(None) is True  # the nightly run queues too
    assert launched == [7] and api._identify_pending == [8, None]

    class Done:
        def wait(self):
            api._identify_proc.done = True

    proc = api._identify_proc
    proc.wait = Done().wait
    api._after_identify(proc)  # the run ends: the next one starts
    assert launched == [7, 8] and api._identify_pending == [None]


def test_upload_starts_tagging_for_that_recording(client, monkeypatch):  # noqa: F811
    launched = _fake_launcher(monkeypatch)
    monkeypatch.setattr("jam_session_processor.transcribe.is_available", lambda: False)
    api._tag_after_processing(5)
    assert launched == []  # speech-to-text not installed: nothing to start
    monkeypatch.setattr("jam_session_processor.transcribe.is_available", lambda: True)
    monkeypatch.setenv("JAM_IDENTIFY_HOUR", "off")
    api._tag_after_processing(5)
    assert launched == []  # automatic runs turned off
    monkeypatch.delenv("JAM_IDENTIFY_HOUR")
    api._tag_after_processing(5)
    assert launched == [5]


def test_run_for_one_recording_only_transcribes_its_tracks(client):  # noqa: F811
    db = api._db
    gid, sid = _band(db)
    other = db.create_session("other.m4a", gid, date="2026-02-02")
    _track(db, sid, 1)
    _track(db, other, 1)
    fake = FakeTranscriber({"1.m4a": CHATTER})
    summary = identify.run(db, transcriber=fake, session_id=sid)
    assert summary["transcribed"] == 1 and fake.calls == [f"{db.db_path.parent}/tracks/{sid}/1.m4a"]
    assert len(db.tracks_needing_transcript()) == 1


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


def test_admin_run_one_recording(client, monkeypatch):  # noqa: F811
    db = api._db
    _, sid = _band(db)
    _track(db, sid, 1)
    monkeypatch.setattr("jam_session_processor.transcribe.is_available", lambda: True)
    launched = _fake_launcher(monkeypatch)
    url = "/api/admin/song-identification/run"
    assert client.post(f"{url}?session_id=99999", headers=H).status_code == 404
    assert client.post(f"{url}?session_id={sid}", headers=H).status_code == 202
    assert client.post(f"{url}?session_id={sid}", headers=H).status_code == 409
    # A full run queues behind it
    assert client.post(url, headers=H).status_code == 202
    assert launched == [sid] and api._identify_pending == [None]


def test_runs_are_logged_for_the_admin_activity_page(client, tmp_path):  # noqa: F811
    db = api._db
    gid, sid = _band(db)
    song = db._get_or_create_song("Harbor Song", gid)
    db.update_song_details(song, sheet=HARBOR, notes="")
    # A tag from before runs were logged shows up as a backfilled entry
    old = _track(db, sid, 1)
    db.auto_tag_track(old, song, 0.5, "lyrics")
    db.conn.execute("UPDATE track_auto_tags SET created_at = '2026-01-02 08:00:00'")
    db.create_job("job1", gid, session_id=sid)
    db.update_job_progress("job1", "Exporting", {"segments": [[0, 100], [120, 300]]})
    db.complete_job("job1", sid)
    db.conn.commit()
    _track(db, sid, 2)

    identify.run(db, transcriber=FakeTranscriber({"1.m4a": "", "2.m4a": HARBOR}))
    identify.run(db, transcriber=FakeTranscriber({}))  # nothing new
    db.start_tagging_run()  # killed before it finished

    h = {"x-api-key": "test-api-key"}
    body = client.get("/api/admin/background-activity", headers=h).json()
    assert body["tagging"]["running"] is False
    runs = [e for e in body["entries"] if e["kind"] == "tagging"]
    assert [r["status"] for r in runs] == ["interrupted", "completed", "completed", "completed"]
    assert runs[1]["tagged"] == 0 and runs[1]["items"] == []
    assert runs[2]["transcribed"] == 2 and runs[2]["tagged"] == 1
    assert runs[2]["items"] == [
        {
            "action": "tagged",
            "session_id": sid,
            "session_name": db.get_session(sid).name,
            "track_number": 2,
            "song_id": song,
            "song_name": "Harbor Song",
            "score": runs[2]["items"][0]["score"],
            "source": "lyrics",
        }
    ]
    assert runs[3]["backfilled"] and runs[3]["items"][0]["kept"] is True
    (job,) = [e for e in body["entries"] if e["kind"] == "processing"]
    assert job["status"] == "completed" and job["tracks"] == 2 and job["session_id"] == sid

    client.cookies.clear()
    assert client.get("/api/admin/background-activity").status_code in (401, 403)
