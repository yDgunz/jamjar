import jwt
import pytest

from jam_session_processor.auth import (
    create_jwt,
    decode_jwt,
    hash_password,
    verify_password,
)
from jam_session_processor.config import reset_config


@pytest.fixture(autouse=True)
def _setup_config(monkeypatch):
    monkeypatch.setenv("JAM_JWT_SECRET", "test-secret-key-for-testing")
    reset_config()
    yield
    reset_config()


def test_hash_and_verify_password():
    pw = "mysecretpassword"
    hashed = hash_password(pw)
    assert hashed != pw
    assert verify_password(pw, hashed)


def test_wrong_password_fails():
    hashed = hash_password("correct")
    assert not verify_password("wrong", hashed)


def test_different_hashes_for_same_password():
    h1 = hash_password("test")
    h2 = hash_password("test")
    assert h1 != h2  # bcrypt uses random salt


def test_create_and_decode_jwt():
    token = create_jwt(42, "alice@example.com")
    payload = decode_jwt(token)
    assert payload["sub"] == "42"
    assert payload["email"] == "alice@example.com"
    assert "exp" in payload


def test_expired_jwt_fails(monkeypatch):
    # Create a token that expired 1 second ago
    from datetime import datetime, timedelta, timezone

    monkeypatch.setattr("jam_session_processor.auth._TOKEN_EXPIRY_DAYS", 0)

    cfg_secret = "test-secret-key-for-testing"
    payload = {
        "sub": 1,
        "email": "test@example.com",
        "exp": datetime.now(timezone.utc) - timedelta(seconds=1),
    }
    token = jwt.encode(payload, cfg_secret, algorithm="HS256")

    with pytest.raises(jwt.ExpiredSignatureError):
        decode_jwt(token)


def test_invalid_jwt_fails():
    with pytest.raises(jwt.InvalidTokenError):
        decode_jwt("not.a.valid.token")


def test_jwt_with_wrong_secret(monkeypatch):
    token = create_jwt(1, "test@example.com")
    # Change the secret
    monkeypatch.setenv("JAM_JWT_SECRET", "different-secret")
    reset_config()

    with pytest.raises(jwt.InvalidSignatureError):
        decode_jwt(token)


def test_create_jwt_without_secret(monkeypatch):
    monkeypatch.setenv("JAM_JWT_SECRET", "")
    reset_config()

    with pytest.raises(RuntimeError, match="JAM_JWT_SECRET"):
        create_jwt(1, "test@example.com")
