"""Reference videos (how-to lessons, backing tracks) attached to songs."""

from pathlib import Path

import pytest

from jam_session_processor import api
from jam_session_processor.db import Database
from tests.test_api import _create_user_and_group, auth_client, client  # noqa: F401


class _FakeResp:
    def __init__(self, status, payload):
        self.status_code = status
        self._payload = payload

    def json(self):
        return self._payload


@pytest.fixture
def song(auth_client):  # noqa: F811
    http, _uid, gid = auth_client
    song_id = api._db._get_or_create_song("Wonderwall", gid)
    return http, song_id


def test_add_youtube_link_fetches_title(song, monkeypatch):
    http, song_id = song
    calls = []

    def fake_get(url, params=None, timeout=None):
        calls.append(params["url"])
        return _FakeResp(200, {"title": "Wonderwall Guitar Lesson"})

    monkeypatch.setattr(api.http_requests, "get", fake_get)
    resp = http.post(
        f"/api/songs/{song_id}/links",
        json={"url": "https://youtu.be/abc123XYZ_0", "kind": "lesson"},
    )
    assert resp.status_code == 200
    links = resp.json()["links"]
    assert len(links) == 1
    assert links[0]["title"] == "Wonderwall Guitar Lesson"
    assert links[0]["kind"] == "lesson"
    assert calls == ["https://youtu.be/abc123XYZ_0"]


def test_explicit_title_skips_lookup(song, monkeypatch):
    http, song_id = song
    monkeypatch.setattr(api.http_requests, "get", lambda *a, **k: pytest.fail("no lookup"))
    resp = http.post(
        f"/api/songs/{song_id}/links",
        json={"url": "https://www.youtube.com/watch?v=x", "kind": "backing_track", "title": "BT"},
    )
    assert resp.json()["links"][0]["title"] == "BT"


def test_title_lookup_failure_is_tolerated(song, monkeypatch):
    http, song_id = song

    def boom(*a, **k):
        raise api.http_requests.Timeout()

    monkeypatch.setattr(api.http_requests, "get", boom)
    resp = http.post(f"/api/songs/{song_id}/links", json={"url": "https://youtu.be/zzz"})
    assert resp.status_code == 200
    assert resp.json()["links"][0]["title"] == ""


def test_non_youtube_link_no_lookup(song, monkeypatch):
    http, song_id = song
    monkeypatch.setattr(api.http_requests, "get", lambda *a, **k: pytest.fail("no lookup"))
    resp = http.post(f"/api/songs/{song_id}/links", json={"url": "https://example.com/lesson"})
    assert resp.status_code == 200


@pytest.mark.parametrize("url", ["javascript:alert(1)", "youtube.com/watch?v=x", "ftp://x/y"])
def test_rejects_bad_urls(song, url):
    http, song_id = song
    resp = http.post(f"/api/songs/{song_id}/links", json={"url": url, "title": "t"})
    assert resp.status_code == 400


def test_rejects_unknown_kind(song):
    http, song_id = song
    resp = http.post(
        f"/api/songs/{song_id}/links", json={"url": "https://x.com", "kind": "podcast"}
    )
    assert resp.status_code == 422


def test_links_sorted_lessons_first(song):
    http, song_id = song
    for kind in ("backing_track", "lesson"):
        http.post(
            f"/api/songs/{song_id}/links",
            json={"url": "https://example.com/" + kind, "kind": kind, "title": kind},
        )
    links = http.get(f"/api/songs/{song_id}").json()["links"]
    assert [link["kind"] for link in links] == ["lesson", "backing_track"]


def test_delete_link(song):
    http, song_id = song
    resp = http.post(
        f"/api/songs/{song_id}/links", json={"url": "https://example.com/a", "title": "a"}
    )
    link_id = resp.json()["links"][0]["id"]
    resp = http.delete(f"/api/songs/{song_id}/links/{link_id}")
    assert resp.status_code == 200
    assert resp.json()["links"] == []
    assert http.delete(f"/api/songs/{song_id}/links/{link_id}").status_code == 404


def test_delete_link_must_match_song(song):
    http, song_id = song
    db = api._db
    other = db._get_or_create_song("Other", db.get_song(song_id).group_id)
    link_id = db.add_song_link(other, "lesson", "https://example.com", "x")
    assert http.delete(f"/api/songs/{song_id}/links/{link_id}").status_code == 404


def test_readonly_cannot_add_link(client):  # noqa: F811
    db = api._db
    _create_user_and_group(db, email="ro@x.com", role="readonly")
    gid = db.get_group_by_name("TestBand").id
    song_id = db._get_or_create_song("S", gid)
    client.post("/api/auth/login", json={"email": "ro@x.com", "password": "password"})
    resp = client.post(f"/api/songs/{song_id}/links", json={"url": "https://x.com", "title": "t"})
    assert resp.status_code == 403


def test_merge_moves_links(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    g = db.create_group("G")
    keep = db._get_or_create_song("A", g)
    drop = db._get_or_create_song("B", g)
    db.add_song_link(drop, "backing_track", "https://example.com/bt", "BT")
    db.merge_songs(keep, drop)
    assert [link["title"] for link in db.list_song_links(keep)] == ["BT"]


def test_links_deleted_with_song(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    g = db.create_group("G")
    s = db._get_or_create_song("A", g)
    link_id = db.add_song_link(s, "lesson", "https://example.com", "x")
    db.delete_song(s)
    assert db.get_song_link(link_id) is None


# --- Marking a video as bad ---

KEY = {"X-API-Key": "test-api-key"}


def _add(http, song_id, url, kind="lesson"):
    resp = http.post(f"/api/songs/{song_id}/links", json={"url": url, "kind": kind, "title": "t"})
    assert resp.status_code == 200
    return resp.json()["links"][-1]["id"]


def test_flag_hides_video_and_lists_it_for_the_routine(song):
    http, song_id = song
    link_id = _add(http, song_id, "https://www.youtube.com/watch?v=abc123XYZ_0")
    resp = http.post(
        f"/api/songs/{song_id}/links/{link_id}/flag", json={"reason": "wrong_instrument"}
    )
    assert resp.status_code == 200
    assert resp.json()["links"] == []

    flags = http.get("/api/admin/video-flags", headers=KEY).json()
    assert len(flags) == 1
    flag = flags[0]
    assert flag["song_id"] == song_id
    assert flag["song_name"] == "Wonderwall"
    assert flag["kind"] == "lesson"
    assert flag["reason"] == "wrong_instrument"
    assert flag["url"] == "https://www.youtube.com/watch?v=abc123XYZ_0"
    assert flag["resolved_at"] is None

    assert http.post(f"/api/admin/video-flags/{flag['id']}/resolve", headers=KEY).status_code == 204
    assert http.get("/api/admin/video-flags", headers=KEY).json() == []
    done = http.get("/api/admin/video-flags?include_resolved=true", headers=KEY).json()
    assert done[0]["resolved_at"]
    assert http.post("/api/admin/video-flags/999/resolve", headers=KEY).status_code == 404


def test_flag_validates_link_and_reason(song):
    http, song_id = song
    link_id = _add(http, song_id, "https://example.com/a")
    assert http.post(f"/api/songs/{song_id}/links/999/flag", json={}).status_code == 404
    resp = http.post(f"/api/songs/{song_id}/links/{link_id}/flag", json={"reason": "boring"})
    assert resp.status_code == 422


def test_routine_cannot_re_add_flagged_video_but_a_person_can(song):
    http, song_id = song
    link_id = _add(http, song_id, "https://www.youtube.com/watch?v=abc123XYZ_0")
    http.post(f"/api/songs/{song_id}/links/{link_id}/flag", json={"reason": "poor_quality"})
    flag_id = http.get("/api/admin/video-flags", headers=KEY).json()[0]["id"]
    http.post(f"/api/admin/video-flags/{flag_id}/resolve", headers=KEY)

    # Same video under another URL shape, even after the flag is resolved
    body = {"url": "https://youtu.be/abc123XYZ_0?t=10", "kind": "lesson", "title": "t"}
    assert http.post(f"/api/songs/{song_id}/links", json=body, headers=KEY).status_code == 409
    other = {**body, "url": "https://youtu.be/different_1"}
    assert http.post(f"/api/songs/{song_id}/links", json=other, headers=KEY).status_code == 200

    # A person adding it again overrides the flag
    assert http.post(f"/api/songs/{song_id}/links", json=body).status_code == 200
    assert http.get("/api/admin/video-flags?include_resolved=true", headers=KEY).json() == []


def test_readonly_cannot_flag(client):  # noqa: F811
    db = api._db
    _create_user_and_group(db, email="ro@x.com", role="readonly")
    gid = db.get_group_by_name("TestBand").id
    song_id = db._get_or_create_song("S", gid)
    link_id = db.add_song_link(song_id, "lesson", "https://example.com", "x")
    client.post("/api/auth/login", json={"email": "ro@x.com", "password": "password"})
    assert client.post(f"/api/songs/{song_id}/links/{link_id}/flag", json={}).status_code == 403
    assert client.get("/api/admin/video-flags").status_code == 403


def test_video_key():
    key = api._video_key
    assert key("https://www.youtube.com/watch?v=abc123&t=5") == "yt:abc123"
    assert key("https://youtu.be/abc123") == "yt:abc123"
    assert key("https://m.youtube.com/shorts/abc123") == "yt:abc123"
    assert key(" https://example.com/a ") == "https://example.com/a"


def test_merge_moves_flags(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    g = db.create_group("G")
    keep = db._get_or_create_song("A", g)
    drop = db._get_or_create_song("B", g)
    link_id = db.add_song_link(drop, "lesson", "https://example.com/x", "X")
    db.flag_song_link(link_id, "https://example.com/x", "other")
    db.merge_songs(keep, drop)
    assert db.is_video_flagged(keep, "https://example.com/x")
    assert db.list_song_links(keep) == []
