"""Splitting a recording into tracks by hand (explicit segments on reprocess)."""

import time
from unittest.mock import MagicMock, patch

import pytest

from jam_session_processor import api
from tests.test_api import auth_client, client  # noqa: F401


def _session(tmp_path, gid):
    source = tmp_path / "source.m4a"
    source.write_bytes(b"\x00" * 100)
    return api._db.create_session(str(source), gid, date="2026-02-03")


def _mock_export(file_path, segments, output_dir, **kwargs):
    output_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for i, _ in enumerate(segments, 1):
        p = output_dir / f"manual{i}.m4a"
        p.write_bytes(b"\x00" * 10)
        paths.append(p)
    return paths


def test_manual_segments_create_tracks(auth_client, tmp_path):  # noqa: F811
    http, uid, gid = auth_client
    sid = _session(tmp_path, gid)
    meta = MagicMock(duration_seconds=900.0, recording_date=None)
    detect = MagicMock()
    with (
        patch("jam_session_processor.splitter.detect_songs", detect),
        patch("jam_session_processor.output.export_segments", side_effect=_mock_export),
        patch("jam_session_processor.metadata.extract_metadata", return_value=meta),
    ):
        resp = http.post(
            f"/api/sessions/{sid}/reprocess",
            # out of order + past the end: sorted and clamped
            json={"segments": [[400, 950], [10, 300]]},
        )
        assert resp.status_code == 202
        job_id = resp.json()["id"]
        for _ in range(50):
            if http.get(f"/api/jobs/{job_id}").json()["status"] in ("completed", "failed"):
                break
            time.sleep(0.1)
    assert http.get(f"/api/jobs/{job_id}").json()["status"] == "completed"
    detect.assert_not_called()
    tracks = api._db.get_tracks_for_session(sid)
    assert [(t.start_sec, t.end_sec) for t in tracks] == [(10.0, 300.0), (400.0, 900.0)]


@pytest.mark.parametrize(
    "segments,detail",
    [
        ([], "at least one"),
        ([[0, 3]], "at least 5 seconds"),
        ([[0, 100], [50, 200]], "overlap"),
        ([[-5, 100]], "at least 5 seconds"),
    ],
)
def test_manual_segments_validation(auth_client, tmp_path, segments, detail):  # noqa: F811
    http, uid, gid = auth_client
    sid = _session(tmp_path, gid)
    resp = http.post(f"/api/sessions/{sid}/reprocess", json={"segments": segments})
    assert resp.status_code == 400
    assert detail in resp.json()["detail"]
