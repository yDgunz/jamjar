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


# --- Where a tab came from, and marking tabs as bad ---

UG = "https://tabs.ultimate-guitar.com/tab/band/riffy-tabs-123"


def _editor(client, gid):  # noqa: F811
    uid = api._db.create_user("e@x.com", hash_password("password"), name="E", role="editor")
    api._db.assign_user_to_group(uid, gid)
    client.post("/api/auth/login", json={"email": "e@x.com", "password": "password"})


def test_tab_source_is_kept_until_the_tab_is_cleared(client):  # noqa: F811
    _, sid = _song(api._db)
    body = client.put(f"/api/songs/{sid}/tab", json={"tab": TAB, "source": UG}, headers=H).json()
    assert body["tab_source"] == UG
    # An edit that doesn't mention the source keeps it
    body = client.put(f"/api/songs/{sid}/tab", json={"tab": TAB + "\n"}, headers=H).json()
    assert body["tab_source"] == UG
    body = client.put(f"/api/songs/{sid}/tab", json={"tab": ""}, headers=H).json()
    assert body["tab_source"] == ""


def test_flagging_a_wrong_tab_removes_it_and_blocks_that_version(client):  # noqa: F811
    gid, sid = _song(api._db)
    client.put(f"/api/songs/{sid}/tab", json={"tab": TAB, "source": UG}, headers=H)
    _editor(client, gid)
    body = client.post(f"/api/songs/{sid}/tab/flag", json={"reason": "wrong_song"}).json()
    assert body["tab"] == "" and body["has_tab"] is False and body["tab_flag"] == "wrong_song"
    client.post("/api/auth/logout")

    flags = client.get("/api/admin/tab-flags", headers=H).json()
    assert len(flags) == 1
    assert flags[0]["tab"] == TAB and flags[0]["source"] == UG and flags[0]["removed"] is True
    assert flags[0]["flagged_by_name"] == "E"
    # The routine can't put the same version back (however the link is written)…
    again = client.put(
        f"/api/songs/{sid}/tab", json={"tab": TAB, "source": UG + "/?x=1"}, headers=H
    )
    assert again.status_code == 409
    # …but another version is fine, and resolving takes the flag off the list
    other = client.put(f"/api/songs/{sid}/tab", json={"tab": TAB, "source": UG + "4"}, headers=H)
    assert other.status_code == 200 and other.json()["tab_flag"] == "wrong_song"
    assert (
        client.post(f"/api/admin/tab-flags/{flags[0]['id']}/resolve", headers=H).status_code == 204
    )
    assert client.get("/api/admin/tab-flags", headers=H).json() == []
    assert len(client.get("/api/admin/tab-flags?include_resolved=true", headers=H).json()) == 1
    assert client.get(f"/api/songs/{sid}", headers=H).json()["tab_flag"] is None
    assert client.post("/api/admin/tab-flags/999/resolve", headers=H).status_code == 404


def test_flagging_a_messy_tab_cleans_it_and_keeps_it(client):  # noqa: F811
    gid, sid = _song(api._db)
    messy = "(Full tab: Ultimate Guitar, 12 votes, 4.5★)\n\nRiffy\nTabbed by: someone\n\n" + TAB
    client.put(f"/api/songs/{sid}/tab", json={"tab": messy}, headers=H)
    _editor(client, gid)
    body = client.post(f"/api/songs/{sid}/tab/flag", json={"reason": "messy"}).json()
    assert body["tab"] == TAB and body["tab_flag"] == "messy"
    assert body["tab_source"] == "Ultimate Guitar, 12 votes, 4.5★"
    # Flagging again doesn't pile up open flags
    client.post(f"/api/songs/{sid}/tab/flag", json={"reason": "messy"})
    client.post("/api/auth/logout")
    flags = client.get("/api/admin/tab-flags", headers=H).json()
    assert len(flags) == 1 and flags[0]["removed"] is False
    # Listed for every song at once too
    assert client.get("/api/songs?summary=true", headers=H).json()[0]["tab_flag"] == "messy"


def test_editing_a_flagged_tab_by_hand_closes_the_flag(client):  # noqa: F811
    gid, sid = _song(api._db)
    client.put(f"/api/songs/{sid}/tab", json={"tab": TAB, "source": UG}, headers=H)
    _editor(client, gid)
    client.post(f"/api/songs/{sid}/tab/flag", json={"reason": "inaccurate"})
    # A person may bring the same version back
    body = client.put(f"/api/songs/{sid}/tab", json={"tab": TAB, "source": UG}).json()
    assert body["tab"] == TAB and body["tab_flag"] is None


def test_flag_needs_a_tab_and_an_editor(client):  # noqa: F811
    gid, sid = _song(api._db)
    assert client.post(f"/api/songs/{sid}/tab/flag", json={}, headers=H).status_code == 404
    assert client.post(f"/api/songs/{sid}/tab/clean", headers=H).status_code == 404
    client.put(f"/api/songs/{sid}/tab", json={"tab": TAB}, headers=H)
    uid = api._db.create_user("r@x.com", hash_password("password"), name="R", role="readonly")
    api._db.assign_user_to_group(uid, gid)
    client.post("/api/auth/login", json={"email": "r@x.com", "password": "password"})
    assert client.post(f"/api/songs/{sid}/tab/flag", json={"reason": "messy"}).status_code == 403
    assert client.post(f"/api/songs/{sid}/tab/clean").status_code == 403
    assert client.get("/api/admin/tab-flags").status_code == 403


def test_clean_endpoint_is_idempotent(client):  # noqa: F811
    _, sid = _song(api._db)
    client.put(f"/api/songs/{sid}/tab", json={"tab": "Riffy\n\n" + TAB, "source": UG}, headers=H)
    body = client.post(f"/api/songs/{sid}/tab/clean", headers=H).json()
    assert body["tab"] == TAB and body["tab_source"] == UG
    assert client.post(f"/api/songs/{sid}/tab/clean", headers=H).json()["tab"] == TAB


def test_tab_flags_and_source_follow_a_merge(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    gid = db.create_group("G")
    keep = db._get_or_create_song("Keep", gid)
    drop = db._get_or_create_song("Drop", gid)
    db.set_song_tab(drop, TAB, source=UG)
    db.flag_song_tab(drop, "messy", remove=False)
    db.merge_songs(keep, drop)
    assert db.get_song(keep).tab_source == UG
    assert db.open_tab_flag(keep)["reason"] == "messy"
