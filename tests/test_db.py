import pytest

from jam_session_processor.db import Database


@pytest.fixture
def db(tmp_path):
    database = Database(tmp_path / "test.db")
    yield database
    database.close()


def test_create_and_list_sessions(db):
    db.create_session("session1.m4a", date="2026-02-03")
    db.create_session("session2.m4a", date="2026-02-10")
    sessions = db.list_sessions()
    assert len(sessions) == 2
    assert sessions[0].date == "2026-02-10"  # Most recent first
    assert sessions[1].date == "2026-02-03"
    assert sessions[0].name == "session2"
    assert sessions[1].name == "session1"


def test_get_session(db):
    sid = db.create_session("session1.m4a", date="2026-02-03", notes="Good session")
    session = db.get_session(sid)
    assert session.source_file == "session1.m4a"
    assert session.notes == "Good session"
    assert session.track_count == 0


def test_find_session_by_source(db):
    db.create_session("session1.m4a", date="2026-02-03")
    found = db.find_session_by_source("session1.m4a")
    assert found is not None
    assert found.source_file == "session1.m4a"
    assert db.find_session_by_source("nonexistent.m4a") is None


def test_create_tracks_and_count(db):
    sid = db.create_session("session1.m4a", date="2026-02-03")
    db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="track1.wav")
    db.create_track(sid, track_number=2, start_sec=320.0, end_sec=600.0, audio_path="track2.wav")

    session = db.get_session(sid)
    assert session.track_count == 2
    assert session.tagged_count == 0

    tracks = db.get_tracks_for_session(sid)
    assert len(tracks) == 2
    assert tracks[0].track_number == 1
    assert tracks[0].duration_sec == 300.0
    assert tracks[1].track_number == 2


def test_tag_track(db):
    sid = db.create_session("session1.m4a")
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")

    song_id = db.tag_track(tid, "Fat Cat")
    tracks = db.get_tracks_for_session(sid)
    assert tracks[0].song_name == "Fat Cat"
    assert tracks[0].song_id == song_id

    session = db.get_session(sid)
    assert session.tagged_count == 1


def test_tag_track_reuses_existing_song(db):
    sid = db.create_session("session1.m4a")
    tid1 = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t1.wav")
    tid2 = db.create_track(sid, track_number=2, start_sec=300.0, end_sec=600.0, audio_path="t2.wav")

    song_id1 = db.tag_track(tid1, "Fat Cat")
    song_id2 = db.tag_track(tid2, "Fat Cat")
    assert song_id1 == song_id2

    songs = db.list_songs()
    assert len(songs) == 1
    assert songs[0].take_count == 2


def test_untag_track(db):
    sid = db.create_session("session1.m4a")
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")
    db.tag_track(tid, "Fat Cat")
    db.untag_track(tid)

    tracks = db.get_tracks_for_session(sid)
    assert tracks[0].song_name is None
    assert tracks[0].song_id is None


def test_list_songs(db):
    sid = db.create_session("session1.m4a")
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")
    db.tag_track(tid, "Fat Cat")
    db.tag_track(db.create_track(sid, 2, 300, 600, "t2.wav"), "Spit Me Out")

    songs = db.list_songs()
    assert len(songs) == 2
    assert songs[0].name == "Fat Cat"
    assert songs[1].name == "Spit Me Out"


def test_reset(db):
    sid = db.create_session("session1.m4a")
    db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")
    db.reset()

    assert db.list_sessions() == []
    # Can still create after reset
    db.create_session("session2.m4a")
    assert len(db.list_sessions()) == 1


def test_track_notes(db):
    sid = db.create_session("session1.m4a")
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")
    db.update_track_notes(tid, "Great take")

    tracks = db.get_tracks_for_session(sid)
    assert tracks[0].notes == "Great take"


def test_clean_session_name(db):
    from jam_session_processor.db import clean_session_name
    assert clean_session_name("5Biz 2-3-26.m4a") == "5Biz"
    assert clean_session_name("5biz Good band jams 11-11-25 - good jams at 9_30.m4a") == "5biz Good band jams - good jams at 9_30"
    assert clean_session_name("John-Andy-Eric 10-3-23 - 2 new tunes.m4a") == "John-Andy-Eric - 2 new tunes"
    assert clean_session_name("Kingstoners 10-11-24.m4a") == "Kingstoners"


def test_session_name_auto_generated(db):
    sid = db.create_session("5Biz 2-3-26.m4a", date="2026-02-03")
    session = db.get_session(sid)
    assert session.name == "5Biz"


def test_update_session_name(db):
    sid = db.create_session("session1.m4a")
    db.update_session_name(sid, "My Custom Name")
    session = db.get_session(sid)
    assert session.name == "My Custom Name"


def test_get_track(db):
    sid = db.create_session("session1.m4a")
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")
    db.tag_track(tid, "Fat Cat")

    track = db.get_track(tid)
    assert track is not None
    assert track.id == tid
    assert track.song_name == "Fat Cat"
    assert track.start_sec == 0.0
    assert track.end_sec == 300.0

    assert db.get_track(9999) is None


def test_delete_track(db):
    sid = db.create_session("session1.m4a")
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")
    db.delete_track(tid)

    assert db.get_track(tid) is None
    assert db.get_tracks_for_session(sid) == []


def test_update_track(db):
    sid = db.create_session("session1.m4a")
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")

    db.update_track(tid, track_number=5, audio_path="new.wav", fingerprint="abc123")
    track = db.get_track(tid)
    assert track.track_number == 5
    assert track.audio_path == "new.wav"
    assert track.fingerprint == "abc123"
    # Original values unchanged
    assert track.start_sec == 0.0


def test_update_song_details(db):
    sid = db.create_session("session1.m4a")
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")
    db.tag_track(tid, "Fat Cat")

    songs = db.list_songs()
    song_id = songs[0].id

    db.update_song_details(song_id, chart="Intro: Am | G\nVerse: C | G",
                           lyrics="Some lyrics", notes="Play it slow")

    song = db.get_song(song_id)
    assert song.chart == "Intro: Am | G\nVerse: C | G"
    assert song.lyrics == "Some lyrics"
    assert song.notes == "Play it slow"
    assert song.name == "Fat Cat"
    assert song.take_count == 1


def test_get_song(db):
    sid = db.create_session("session1.m4a")
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")
    db.tag_track(tid, "Fat Cat")

    songs = db.list_songs()
    song = db.get_song(songs[0].id)
    assert song is not None
    assert song.name == "Fat Cat"
    assert song.chart == ""
    assert song.take_count == 1

    assert db.get_song(9999) is None


def test_list_songs_includes_metadata(db):
    sid = db.create_session("session1.m4a")
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")
    db.tag_track(tid, "Fat Cat")

    songs = db.list_songs()
    song_id = songs[0].id
    db.update_song_details(song_id, chart="Am G", lyrics="", notes="")

    songs = db.list_songs()
    assert songs[0].chart == "Am G"


def test_delete_song(db):
    sid = db.create_session("session1.m4a")
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")
    db.tag_track(tid, "Fat Cat")

    songs = db.list_songs()
    assert len(songs) == 1

    db.delete_song(songs[0].id)
    assert db.list_songs() == []

    # Track should be untagged (ON DELETE SET NULL)
    track = db.get_track(tid)
    assert track.song_id is None
    assert track.song_name is None
