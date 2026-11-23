"""Song list: summary mode, lyric search, band filter for API keys, JSON gzip."""

import gzip

from jam_session_processor import api
from tests.test_api import client  # noqa: F401

H = {"x-api-key": "test-api-key"}


def _songs(db):
    gid = db.create_group("Band")
    a = db._get_or_create_song("Alpha", gid)
    db.update_song_details(a, sheet="C  G\nOh little jeannie", notes="", artist="Elton John")
    b = db._get_or_create_song("Beta", gid)
    db.update_song_details(b, sheet="", notes="", artist="")
    return gid, a, b


def test_summary_omits_sheet_but_flags_it(client):  # noqa: F811
    _, a, b = _songs(api._db)
    full = {s["id"]: s for s in client.get("/api/songs", headers=H).json()}
    assert "jeannie" in full[a]["sheet"] and full[a]["has_sheet"] and not full[b]["has_sheet"]
    summ = {s["id"]: s for s in client.get("/api/songs?summary=true", headers=H).json()}
    assert summ[a]["sheet"] == "" and summ[a]["has_sheet"] is True
    assert summ[a]["name"] == "Alpha" and summ[a]["created_at"]


def test_lyric_search(client):  # noqa: F811
    _, a, _ = _songs(api._db)
    assert client.get("/api/songs/search?q=JEANNIE", headers=H).json() == [
        {"id": a, "line": "Oh little jeannie"}
    ]
    assert client.get("/api/songs/search?q=x", headers=H).json() == []  # too short
    assert client.get("/api/songs/search?q=nowhere", headers=H).json() == []


def test_group_filter_with_api_key(client):  # noqa: F811
    gid, _, _ = _songs(api._db)
    other = api._db.create_group("Other")
    api._db._get_or_create_song("Gamma", other)
    names = [s["name"] for s in client.get(f"/api/songs?group_id={gid}", headers=H).json()]
    assert sorted(names) == ["Alpha", "Beta"]


def test_json_responses_are_gzipped(client):  # noqa: F811
    db = api._db
    gid = db.create_group("Big")
    for i in range(60):
        db._get_or_create_song(f"Song {i:02d}", gid)
    raw = client.get("/api/songs", headers={**H, "accept-encoding": "gzip"})
    assert raw.headers.get("content-encoding") == "gzip"
    assert len(raw.json()) == 60  # client transparently decodes
    plain = client.get("/api/songs", headers={**H, "accept-encoding": "identity"})
    assert "content-encoding" not in plain.headers
    # Small responses are left alone
    assert (
        "content-encoding" not in client.get("/health", headers={"accept-encoding": "gzip"}).headers
    )
    assert gzip is not None
