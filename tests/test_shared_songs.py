"""Songs as a shared catalog: groups link to songs via group_songs."""

from pathlib import Path

import pytest

from jam_session_processor import api
from jam_session_processor.auth import hash_password
from jam_session_processor.db import Database
from tests.test_api import client  # noqa: F401

# --- helpers ---


def _user(db, email, groups, role="admin"):
    uid = db.create_user(email, hash_password("password"), name=email.split("@")[0], role=role)
    for gid in groups:
        db.assign_user_to_group(uid, gid)
    return uid


def _login(c, email):
    resp = c.post("/api/auth/login", json={"email": email, "password": "password"})
    assert resp.status_code == 200


def _track(db, group_id, date="2026-01-01", n=1):
    sid = db.create_session(f"s-{group_id}-{date}.m4a", group_id, date=date)
    for i in range(1, n + 1):
        db.create_track(sid, track_number=i, start_sec=0.0, end_sec=60.0, audio_path="x.m4a")
    return sid, [t.id for t in db.get_tracks_for_session(sid)]


@pytest.fixture
def two_bands(client):  # noqa: F811
    db = api._db
    a = db.create_group("Band A")
    b = db.create_group("Band B")
    _user(db, "both@x.com", [a, b])
    _user(db, "bonly@x.com", [b])
    return client, db, a, b


# --- DB layer ---


def test_backfill_links_existing_songs(tmp_path: Path):
    path = tmp_path / "old.db"
    db = Database(path)
    gid = db.create_group("G")
    db.conn.execute("INSERT INTO songs (name, group_id) VALUES ('Old Song', ?)", (gid,))
    db.conn.execute("DELETE FROM group_songs")
    db.conn.commit()
    db.close()

    db = Database(path)  # migration runs on open
    song = db.list_songs([gid])[0]
    assert song.name == "Old Song"
    assert [g["id"] for g in db.get_song_groups(song.id)] == [gid]
    db.close()


def test_tag_reuses_song_from_callers_other_group(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    a, b = db.create_group("A"), db.create_group("B")
    _, (ta,) = _track(db, a)
    _, (tb,) = _track(db, b)
    sid_a = db.tag_track(ta, "Heroes", a, visible_group_ids=[a, b])
    sid_b = db.tag_track(tb, "heroes", b, visible_group_ids=[a, b])
    assert sid_a == sid_b
    assert {g["id"] for g in db.get_song_groups(sid_a)} == {a, b}


def test_tag_without_visibility_creates_separate_song(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    a, b = db.create_group("A"), db.create_group("B")
    _, (ta,) = _track(db, a)
    _, (tb,) = _track(db, b)
    sid_a = db.tag_track(ta, "Heroes", a, visible_group_ids=[a])
    sid_b = db.tag_track(tb, "Heroes", b, visible_group_ids=[b])
    assert sid_a != sid_b


def test_take_counts_scoped_to_groups(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    a, b = db.create_group("A"), db.create_group("B")
    _, (ta,) = _track(db, a, date="2026-01-01")
    _, (tb,) = _track(db, b, date="2026-02-01")
    song = db.tag_track(ta, "Song", a, visible_group_ids=[a, b])
    db.tag_track(tb, "Song", b, visible_group_ids=[a, b])
    assert db.get_song(song).take_count == 2
    only_b = db.get_song(song, [b])
    assert only_b.take_count == 1 and only_b.last_date == "2026-02-01"
    assert len(db.get_tracks_for_song(song, [a])) == 1


def test_link_conflict_and_unlink_rules(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    a, b = db.create_group("A"), db.create_group("B")
    s1 = db._get_or_create_song("Hey", a)
    db._get_or_create_song("Hey", b)
    with pytest.raises(ValueError, match="already has a song"):
        db.link_song_to_group(s1, b)
    with pytest.raises(ValueError, match="at least one group"):
        db.unlink_song_from_group(s1, a)
    # Link elsewhere, then unlink the home group → song re-homes
    c = db.create_group("C")
    db.link_song_to_group(s1, c)
    db.unlink_song_from_group(s1, a)
    assert db.get_song(s1).group_id == c
    assert [g["id"] for g in db.get_song_groups(s1)] == [c]


def test_rename_checks_all_linked_groups(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    a, b = db.create_group("A"), db.create_group("B")
    shared = db._get_or_create_song("One", a)
    db.link_song_to_group(shared, b)
    db._get_or_create_song("Two", b)
    with pytest.raises(ValueError, match="already exists"):
        db.rename_song(shared, "Two")
    db.rename_song(shared, "Three")
    assert db.get_song(shared).name == "Three"


def test_delete_group_keeps_shared_songs(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    a, b = db.create_group("A"), db.create_group("B")
    shared = db._get_or_create_song("Shared", a)
    db.link_song_to_group(shared, b)
    only_a = db._get_or_create_song("Only A", a)
    db.delete_group(a)
    assert db.get_song(shared).group_id == b
    assert db.get_song(only_a) is None


def test_move_session_links_songs(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    a, b = db.create_group("A"), db.create_group("B")
    sid, (t1,) = _track(db, a)
    song = db.tag_track(t1, "Moved", a)
    db.update_session_group(sid, b)
    assert db.get_track(t1).song_id == song
    assert {g["id"] for g in db.get_song_groups(song)} == {a, b}


def test_merge_songs(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    a, b = db.create_group("A"), db.create_group("B")
    _, (ta,) = _track(db, a)
    _, (tb,) = _track(db, b)
    keep = db.tag_track(ta, "Long Train Running", a)
    drop = db.tag_track(tb, "Long Train Running", b)
    db.update_song_details(keep, sheet="", notes="", artist="The Doobie Brothers")
    db.update_song_details(drop, sheet="[Verse]\nA B", notes="we play it fast", artist="Doobies")
    sl = db.create_setlist("Set", b)
    db.add_song_to_setlist(sl, drop)

    db.merge_songs(keep, drop)

    assert db.get_song(drop) is None
    merged = db.get_song(keep)
    assert merged.artist == "The Doobie Brothers"  # kept song's value wins
    assert merged.sheet == "[Verse]\nA B"  # filled from merged song (was empty)
    assert merged.take_count == 2
    assert db.get_track(tb).song_id == keep
    assert [s.song_id for s in db.get_setlist_songs(sl)] == [keep]
    groups = {g["id"]: g["notes"] for g in db.get_song_groups(keep)}
    assert groups == {a: "", b: "we play it fast"}


def test_merge_rejects_self(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    a = db.create_group("A")
    s = db._get_or_create_song("X", a)
    with pytest.raises(ValueError):
        db.merge_songs(s, s)


# --- API ---


def test_visibility_follows_links(two_bands):
    c, db, a, b = two_bands
    song = db._get_or_create_song("A Song", a)

    _login(c, "bonly@x.com")
    assert [s["name"] for s in c.get("/api/songs").json()] == []
    assert c.get(f"/api/songs/{song}").status_code == 404

    db.link_song_to_group(song, b)
    names = [s["name"] for s in c.get("/api/songs").json()]
    assert names == ["A Song"]
    body = c.get(f"/api/songs/{song}").json()
    # B-only user only sees Band B among the song's groups
    assert [g["name"] for g in body["groups"]] == ["Band B"]
    assert body["group_id"] == b


def test_api_link_unlink_and_group_notes(two_bands):
    c, db, a, b = two_bands
    song = db._get_or_create_song("Song", a)
    _login(c, "both@x.com")

    resp = c.post(f"/api/songs/{song}/groups", json={"group_id": b})
    assert resp.status_code == 200
    assert {g["name"] for g in resp.json()["groups"]} == {"Band A", "Band B"}

    resp = c.put(f"/api/songs/{song}/groups/{b}/notes", json={"notes": "capo 2"})
    assert resp.status_code == 200
    notes = {g["name"]: g["notes"] for g in resp.json()["groups"]}
    assert notes == {"Band A": "", "Band B": "capo 2"}

    resp = c.delete(f"/api/songs/{song}/groups/{a}")
    assert resp.status_code == 200
    assert [g["name"] for g in resp.json()["groups"]] == ["Band B"]
    assert c.delete(f"/api/songs/{song}/groups/{b}").status_code == 400


def test_api_link_conflict_is_409(two_bands):
    c, db, a, b = two_bands
    s1 = db._get_or_create_song("Dup", a)
    db._get_or_create_song("Dup", b)
    _login(c, "both@x.com")
    assert c.post(f"/api/songs/{s1}/groups", json={"group_id": b}).status_code == 409


def test_api_create_song_links_existing_from_other_band(two_bands):
    c, db, a, b = two_bands
    existing = db._get_or_create_song("Heroes", a)
    _login(c, "both@x.com")
    resp = c.post("/api/songs", json={"name": "heroes", "group_id": b, "artist": "Bowie"})
    assert resp.status_code == 200
    assert resp.json()["id"] == existing
    assert {g["name"] for g in resp.json()["groups"]} == {"Band A", "Band B"}


def test_api_setlist_add_links_song(two_bands):
    c, db, a, b = two_bands
    song = db._get_or_create_song("Cross", a)
    setlist = db.create_setlist("B set", b)
    _login(c, "both@x.com")
    resp = c.post(f"/api/setlists/{setlist}/songs", json={"song_id": song})
    assert resp.status_code == 200
    assert b in {g["id"] for g in db.get_song_groups(song)}


def test_api_setlist_rejects_invisible_song(two_bands):
    c, db, a, b = two_bands
    song = db._get_or_create_song("Secret", a)
    setlist = db.create_setlist("B set", b)
    _login(c, "bonly@x.com")
    resp = c.post(f"/api/setlists/{setlist}/songs", json={"song_id": song})
    assert resp.status_code == 400


def test_api_merge(two_bands):
    c, db, a, b = two_bands
    keep = db._get_or_create_song("Hey", a)
    drop = db._get_or_create_song("Hey", b)
    _login(c, "both@x.com")
    resp = c.post("/api/songs/merge", json={"keep_id": keep, "merge_id": drop})
    assert resp.status_code == 200
    assert {g["name"] for g in resp.json()["groups"]} == {"Band A", "Band B"}
    assert c.get(f"/api/songs/{drop}").status_code == 404


def test_api_merge_requires_admin(two_bands):
    c, db, a, b = two_bands
    _user(db, "editor@x.com", [a, b], role="editor")
    keep = db._get_or_create_song("Hey", a)
    drop = db._get_or_create_song("Hey", b)
    _login(c, "editor@x.com")
    resp = c.post("/api/songs/merge", json={"keep_id": keep, "merge_id": drop})
    assert resp.status_code == 403


def test_api_key_sees_all_songs(two_bands):
    c, db, a, b = two_bands
    db._get_or_create_song("A1", a)
    db._get_or_create_song("B1", b)
    resp = c.get("/api/songs", headers={"x-api-key": "test-api-key"})
    assert {s["name"] for s in resp.json()} == {"A1", "B1"}


def test_database_safe_under_concurrent_threads(tmp_path: Path):
    """Regression: a single shared sqlite3 connection raised 'bad parameter or
    other API misuse' when API requests ran concurrently in the thread pool."""
    from concurrent.futures import ThreadPoolExecutor

    db = Database(tmp_path / "t.db")
    g = db.create_group("G")
    ids = [db._get_or_create_song(f"Song {i}", g) for i in range(20)]

    def work(i):
        sid = ids[i % len(ids)]
        song = db.get_song(sid, [g])
        groups = db.get_song_groups(sid)
        songs = db.list_songs([g])
        return song.id == sid and groups[0]["id"] == g and len(songs) == 20

    with ThreadPoolExecutor(max_workers=16) as pool:
        assert all(pool.map(work, range(400)))
    db.close()
