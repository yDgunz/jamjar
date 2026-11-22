"""Song "About" backgrounds: short cited paragraphs stored on songs."""

from pathlib import Path

import pytest

from jam_session_processor import api
from jam_session_processor.db import Database
from tests.test_api import _create_user_and_group, auth_client, client  # noqa: F401

SOURCES = [
    {"title": "Animals - Wikipedia", "url": "https://en.wikipedia.org/wiki/Animals_(album)"},
    {"title": "Dogs (song)", "url": "https://example.com/dogs"},
]
TEXT = "Dogs is the centrepiece of Animals [1], written mostly by Gilmour and Waters [2]."


@pytest.fixture
def song(auth_client):  # noqa: F811
    http, _uid, gid = auth_client
    return http, api._db._get_or_create_song("Dogs", gid)


def test_no_background_by_default(song):
    http, song_id = song
    assert http.get(f"/api/songs/{song_id}").json()["background"] is None


def test_set_and_read_background(song):
    http, song_id = song
    resp = http.put(f"/api/songs/{song_id}/background", json={"text": TEXT, "sources": SOURCES})
    assert resp.status_code == 200
    bg = resp.json()["background"]
    assert bg == {"text": TEXT, "sources": SOURCES}
    listed = next(s for s in http.get("/api/songs").json() if s["id"] == song_id)
    assert listed["background"]["text"] == TEXT


def test_clear_background(song):
    http, song_id = song
    http.put(f"/api/songs/{song_id}/background", json={"text": TEXT, "sources": SOURCES})
    resp = http.delete(f"/api/songs/{song_id}/background")
    assert resp.status_code == 200
    assert resp.json()["background"] is None


@pytest.mark.parametrize(
    "body,detail",
    [
        ({"text": "  ", "sources": SOURCES}, "empty"),
        ({"text": TEXT, "sources": []}, "at least one source"),
        ({"text": "No markers here.", "sources": SOURCES}, "markers"),
        ({"text": "Too far [3].", "sources": SOURCES}, "no matching source"),
        ({"text": "Zero [0].", "sources": SOURCES}, "no matching source"),
        (
            {"text": "Bad [1].", "sources": [{"title": "x", "url": "javascript:alert(1)"}]},
            "Not a web link",
        ),
    ],
)
def test_validation(song, body, detail):
    http, song_id = song
    resp = http.put(f"/api/songs/{song_id}/background", json=body)
    assert resp.status_code == 400
    assert detail in resp.json()["detail"]


def test_readonly_cannot_set(client):  # noqa: F811
    db = api._db
    _create_user_and_group(db, email="ro@x.com", role="readonly")
    gid = db.get_group_by_name("TestBand").id
    song_id = db._get_or_create_song("S", gid)
    client.post("/api/auth/login", json={"email": "ro@x.com", "password": "password"})
    resp = client.put(f"/api/songs/{song_id}/background", json={"text": TEXT, "sources": SOURCES})
    assert resp.status_code == 403


def test_api_key_can_set(client):  # noqa: F811
    gid = api._db.create_group("G")
    song_id = api._db._get_or_create_song("S", gid)
    resp = client.put(
        f"/api/songs/{song_id}/background",
        json={"text": TEXT, "sources": SOURCES},
        headers={"x-api-key": "test-api-key"},
    )
    assert resp.status_code == 200


def test_migration_adds_columns_to_old_db(tmp_path: Path):
    path = tmp_path / "old.db"
    db = Database(path)
    db.close()
    db = Database(path)
    cols = {r["name"] for r in db.conn.execute("PRAGMA table_info(songs)").fetchall()}
    assert {"background", "background_sources"} <= cols


def test_merge_keeps_background(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    g = db.create_group("G")
    keep = db._get_or_create_song("A", g)
    drop = db._get_or_create_song("B", g)
    db.set_song_background(drop, "From drop [1].", '[{"title": "t", "url": "https://x.y"}]')
    db.merge_songs(keep, drop)
    song = db.get_song(keep)
    assert song.background == "From drop [1]."
    assert "https://x.y" in song.background_sources
