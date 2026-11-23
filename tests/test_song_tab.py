"""Guitar tabs are stored apart from the chords/lyrics chart."""

from pathlib import Path

from jam_session_processor import api
from jam_session_processor.auth import hash_password
from jam_session_processor.db import Database
from tests.test_api import client  # noqa: F401

H = {"x-api-key": "test-api-key"}
TAB = "[Intro]\ne|---0---|\nB|---1---|"


def _song(db):
    gid = db.create_group("G")
    return gid, db._get_or_create_song("Riffy", gid)


def test_set_read_and_clear_tab(client):  # noqa: F811
    _, sid = _song(api._db)
    assert client.get(f"/api/songs/{sid}", headers=H).json()["has_tab"] is False
    resp = client.put(f"/api/songs/{sid}/tab", json={"tab": f"\n{TAB}\n"}, headers=H)
    assert resp.status_code == 200
    body = resp.json()
    assert body["tab"] == TAB and body["has_tab"] is True
    # Summary list flags it without sending the text
    summ = client.get("/api/songs?summary=true", headers=H).json()[0]
    assert summ["tab"] == "" and summ["has_tab"] is True
    client.put(f"/api/songs/{sid}/tab", json={"tab": ""}, headers=H)
    assert client.get(f"/api/songs/{sid}", headers=H).json()["has_tab"] is False


def test_editing_details_keeps_the_tab(client):  # noqa: F811
    _, sid = _song(api._db)
    client.put(f"/api/songs/{sid}/tab", json={"tab": TAB}, headers=H)
    client.put(
        f"/api/songs/{sid}/details", json={"artist": "A", "sheet": "C G", "notes": ""}, headers=H
    )
    assert client.get(f"/api/songs/{sid}", headers=H).json()["tab"] == TAB


def test_readonly_cannot_set_tab(client):  # noqa: F811
    gid, sid = _song(api._db)
    uid = api._db.create_user("r@x.com", hash_password("password"), name="R", role="readonly")
    api._db.assign_user_to_group(uid, gid)
    client.post("/api/auth/login", json={"email": "r@x.com", "password": "password"})
    assert client.put(f"/api/songs/{sid}/tab", json={"tab": TAB}).status_code == 403


def test_tab_migration_and_merge(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    cols = {r["name"] for r in db.conn.execute("PRAGMA table_info(songs)").fetchall()}
    assert "tab" in cols
    gid = db.create_group("G")
    keep = db._get_or_create_song("Keep", gid)
    drop = db._get_or_create_song("Drop", gid)
    db.set_song_tab(drop, TAB)
    db.merge_songs(keep, drop)
    assert db.get_song(keep).tab == TAB
