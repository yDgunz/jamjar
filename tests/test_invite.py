from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from jam_session_processor import api
from jam_session_processor.auth import hash_password
from jam_session_processor.config import reset_config
from jam_session_processor.db import Database
from jam_session_processor.email import send_invite_email
from jam_session_processor.storage import reset_storage


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
    reset_config()
    d = Database(tmp_path / "test.db")
    yield d
    d.close()
    reset_config()


@pytest.fixture(autouse=True)
def _reset_config_after_test():
    """Ensure config singleton is cleared after each test."""
    yield
    reset_config()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("JAM_JWT_SECRET", "test-secret")
    monkeypatch.setenv("JAM_API_KEY", "test-api-key")
    monkeypatch.delenv("JAM_R2_BUCKET", raising=False)
    monkeypatch.delenv("JAM_R2_ACCOUNT_ID", raising=False)
    monkeypatch.delenv("JAM_R2_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("JAM_R2_SECRET_ACCESS_KEY", raising=False)
    reset_config()
    reset_storage()
    d = Database(tmp_path / "test.db")
    api._db = d
    yield TestClient(api.app)
    d.close()
    api._db = None
    reset_storage()
    reset_config()


class TestInviteTokens:
    def test_create_invite_token(self, db):
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)
        assert token is not None
        assert len(token) > 20

    def test_get_invite_token(self, db):
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)
        row = db.get_invite_token(token)
        assert row is not None
        assert row.user_id == uid
        assert row.used_at is None

    def test_get_invite_token_not_found(self, db):
        assert db.get_invite_token("nonexistent") is None

    def test_consume_invite_token(self, db):
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)
        db.consume_invite_token(token)
        row = db.get_invite_token(token)
        assert row.used_at is not None

    def test_delete_invite_tokens_for_user(self, db):
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)
        assert db.get_invite_token(token) is not None
        db.delete_invite_tokens_for_user(uid)
        assert db.get_invite_token(token) is None

    def test_create_user_without_password(self, db):
        uid = db.create_user("alice@example.com", "", name="Alice")
        user = db.get_user(uid)
        assert user is not None
        assert user.password_hash == ""
        assert user.email == "alice@example.com"


class TestInviteEmail:
    def test_send_invite_email_builds_correct_message(self, monkeypatch):
        monkeypatch.setenv("JAM_SMTP_HOST", "smtp.example.com")
        monkeypatch.setenv("JAM_SMTP_PORT", "587")
        monkeypatch.setenv("JAM_SMTP_USER", "user@example.com")
        monkeypatch.setenv("JAM_SMTP_PASSWORD", "secret")
        monkeypatch.setenv("JAM_SMTP_FROM", "noreply@example.com")
        monkeypatch.setenv("JAM_APP_URL", "https://jam.example.com")
        reset_config()

        mock_smtp_instance = MagicMock()
        mock_smtp_class = MagicMock(return_value=mock_smtp_instance)
        mock_smtp_instance.__enter__ = MagicMock(return_value=mock_smtp_instance)
        mock_smtp_instance.__exit__ = MagicMock(return_value=False)

        with patch("jam_session_processor.email.smtplib.SMTP", mock_smtp_class):
            send_invite_email("alice@example.com", "test-token-abc", "Alice")

        mock_smtp_class.assert_called_once_with("smtp.example.com", 587)
        mock_smtp_instance.starttls.assert_called_once()
        mock_smtp_instance.login.assert_called_once_with("user@example.com", "secret")
        mock_smtp_instance.send_message.assert_called_once()

        msg = mock_smtp_instance.send_message.call_args[0][0]
        assert msg["To"] == "alice@example.com"
        assert msg["From"] == "noreply@example.com"
        assert "invite" in msg["Subject"].lower()
        body = msg.get_payload(decode=True).decode()
        assert "https://jam.example.com/invite/test-token-abc" in body
        assert "jam session recordings" in body.lower()

    def test_send_invite_email_no_smtp_configured(self, monkeypatch):
        monkeypatch.setenv("JAM_SMTP_HOST", "")
        monkeypatch.setenv("JAM_APP_URL", "https://jam.example.com")
        reset_config()

        result = send_invite_email("alice@example.com", "test-token", "Alice")
        assert result is False


class TestInviteAPI:
    def test_validate_invite_valid_token(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)

        resp = client.post("/api/invite/validate", json={"token": token})
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "alice@example.com"
        assert data["name"] == "Alice"

    def test_validate_invite_invalid_token(self, client):
        resp = client.post("/api/invite/validate", json={"token": "bad-token"})
        assert resp.status_code == 404

    def test_validate_invite_expired_token(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)
        db.conn.execute(
            "UPDATE invite_tokens SET expires_at = datetime('now', '-1 hour') WHERE token = ?",
            (token,),
        )
        db.conn.commit()

        resp = client.post("/api/invite/validate", json={"token": token})
        assert resp.status_code == 410

    def test_validate_invite_already_used(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)
        db.consume_invite_token(token)

        resp = client.post("/api/invite/validate", json={"token": token})
        assert resp.status_code == 410

    def test_accept_invite_sets_password(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)

        resp = client.post(
            "/api/invite/accept",
            json={"token": token, "password": "mynewpassword"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "alice@example.com"
        row = db.get_invite_token(token)
        assert row.used_at is not None
        user = db.get_user(uid)
        assert user.password_hash != ""
        assert "jam_session" in resp.cookies

    def test_accept_invite_invalid_token(self, client):
        resp = client.post(
            "/api/invite/accept",
            json={"token": "bad-token", "password": "test1234"},
        )
        assert resp.status_code == 404

    def test_accept_invite_expired_token(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)
        db.conn.execute(
            "UPDATE invite_tokens SET expires_at = datetime('now', '-1 hour') WHERE token = ?",
            (token,),
        )
        db.conn.commit()

        resp = client.post(
            "/api/invite/accept",
            json={"token": token, "password": "test1234"},
        )
        assert resp.status_code == 410

    def test_accept_invite_empty_password(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)

        resp = client.post(
            "/api/invite/accept",
            json={"token": token, "password": ""},
        )
        assert resp.status_code == 400

    def test_accept_invite_short_password(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", "", name="Alice")
        token = db.create_invite_token(uid, expires_hours=168)

        resp = client.post(
            "/api/invite/accept",
            json={"token": token, "password": "ab"},
        )
        assert resp.status_code == 400

    def test_login_blocked_without_password(self, client):
        db = api._db
        db.create_user("alice@example.com", "", name="Alice")

        resp = client.post(
            "/api/auth/login",
            json={"email": "alice@example.com", "password": "anything"},
        )
        assert resp.status_code == 401


class TestAdminInviteFlow:
    def _superadmin_client(self, client):
        db = api._db
        uid = db.create_user(
            "admin@example.com", hash_password("adminpass"), name="Admin", role="superadmin"
        )
        gid = db.create_group("TestBand")
        db.assign_user_to_group(uid, gid)
        resp = client.post(
            "/api/auth/login",
            json={"email": "admin@example.com", "password": "adminpass"},
        )
        assert resp.status_code == 200
        return client

    def test_create_user_without_password_sends_invite(self, client, monkeypatch):
        c = self._superadmin_client(client)
        monkeypatch.setenv("JAM_APP_URL", "https://jam.example.com")
        reset_config()

        with patch("jam_session_processor.email.send_invite_email") as mock_email:
            mock_email.return_value = True
            resp = c.post(
                "/api/admin/users",
                json={"email": "newuser@example.com", "name": "New User", "role": "editor"},
            )
            assert resp.status_code == 201
            data = resp.json()
            assert data["email"] == "newuser@example.com"

            mock_email.assert_called_once()
            call_args = mock_email.call_args
            assert call_args[0][0] == "newuser@example.com"
            assert len(call_args[0][1]) > 20
            assert call_args[0][2] == "New User"

    def test_create_user_with_password_still_works(self, client):
        c = self._superadmin_client(client)

        resp = c.post(
            "/api/admin/users",
            json={
                "email": "legacy@example.com",
                "password": "mypassword",
                "name": "Legacy",
                "role": "editor",
            },
        )
        assert resp.status_code == 201

        resp = client.post(
            "/api/auth/login",
            json={"email": "legacy@example.com", "password": "mypassword"},
        )
        assert resp.status_code == 200

    def test_resend_invite(self, client, monkeypatch):
        c = self._superadmin_client(client)
        monkeypatch.setenv("JAM_APP_URL", "https://jam.example.com")
        reset_config()

        db = api._db
        uid = db.create_user("invited@example.com", "", name="Invited")

        with patch("jam_session_processor.email.send_invite_email") as mock_email:
            mock_email.return_value = True
            resp = c.post(f"/api/admin/users/{uid}/resend-invite")
            assert resp.status_code == 200
            mock_email.assert_called_once()
