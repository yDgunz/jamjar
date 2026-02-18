"""Authentication utilities: password hashing and JWT tokens."""

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from jam_session_processor.config import get_config

_ALGORITHM = "HS256"
_TOKEN_EXPIRY_DAYS = 7


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a password against a bcrypt hash."""
    return bcrypt.checkpw(password.encode(), password_hash.encode())


def create_jwt(user_id: int, email: str) -> str:
    """Create a signed JWT with user_id and email."""
    cfg = get_config()
    if not cfg.jwt_secret:
        raise RuntimeError("JAM_JWT_SECRET is not set")
    payload = {
        "sub": str(user_id),
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(days=_TOKEN_EXPIRY_DAYS),
    }
    return jwt.encode(payload, cfg.jwt_secret, algorithm=_ALGORITHM)


def decode_jwt(token: str) -> dict:
    """Decode and verify a JWT. Returns {"sub": user_id, "email": ...}.

    Raises jwt.ExpiredSignatureError or jwt.InvalidTokenError on failure.
    """
    cfg = get_config()
    if not cfg.jwt_secret:
        raise RuntimeError("JAM_JWT_SECRET is not set")
    return jwt.decode(token, cfg.jwt_secret, algorithms=[_ALGORITHM])
