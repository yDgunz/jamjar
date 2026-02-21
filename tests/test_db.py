import pytest

from jam_session_processor.db import Database


@pytest.fixture
def db(tmp_path):
    database = Database(tmp_path / "test.db")
    yield database
    database.close()


@pytest.fixture
def group_id(db):
    """Create a default group and return its id."""
    return db.create_group("TestBand")


# --- User tests ---


def test_create_and_get_user(db):
    uid = db.create_user("alice@example.com", "hash123", name="Alice")
    user = db.get_user(uid)
    assert user.email == "alice@example.com"
    assert user.name == "Alice"
    assert user.password_hash == "hash123"


def test_get_user_by_email(db):
    db.create_user("alice@example.com", "hash123")
    user = db.get_user_by_email("alice@example.com")
    assert user is not None
    assert user.email == "alice@example.com"
    assert db.get_user_by_email("nobody@example.com") is None


def test_list_users(db):
    db.create_user("bob@example.com", "hash1")
    db.create_user("alice@example.com", "hash2")
    users = db.list_users()
    assert len(users) == 2
    assert users[0].email == "alice@example.com"  # Sorted by email


def test_update_user_password(db):
    uid = db.create_user("alice@example.com", "old_hash")
    db.update_user_password(uid, "new_hash")
    user = db.get_user(uid)
    assert user.password_hash == "new_hash"


def test_duplicate_email_fails(db):
    db.create_user("alice@example.com", "hash1")
    with pytest.raises(Exception):
        db.create_user("alice@example.com", "hash2")


# --- Group tests ---


def test_create_and_get_group(db):
    gid = db.create_group("5Biz")
    group = db.get_group(gid)
    assert group.name == "5Biz"


def test_get_group_by_name(db):
    db.create_group("5Biz")
    group = db.get_group_by_name("5Biz")
    assert group is not None
    assert group.name == "5Biz"
    assert db.get_group_by_name("NonExistent") is None


def test_list_groups(db):
    db.create_group("Zband")
    db.create_group("Aband")
    groups = db.list_groups()
    assert len(groups) == 2
    assert groups[0].name == "Aband"  # Sorted by name


def test_duplicate_group_fails(db):
    db.create_group("5Biz")
    with pytest.raises(Exception):
        db.create_group("5Biz")


# --- Membership tests ---


def test_assign_and_get_user_groups(db):
    uid = db.create_user("alice@example.com", "hash")
    gid1 = db.create_group("Band1")
    gid2 = db.create_group("Band2")

    db.assign_user_to_group(uid, gid1)
    db.assign_user_to_group(uid, gid2)

    groups = db.get_user_groups(uid)
    assert len(groups) == 2
    group_names = {g.name for g in groups}
    assert group_names == {"Band1", "Band2"}


def test_get_group_ids_for_user(db):
    uid = db.create_user("alice@example.com", "hash")
    gid = db.create_group("Band1")
    db.assign_user_to_group(uid, gid)

    ids = db.get_group_ids_for_user(uid)
    assert ids == [gid]


def test_remove_user_from_group(db):
    uid = db.create_user("alice@example.com", "hash")
    gid = db.create_group("Band1")
    db.assign_user_to_group(uid, gid)
    db.remove_user_from_group(uid, gid)

    assert db.get_user_groups(uid) == []


def test_assign_idempotent(db):
    uid = db.create_user("alice@example.com", "hash")
    gid = db.create_group("Band1")
    db.assign_user_to_group(uid, gid)
    db.assign_user_to_group(uid, gid)  # Should not raise

    assert len(db.get_user_groups(uid)) == 1


# --- Session tests (with group_id) ---


def test_create_and_list_sessions(db, group_id):
    db.create_session("session1.m4a", group_id, date="2026-02-03")
    db.create_session("session2.m4a", group_id, date="2026-02-10")
    sessions = db.list_sessions(group_ids=[group_id])
    assert len(sessions) == 2
    assert sessions[0].date == "2026-02-10"  # Most recent first
    assert sessions[1].date == "2026-02-03"
    assert sessions[0].name == "session2"
    assert sessions[1].name == "session1"


def test_get_session(db, group_id):
    sid = db.create_session("session1.m4a", group_id, date="2026-02-03", notes="Good session")
    session = db.get_session(sid)
    assert session.source_file == "session1.m4a"
    assert session.notes == "Good session"
    assert session.track_count == 0
    assert session.group_id == group_id


def test_find_session_by_source(db, group_id):
    db.create_session("session1.m4a", group_id, date="2026-02-03")
    found = db.find_session_by_source("session1.m4a", group_id)
    assert found is not None
    assert found.source_file == "session1.m4a"
    assert db.find_session_by_source("nonexistent.m4a", group_id) is None


def test_list_sessions_group_scoped(db):
    gid1 = db.create_group("Band1")
    gid2 = db.create_group("Band2")
    db.create_session("s1.m4a", gid1, date="2026-02-01")
    db.create_session("s2.m4a", gid2, date="2026-02-02")

    assert len(db.list_sessions(group_ids=[gid1])) == 1
    assert len(db.list_sessions(group_ids=[gid2])) == 1
    assert len(db.list_sessions(group_ids=[gid1, gid2])) == 2
    assert len(db.list_sessions(group_ids=[])) == 0


def test_create_tracks_and_count(db, group_id):
    sid = db.create_session("session1.m4a", group_id, date="2026-02-03")
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


def test_tag_track(db, group_id):
    sid = db.create_session("session1.m4a", group_id)
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")

    song_id = db.tag_track(tid, "Fat Cat", group_id)
    tracks = db.get_tracks_for_session(sid)
    assert tracks[0].song_name == "Fat Cat"
    assert tracks[0].song_id == song_id

    session = db.get_session(sid)
    assert session.tagged_count == 1


def test_tag_track_reuses_existing_song(db, group_id):
    sid = db.create_session("session1.m4a", group_id)
    tid1 = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t1.wav")
    tid2 = db.create_track(sid, track_number=2, start_sec=300.0, end_sec=600.0, audio_path="t2.wav")

    song_id1 = db.tag_track(tid1, "Fat Cat", group_id)
    song_id2 = db.tag_track(tid2, "Fat Cat", group_id)
    assert song_id1 == song_id2

    songs = db.list_songs(group_ids=[group_id])
    assert len(songs) == 1
    assert songs[0].take_count == 2


def test_same_song_name_different_groups(db):
    gid1 = db.create_group("Band1")
    gid2 = db.create_group("Band2")

    sid1 = db.create_session("s1.m4a", gid1)
    sid2 = db.create_session("s2.m4a", gid2)
    tid1 = db.create_track(sid1, 1, 0, 300, "t1.wav")
    tid2 = db.create_track(sid2, 1, 0, 300, "t2.wav")

    song_id1 = db.tag_track(tid1, "Fat Cat", gid1)
    song_id2 = db.tag_track(tid2, "Fat Cat", gid2)
    assert song_id1 != song_id2  # Different songs in different groups


def test_untag_track(db, group_id):
    sid = db.create_session("session1.m4a", group_id)
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")
    db.tag_track(tid, "Fat Cat", group_id)
    db.untag_track(tid)

    tracks = db.get_tracks_for_session(sid)
    assert tracks[0].song_name is None
    assert tracks[0].song_id is None


def test_list_songs(db, group_id):
    sid = db.create_session("session1.m4a", group_id)
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")
    db.tag_track(tid, "Fat Cat", group_id)
    db.tag_track(db.create_track(sid, 2, 300, 600, "t2.wav"), "Spit Me Out", group_id)

    songs = db.list_songs(group_ids=[group_id])
    assert len(songs) == 2
    assert songs[0].name == "Fat Cat"
    assert songs[1].name == "Spit Me Out"


def test_list_songs_group_scoped(db):
    gid1 = db.create_group("Band1")
    gid2 = db.create_group("Band2")

    sid1 = db.create_session("s1.m4a", gid1)
    sid2 = db.create_session("s2.m4a", gid2)
    db.tag_track(db.create_track(sid1, 1, 0, 300, "t1.wav"), "Song A", gid1)
    db.tag_track(db.create_track(sid2, 1, 0, 300, "t2.wav"), "Song B", gid2)

    assert len(db.list_songs(group_ids=[gid1])) == 1
    assert len(db.list_songs(group_ids=[gid2])) == 1
    assert len(db.list_songs(group_ids=[gid1, gid2])) == 2


def test_reset(db, group_id):
    sid = db.create_session("session1.m4a", group_id)
    db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")
    db.reset()

    assert db.list_sessions() == []
    # Can still create after reset
    gid = db.create_group("NewBand")
    db.create_session("session2.m4a", gid)
    assert len(db.list_sessions()) == 1


def test_track_notes(db, group_id):
    sid = db.create_session("session1.m4a", group_id)
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")
    db.update_track_notes(tid, "Great take")

    tracks = db.get_tracks_for_session(sid)
    assert tracks[0].notes == "Great take"


def test_clean_session_name(db):
    from jam_session_processor.db import clean_session_name

    assert clean_session_name("5Biz 2-3-26.m4a") == "5Biz"
    result = clean_session_name("5biz Good band jams 11-11-25 - good jams at 9_30.m4a")
    assert result == "5biz Good band jams - good jams at 9_30"
    result = clean_session_name("John-Andy-Eric 10-3-23 - 2 new tunes.m4a")
    assert result == "John-Andy-Eric - 2 new tunes"
    assert clean_session_name("Kingstoners 10-11-24.m4a") == "Kingstoners"


def test_session_name_auto_generated(db, group_id):
    sid = db.create_session("5Biz 2-3-26.m4a", group_id, date="2026-02-03")
    session = db.get_session(sid)
    assert session.name == "5Biz"


def test_update_session_name(db, group_id):
    sid = db.create_session("session1.m4a", group_id)
    db.update_session_name(sid, "My Custom Name")
    session = db.get_session(sid)
    assert session.name == "My Custom Name"


def test_get_track(db, group_id):
    sid = db.create_session("session1.m4a", group_id)
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")
    db.tag_track(tid, "Fat Cat", group_id)

    track = db.get_track(tid)
    assert track is not None
    assert track.id == tid
    assert track.song_name == "Fat Cat"
    assert track.start_sec == 0.0
    assert track.end_sec == 300.0

    assert db.get_track(9999) is None


def test_delete_track(db, group_id):
    sid = db.create_session("session1.m4a", group_id)
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")
    db.delete_track(tid)

    assert db.get_track(tid) is None
    assert db.get_tracks_for_session(sid) == []


def test_update_track(db, group_id):
    sid = db.create_session("session1.m4a", group_id)
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")

    db.update_track(tid, track_number=5, audio_path="new.wav")
    track = db.get_track(tid)
    assert track.track_number == 5
    assert track.audio_path == "new.wav"
    # Original values unchanged
    assert track.start_sec == 0.0


def test_update_song_details(db, group_id):
    sid = db.create_session("session1.m4a", group_id)
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")
    db.tag_track(tid, "Fat Cat", group_id)

    songs = db.list_songs(group_ids=[group_id])
    song_id = songs[0].id

    db.update_song_details(
        song_id, chart="Intro: Am | G\nVerse: C | G", lyrics="Some lyrics", notes="Play it slow"
    )

    song = db.get_song(song_id)
    assert song.chart == "Intro: Am | G\nVerse: C | G"
    assert song.lyrics == "Some lyrics"
    assert song.notes == "Play it slow"
    assert song.name == "Fat Cat"
    assert song.take_count == 1


def test_get_song(db, group_id):
    sid = db.create_session("session1.m4a", group_id)
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")
    db.tag_track(tid, "Fat Cat", group_id)

    songs = db.list_songs(group_ids=[group_id])
    song = db.get_song(songs[0].id)
    assert song is not None
    assert song.name == "Fat Cat"
    assert song.chart == ""
    assert song.take_count == 1
    assert song.group_id == group_id

    assert db.get_song(9999) is None


def test_list_songs_includes_metadata(db, group_id):
    sid = db.create_session("session1.m4a", group_id)
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")
    db.tag_track(tid, "Fat Cat", group_id)

    songs = db.list_songs(group_ids=[group_id])
    song_id = songs[0].id
    db.update_song_details(song_id, chart="Am G", lyrics="", notes="")

    songs = db.list_songs(group_ids=[group_id])
    assert songs[0].chart == "Am G"


def test_delete_song(db, group_id):
    sid = db.create_session("session1.m4a", group_id)
    tid = db.create_track(sid, track_number=1, start_sec=0.0, end_sec=300.0, audio_path="t.wav")
    db.tag_track(tid, "Fat Cat", group_id)

    songs = db.list_songs(group_ids=[group_id])
    assert len(songs) == 1

    db.delete_song(songs[0].id)
    assert db.list_songs(group_ids=[group_id]) == []

    # Track should be untagged (ON DELETE SET NULL)
    track = db.get_track(tid)
    assert track.song_id is None
    assert track.song_name is None


def test_create_user_default_role(db):
    uid = db.create_user("alice@example.com", "hash123", name="Alice")
    user = db.get_user(uid)
    assert user.role == "editor"


def test_create_user_with_role(db):
    uid = db.create_user("alice@example.com", "hash123", role="admin")
    user = db.get_user(uid)
    assert user.role == "admin"


def test_create_user_invalid_role(db):
    with pytest.raises(ValueError, match="Invalid role"):
        db.create_user("alice@example.com", "hash123", role="wizard")


def test_update_user_role(db):
    uid = db.create_user("alice@example.com", "hash123")
    assert db.get_user(uid).role == "editor"
    db.update_user_role(uid, "superadmin")
    assert db.get_user(uid).role == "superadmin"


def test_update_user_role_invalid(db):
    uid = db.create_user("alice@example.com", "hash123")
    with pytest.raises(ValueError, match="Invalid role"):
        db.update_user_role(uid, "wizard")


def test_rename_song_scoped_to_group(db):
    gid1 = db.create_group("Band1")
    gid2 = db.create_group("Band2")

    sid1 = db.create_session("s1.m4a", gid1)
    sid2 = db.create_session("s2.m4a", gid2)
    tid1 = db.create_track(sid1, 1, 0, 300, "t1.wav")
    tid2 = db.create_track(sid2, 1, 0, 300, "t2.wav")

    db.tag_track(tid1, "Song A", gid1)
    db.tag_track(tid2, "Song A", gid2)  # Same name, different group — OK

    songs_g1 = db.list_songs(group_ids=[gid1])
    songs_g2 = db.list_songs(group_ids=[gid2])

    # Rename in group1 to "Song B" — should work
    db.rename_song(songs_g1[0].id, "Song B")
    assert db.get_song(songs_g1[0].id).name == "Song B"

    # Group2's "Song A" should be unchanged
    assert db.get_song(songs_g2[0].id).name == "Song A"
