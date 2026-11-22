"""Tests for API hardening: input length limits, rate limiting, health checks."""

import sqlite3

import pytest

from jam_session_processor import api
from jam_session_processor.auth import hash_password, verify_password
from tests.test_api import _create_user_and_group, auth_client, client  # noqa: F401

# --- Input length limits (#2) ---


@pytest.mark.parametrize(
    "method,path,body",
    [
        ("post", "/api/auth/login", {"email": "a" * 300, "password": "x"}),
        ("post", "/api/auth/login", {"email": "a@b.co", "password": "x" * 200}),
        ("post", "/api/auth/forgot-password", {"email": "a" * 300}),
        ("post", "/api/invite/validate", {"token": "t" * 300}),
        (
            "post",
            "/api/access-request",
            {"email": "a@b.co", "band_name": "B", "message": "m" * 6000},
        ),
    ],
)
def test_public_oversized_input_rejected(client, method, path, body):  # noqa: F811
    resp = getattr(client, method)(path, json=body)
    assert resp.status_code == 422


def test_session_notes_too_long_rejected(auth_client):  # noqa: F811
    http, _uid, gid = auth_client
    sid = api._db.create_session("s.m4a", gid)
    resp = http.put(f"/api/sessions/{sid}/notes", json={"notes": "n" * 20_001})
    assert resp.status_code == 422
    resp = http.put(f"/api/sessions/{sid}/notes", json={"notes": "n" * 20_000})
    assert resp.status_code == 200


def test_song_name_too_long_rejected(auth_client):  # noqa: F811
    http, _uid, gid = auth_client
    resp = http.post("/api/songs", json={"name": "s" * 201, "group_id": gid})
    assert resp.status_code == 422


def test_song_sheet_limit(auth_client):  # noqa: F811
    http, _uid, gid = auth_client
    song_id = http.post("/api/songs", json={"name": "Song", "group_id": gid}).json()["id"]
    resp = http.put(f"/api/songs/{song_id}/details", json={"sheet": "x" * 100_001})
    assert resp.status_code == 422
    resp = http.put(f"/api/songs/{song_id}/details", json={"sheet": "x" * 100_000})
    assert resp.status_code == 200


def test_setlist_song_list_limit(auth_client):  # noqa: F811
    http, _uid, gid = auth_client
    setlist_id = http.post("/api/setlists", json={"name": "Set", "group_id": gid}).json()["id"]
    resp = http.put(f"/api/setlists/{setlist_id}/songs", json={"song_ids": [1] * 1001})
    assert resp.status_code == 422


# --- Rate limiting (#3) ---


def test_login_rate_limited_after_five_failures(client):  # noqa: F811
    _create_user_and_group(api._db)
    for _ in range(5):
        resp = client.post("/api/auth/login", json={"email": "test@example.com", "password": "no"})
        assert resp.status_code == 401
    resp = client.post("/api/auth/login", json={"email": "test@example.com", "password": "no"})
    assert resp.status_code == 429
    assert "Too many login attempts" in resp.json()["detail"]
    # Correct password is also blocked while limited
    resp = client.post(
        "/api/auth/login", json={"email": "test@example.com", "password": "password"}
    )
    assert resp.status_code == 429


def test_login_limit_is_per_ip(client):  # noqa: F811
    _create_user_and_group(api._db)
    bad = {"email": "test@example.com", "password": "no"}
    for _ in range(5):
        client.post("/api/auth/login", json=bad, headers={"x-forwarded-for": "1.1.1.1"})
    resp = client.post("/api/auth/login", json=bad, headers={"x-forwarded-for": "1.1.1.1"})
    assert resp.status_code == 429
    resp = client.post("/api/auth/login", json=bad, headers={"x-forwarded-for": "2.2.2.2"})
    assert resp.status_code == 401


def test_successful_login_resets_limit(client):  # noqa: F811
    _create_user_and_group(api._db)
    for _ in range(4):
        client.post("/api/auth/login", json={"email": "test@example.com", "password": "no"})
    resp = client.post(
        "/api/auth/login", json={"email": "test@example.com", "password": "password"}
    )
    assert resp.status_code == 200
    for _ in range(4):
        resp = client.post("/api/auth/login", json={"email": "test@example.com", "password": "no"})
        assert resp.status_code == 401


def test_forgot_password_rate_limited(client):  # noqa: F811
    for _ in range(5):
        resp = client.post("/api/auth/forgot-password", json={"email": "x@example.com"})
        assert resp.status_code == 200
    resp = client.post("/api/auth/forgot-password", json={"email": "x@example.com"})
    assert resp.status_code == 429


def test_invite_token_guessing_rate_limited(client):  # noqa: F811
    for _ in range(20):
        resp = client.post("/api/invite/validate", json={"token": "guess"})
        assert resp.status_code == 404
    resp = client.post("/api/invite/validate", json={"token": "guess"})
    assert resp.status_code == 429


def test_reset_token_guessing_rate_limited(client):  # noqa: F811
    for _ in range(20):
        client.post("/api/auth/reset-password/validate", json={"token": "guess"})
    resp = client.post(
        "/api/auth/reset-password", json={"token": "guess", "password": "longenough"}
    )
    assert resp.status_code == 429


def test_change_password_rate_limited(auth_client):  # noqa: F811
    http, _uid, _gid = auth_client
    body = {"current_password": "wrong", "new_password": "newpassword"}
    for _ in range(5):
        assert http.put("/api/auth/password", json=body).status_code == 400
    assert http.put("/api/auth/password", json=body).status_code == 429


def test_rate_limiter_sweeps_stale_keys(monkeypatch):
    limiter = api.RateLimiter(max_attempts=1, window_seconds=10)
    monkeypatch.setattr(limiter, "_SWEEP_THRESHOLD", 3)
    now = [1000.0]
    monkeypatch.setattr(api.time, "monotonic", lambda: now[0])
    for ip in ("a", "b", "c", "d"):
        limiter.record(ip)
    now[0] += 60
    limiter.record("e")
    assert set(limiter._attempts) == {"e"}


def test_wrong_api_key_rejected(client):  # noqa: F811
    resp = client.get("/api/sessions", headers={"x-api-key": "wrong"})
    assert resp.status_code == 401


# --- Passwords longer than bcrypt's 72-byte limit ---


def test_long_password_hash_and_verify():
    pw = "p" * 100
    h = hash_password(pw)
    assert verify_password(pw, h)
    assert not verify_password("q" * 100, h)


def test_login_with_long_password_does_not_500(client):  # noqa: F811
    _create_user_and_group(api._db)
    resp = client.post("/api/auth/login", json={"email": "test@example.com", "password": "x" * 100})
    assert resp.status_code == 401


def test_verify_password_malformed_hash():
    assert not verify_password("password", "not-a-bcrypt-hash")


# --- Health check (#4) ---


def test_health_ok_checks_db(client):  # noqa: F811
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok", "db": "ok"}


def test_health_returns_503_when_db_broken(client, monkeypatch):  # noqa: F811
    def broken_ping():
        raise sqlite3.OperationalError("disk I/O error")

    monkeypatch.setattr(api._db, "ping", broken_ping)
    resp = client.get("/health")
    assert resp.status_code == 503
    assert resp.json()["status"] == "error"


def test_health_returns_503_when_db_closed(client):  # noqa: F811
    api._db.close()
    resp = client.get("/health")
    assert resp.status_code == 503
    # Reopen so fixture teardown can close cleanly
    api._db.conn = sqlite3.connect(":memory:")


def test_rate_limit_ignores_spoofed_client_headers(client):  # noqa: F811
    """Client-supplied CF-Connecting-IP and leading X-Forwarded-For entries can't
    be used to rotate identities; only the proxy-appended last hop counts."""
    _create_user_and_group(api._db)
    bad = {"email": "test@example.com", "password": "no"}
    for i in range(5):
        client.post(
            "/api/auth/login",
            json=bad,
            headers={"cf-connecting-ip": f"9.9.9.{i}", "x-forwarded-for": f"8.8.8.{i}, 1.1.1.1"},
        )
    resp = client.post(
        "/api/auth/login",
        json=bad,
        headers={"cf-connecting-ip": "9.9.9.99", "x-forwarded-for": "8.8.8.99, 1.1.1.1"},
    )
    assert resp.status_code == 429
