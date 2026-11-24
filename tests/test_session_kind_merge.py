"""Recording type (jam/gig/demo/studio) and merging recordings into one."""

import sqlite3
import subprocess

from jam_session_processor import api
from jam_session_processor.db import Database
from jam_session_processor.metadata import extract_metadata
from tests.test_api import _poll_job, auth_client, client  # noqa: F401


def _tone(path, seconds, freq=440):
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i",
         f"sine=frequency={freq}:duration={seconds}", str(path)],
        check=True,
    )  # fmt: skip


def _recording(db, tmp_path, gid, name, seconds, ext=".wav", notes=""):
    """A one-track recording with real audio; returns (session_id, track_id)."""
    source = tmp_path / "recordings" / f"{name}{ext}"
    _tone(source, seconds)
    sid = db.create_session(f"recordings/{name}{ext}", gid, date="2025-07-21", notes=notes)
    db.update_session_duration(sid, float(seconds))
    track = tmp_path / "tracks" / str(sid) / f"1_00m00s-00m0{seconds}s.m4a"
    _tone(track, seconds)
    tid = db.create_track(sid, 1, 0.0, float(seconds), f"tracks/{sid}/{track.name}")
    return sid, tid


def test_kind_defaults_empty_and_can_be_set(auth_client):  # noqa: F811
    http, uid, gid = auth_client
    sid = api._db.create_session("a.m4a", gid, date="2026-01-01")
    assert http.get(f"/api/sessions/{sid}").json()["kind"] == ""

    resp = http.put(f"/api/sessions/{sid}/kind", json={"kind": "gig"})
    assert resp.status_code == 200
    assert resp.json()["kind"] == "gig"
    assert http.get("/api/sessions").json()[0]["kind"] == "gig"

    assert http.put(f"/api/sessions/{sid}/kind", json={"kind": ""}).json()["kind"] == ""
    assert http.put(f"/api/sessions/{sid}/kind", json={"kind": "album"}).status_code == 422


def test_kind_column_added_to_existing_db(tmp_path):
    path = tmp_path / "old.db"
    Database(path).close()
    conn = sqlite3.connect(path)
    conn.execute("ALTER TABLE sessions DROP COLUMN kind")
    conn.commit()
    conn.close()
    db = Database(path)
    gid = db.create_group("Band")
    sid = db.create_session("a.m4a", gid)
    assert db.get_session(sid).kind == ""
    db.close()


def test_song_takes_put_studio_first(auth_client):  # noqa: F811
    http, uid, gid = auth_client
    db = api._db
    jam = db.create_session("jam.m4a", gid, date="2026-05-01")
    studio = db.create_session("studio.wav", gid, date="2025-07-21")
    db.update_session_kind(studio, "studio")
    for sid in (jam, studio):
        tid = db.create_track(sid, 1, 0.0, 100.0, f"tracks/{sid}/1.m4a")
        http.post(f"/api/tracks/{tid}/tag", json={"song_name": "Fat Cat"})
    song_id = http.get("/api/songs").json()[0]["id"]
    takes = http.get(f"/api/songs/{song_id}/tracks").json()
    assert [t["session_kind"] for t in takes] == ["studio", ""]


def test_merge_recordings(auth_client, tmp_path):  # noqa: F811
    http, uid, gid = auth_client
    db = api._db
    a, ta = _recording(db, tmp_path, gid, "a", 3, notes="first")
    b, tb = _recording(db, tmp_path, gid, "b", 2)
    c, tc = _recording(db, tmp_path, gid, "c", 4, notes="third")
    http.post(f"/api/tracks/{tb}/tag", json={"song_name": "Be Forever"})
    http.put(f"/api/tracks/{tc}/notes", json={"notes": "MIX2"})
    token = http.post(f"/api/tracks/{tc}/share").json()["token"]

    resp = http.post(f"/api/sessions/{a}/merge", json={"session_ids": [c, b]})
    assert resp.status_code == 202
    job = _poll_job(http, resp.json()["id"], timeout=30)
    assert job["status"] == "completed", job

    # Only the kept recording is left, with one lossless joined source
    sessions = http.get("/api/sessions").json()
    assert [s["id"] for s in sessions] == [a]
    merged = db.get_session(a)
    assert merged.source_file.endswith(".flac")
    assert abs(merged.duration_sec - 9.0) < 0.1
    assert merged.notes == "first\nthird"
    source = tmp_path / merged.source_file
    assert abs(extract_metadata(source).duration_seconds - 9.0) < 0.1
    assert sorted(p.name for p in (tmp_path / "recordings").iterdir()) == [source.name]

    # Tracks moved in the order given, shifted, with tag/notes/share link intact
    tracks = db.get_tracks_for_session(a)
    assert [t.id for t in tracks] == [ta, tc, tb]
    assert [t.track_number for t in tracks] == [1, 2, 3]
    assert [(round(t.start_sec), round(t.end_sec)) for t in tracks] == [(0, 3), (3, 7), (7, 9)]
    assert tracks[1].notes == "MIX2"
    assert tracks[2].song_name == "Be Forever"
    assert db.get_share_link_by_token(token).track_id == tc
    for t in tracks:
        assert t.audio_path.startswith(f"tracks/{a}/")
        assert (tmp_path / t.audio_path).exists()
        assert http.get(f"/api/tracks/{t.id}/audio").status_code == 200


def test_merge_mixed_formats_makes_m4a(auth_client, tmp_path):  # noqa: F811
    http, uid, gid = auth_client
    db = api._db
    a, _ = _recording(db, tmp_path, gid, "a", 2, ext=".m4a")
    b, _ = _recording(db, tmp_path, gid, "b", 2, ext=".wav")
    job = _poll_job(
        http,
        http.post(f"/api/sessions/{a}/merge", json={"session_ids": [b]}).json()["id"],
        timeout=30,
    )
    assert job["status"] == "completed", job
    assert db.get_session(a).source_file.endswith(".m4a")
    assert len(db.get_tracks_for_session(a)) == 2


def test_merge_validation(auth_client, tmp_path):  # noqa: F811
    http, uid, gid = auth_client
    db = api._db
    a = db.create_session("a.m4a", gid)
    other_gid = db.create_group("Other")
    db.assign_user_to_group(uid, other_gid)
    b = db.create_session("b.m4a", other_gid)

    assert http.post(f"/api/sessions/{a}/merge", json={"session_ids": []}).status_code == 422
    assert http.post(f"/api/sessions/{a}/merge", json={"session_ids": [a]}).status_code == 400
    assert http.post(f"/api/sessions/{a}/merge", json={"session_ids": [b]}).status_code == 400
    assert http.post(f"/api/sessions/{a}/merge", json={"session_ids": [999]}).status_code == 404


def test_merge_failure_leaves_recordings_alone(auth_client, tmp_path):  # noqa: F811
    http, uid, gid = auth_client
    db = api._db
    a, ta = _recording(db, tmp_path, gid, "a", 2)
    b = db.create_session("recordings/missing.wav", gid)
    job = _poll_job(
        http,
        http.post(f"/api/sessions/{a}/merge", json={"session_ids": [b]}).json()["id"],
        timeout=30,
    )
    assert job["status"] == "failed"
    assert db.get_session(b) is not None
    assert db.get_session(a).source_file == "recordings/a.wav"
    assert (tmp_path / "recordings" / "a.wav").exists()
    assert db.get_track(ta).session_id == a
