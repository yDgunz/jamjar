"""Authentication utilities: password hashing and JWT tokens."""

from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from jam_session_processor.config import get_config

_ALGORITHM = "HS256"
_TOKEN_EXPIRY_DAYS = 7


# bcrypt only uses the first 72 bytes of a password. bcrypt<5 truncated silently;
# bcrypt>=5 raises ValueError instead. Truncate explicitly so long passwords work
# and hashes created under the old silent truncation still verify.
_BCRYPT_MAX_BYTES = 72


def _pw_bytes(password: str) -> bytes:
    return password.encode()[:_BCRYPT_MAX_BYTES]


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    return bcrypt.hashpw(_pw_bytes(password), bcrypt.gensalt()).decode()


def verify_password(password: str, password_hash: str) -> bool:
    """Verify a password against a bcrypt hash."""
    try:
        return bcrypt.checkpw(_pw_bytes(password), password_hash.encode())
    except ValueError:
        # Malformed hash
        return False


# Used to spend equivalent bcrypt time when a login targets an unknown user,
# so response timing doesn't reveal which emails have accounts.
_DUMMY_HASH = bcrypt.hashpw(b"timing-equalizer", bcrypt.gensalt()).decode()


def burn_password_check(password: str) -> None:
    verify_password(password, _DUMMY_HASH)


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
