from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from jam_session_processor import api
from jam_session_processor.auth import hash_password, verify_password
from jam_session_processor.config import reset_config
from jam_session_processor.db import Database
from jam_session_processor.email import send_password_reset_email
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
    yield
    reset_config()


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("JAM_JWT_SECRET", "test-secret")
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


class TestPasswordResetTokens:
    def test_create_password_reset_token(self, db):
        uid = db.create_user("alice@example.com", hash_password("oldpass"), name="Alice")
        token = db.create_password_reset_token(uid)
        assert token is not None
        assert len(token) > 20

    def test_get_password_reset_token(self, db):
        uid = db.create_user("alice@example.com", hash_password("oldpass"), name="Alice")
        token = db.create_password_reset_token(uid)
        row = db.get_password_reset_token(token)
        assert row is not None
        assert row.user_id == uid
        assert row.used_at is None

    def test_get_password_reset_token_not_found(self, db):
        assert db.get_password_reset_token("nonexistent") is None

    def test_consume_password_reset_token(self, db):
        uid = db.create_user("alice@example.com", hash_password("oldpass"), name="Alice")
        token = db.create_password_reset_token(uid)
        db.consume_password_reset_token(token)
        row = db.get_password_reset_token(token)
        assert row.used_at is not None

    def test_creating_new_token_deletes_old(self, db):
        uid = db.create_user("alice@example.com", hash_password("oldpass"), name="Alice")
        token1 = db.create_password_reset_token(uid)
        token2 = db.create_password_reset_token(uid)
        assert db.get_password_reset_token(token1) is None
        assert db.get_password_reset_token(token2) is not None


class TestPasswordResetEmail:
    def test_send_password_reset_email(self, monkeypatch):
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
            send_password_reset_email("alice@example.com", "reset-token-abc", "Alice")

        mock_smtp_class.assert_called_once_with("smtp.example.com", 587)
        mock_smtp_instance.send_message.assert_called_once()

        msg = mock_smtp_instance.send_message.call_args[0][0]
        assert msg["To"] == "alice@example.com"
        assert msg["From"] == "noreply@example.com"
        assert "reset" in msg["Subject"].lower()
        body = msg.get_payload(decode=True).decode()
        assert "https://jam.example.com/reset-password/reset-token-abc" in body
        assert "1 hour" in body

    def test_send_password_reset_email_no_smtp(self, monkeypatch):
        monkeypatch.setenv("JAM_SMTP_HOST", "")
        reset_config()
        result = send_password_reset_email("alice@example.com", "token", "Alice")
        assert result is False


class TestPasswordResetAPI:
    def test_forgot_password_sends_email(self, client, monkeypatch):
        db = api._db
        db.create_user("alice@example.com", hash_password("oldpass"), name="Alice")

        with patch("jam_session_processor.email.send_password_reset_email") as mock_email:
            mock_email.return_value = True
            resp = client.post(
                "/api/auth/forgot-password",
                json={"email": "alice@example.com"},
            )
            assert resp.status_code == 200
            assert resp.json()["ok"] is True
            mock_email.assert_called_once()
            assert mock_email.call_args[0][0] == "alice@example.com"

    def test_forgot_password_unknown_email_still_ok(self, client):
        resp = client.post(
            "/api/auth/forgot-password",
            json={"email": "nobody@example.com"},
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

    def test_forgot_password_no_password_set(self, client):
        """Users who haven't set a password yet (invited but not accepted) shouldn't get reset emails."""
        db = api._db
        db.create_user("alice@example.com", "", name="Alice")

        with patch("jam_session_processor.email.send_password_reset_email") as mock_email:
            resp = client.post(
                "/api/auth/forgot-password",
                json={"email": "alice@example.com"},
            )
            assert resp.status_code == 200
            mock_email.assert_not_called()

    def test_validate_reset_token(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", hash_password("oldpass"), name="Alice")
        token = db.create_password_reset_token(uid)

        resp = client.post("/api/auth/reset-password/validate", json={"token": token})
        assert resp.status_code == 200
        assert resp.json()["email"] == "alice@example.com"

    def test_validate_reset_token_invalid(self, client):
        resp = client.post("/api/auth/reset-password/validate", json={"token": "bad"})
        assert resp.status_code == 404

    def test_validate_reset_token_expired(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", hash_password("oldpass"), name="Alice")
        token = db.create_password_reset_token(uid)
        db.conn.execute(
            "UPDATE password_reset_tokens SET expires_at = datetime('now', '-1 hour') WHERE token = ?",
            (token,),
        )
        db.conn.commit()

        resp = client.post("/api/auth/reset-password/validate", json={"token": token})
        assert resp.status_code == 410

    def test_validate_reset_token_already_used(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", hash_password("oldpass"), name="Alice")
        token = db.create_password_reset_token(uid)
        db.consume_password_reset_token(token)

        resp = client.post("/api/auth/reset-password/validate", json={"token": token})
        assert resp.status_code == 410

    def test_reset_password_success(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", hash_password("oldpass"), name="Alice")
        token = db.create_password_reset_token(uid)

        resp = client.post(
            "/api/auth/reset-password",
            json={"token": token, "password": "mynewpassword"},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["email"] == "alice@example.com"
        assert "jam_session" in resp.cookies

        # Verify password was changed
        user = db.get_user(uid)
        assert verify_password("mynewpassword", user.password_hash)

        # Verify token was consumed
        row = db.get_password_reset_token(token)
        assert row.used_at is not None

    def test_reset_password_short_password(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", hash_password("oldpass"), name="Alice")
        token = db.create_password_reset_token(uid)

        resp = client.post(
            "/api/auth/reset-password",
            json={"token": token, "password": "short"},
        )
        assert resp.status_code == 400

    def test_reset_password_invalid_token(self, client):
        resp = client.post(
            "/api/auth/reset-password",
            json={"token": "bad", "password": "newpassword123"},
        )
        assert resp.status_code == 404

    def test_reset_password_expired_token(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", hash_password("oldpass"), name="Alice")
        token = db.create_password_reset_token(uid)
        db.conn.execute(
            "UPDATE password_reset_tokens SET expires_at = datetime('now', '-1 hour') WHERE token = ?",
            (token,),
        )
        db.conn.commit()

        resp = client.post(
            "/api/auth/reset-password",
            json={"token": token, "password": "newpassword123"},
        )
        assert resp.status_code == 410

    def test_reset_password_already_used_token(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", hash_password("oldpass"), name="Alice")
        token = db.create_password_reset_token(uid)
        db.consume_password_reset_token(token)

        resp = client.post(
            "/api/auth/reset-password",
            json={"token": token, "password": "newpassword123"},
        )
        assert resp.status_code == 410

    def test_can_login_after_reset(self, client):
        db = api._db
        uid = db.create_user("alice@example.com", hash_password("oldpass"), name="Alice")
        gid = db.create_group("TestBand")
        db.assign_user_to_group(uid, gid)
        token = db.create_password_reset_token(uid)

        client.post(
            "/api/auth/reset-password",
            json={"token": token, "password": "mynewpassword"},
        )

        resp = client.post(
            "/api/auth/login",
            json={"email": "alice@example.com", "password": "mynewpassword"},
        )
        assert resp.status_code == 200
