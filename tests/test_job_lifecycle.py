"""Jobs interrupted by a restart get failed on startup; shutdown waits for in-flight jobs."""

import asyncio
import threading
import time
from pathlib import Path

from fastapi.testclient import TestClient

from jam_session_processor import api
from jam_session_processor.db import Database
from tests.test_api import client  # noqa: F401


def _job(db, job_id, status, age_hours=0):
    gid = db.create_group(f"G{job_id}")
    db.create_job(job_id, gid)
    db.conn.execute(
        "UPDATE jobs SET status = ?, created_at = datetime('now', ?) WHERE id = ?",
        (status, f"-{age_hours} hours", job_id),
    )
    db.conn.commit()


def test_fail_interrupted_jobs(tmp_path: Path):
    db = Database(tmp_path / "t.db")
    _job(db, "running", "processing")
    _job(db, "fresh", "pending")  # presigned upload still in progress: keep
    _job(db, "stale", "pending", age_hours=5)
    _job(db, "done", "completed")
    assert db.fail_interrupted_jobs() == 2
    status = {j: db.get_job(j).status for j in ("running", "fresh", "stale", "done")}
    assert status == {
        "running": "failed",
        "fresh": "pending",
        "stale": "failed",
        "done": "completed",
    }
    assert "server restart" in db.get_job("running").error


def test_startup_fails_leftover_jobs(client):  # noqa: F811
    _job(api._db, "left", "processing")
    with TestClient(api.app):  # runs the lifespan startup
        assert api._db.get_job("left").status == "failed"


def test_tracked_job_counts_and_shutdown_waits():
    release = threading.Event()

    @api._tracked_job
    def work():
        release.wait(5)

    t = threading.Thread(target=work)
    t.start()
    deadline = time.monotonic() + 2
    while api.active_job_count() == 0 and time.monotonic() < deadline:
        time.sleep(0.01)
    assert api.active_job_count() == 1

    # Times out while the job runs...
    assert asyncio.run(api._wait_for_jobs(0.2, poll=0.05)) is False
    # ...and returns as soon as it finishes
    threading.Timer(0.2, release.set).start()
    started = time.monotonic()
    assert asyncio.run(api._wait_for_jobs(5, poll=0.05)) is True
    assert time.monotonic() - started < 2
    t.join()
    assert api.active_job_count() == 0


def test_tracked_job_decrements_on_error():
    @api._tracked_job
    def boom():
        raise RuntimeError("x")

    try:
        boom()
    except RuntimeError:
        pass
    assert api.active_job_count() == 0
