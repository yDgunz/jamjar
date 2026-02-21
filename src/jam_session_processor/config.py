"""Application configuration from environment variables.

All paths default to cwd-relative values matching pre-config behavior.
"""

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()


@dataclass(frozen=True)
class Config:
    data_dir: Path
    db_path: Path
    input_dir: Path
    output_dir: Path
    cors_origins: list[str]
    port: int
    max_upload_mb: int
    jwt_secret: str
    api_key: str
    r2_account_id: str
    r2_access_key_id: str
    r2_secret_access_key: str
    r2_bucket: str
    r2_custom_domain: str

    def resolve_path(self, stored: str) -> Path:
        """Resolve a stored path to absolute.

        If the path is already absolute, return as-is.
        Otherwise, resolve relative to data_dir.
        """
        p = Path(stored)
        if p.is_absolute():
            return p
        return self.data_dir / p

    def make_relative(self, absolute: Path) -> str:
        """Convert an absolute path to a string relative to data_dir.

        If the path is not inside data_dir, return it as-is.
        """
        try:
            return str(absolute.relative_to(self.data_dir))
        except ValueError:
            return str(absolute)

    def output_dir_for_source(self, stem: str) -> Path:
        """Return the output subdirectory for a given source file stem."""
        return self.output_dir / stem


def _build_config() -> Config:
    data_dir = Path(os.environ.get("JAM_DATA_DIR", ".")).resolve()

    def _resolve(env_var: str, default: str) -> Path:
        raw = os.environ.get(env_var, default)
        p = Path(raw)
        if p.is_absolute():
            return p
        return data_dir / p

    return Config(
        data_dir=data_dir,
        db_path=_resolve("JAM_DB_PATH", "jam_sessions.db"),
        input_dir=_resolve("JAM_INPUT_DIR", "recordings"),
        output_dir=_resolve("JAM_OUTPUT_DIR", "tracks"),
        cors_origins=[
            o.strip()
            for o in os.environ.get("JAM_CORS_ORIGINS", "http://localhost:5173").split(",")
            if o.strip()
        ],
        port=int(os.environ.get("JAM_PORT", "8000")),
        max_upload_mb=int(os.environ.get("JAM_MAX_UPLOAD_MB", "500")),
        jwt_secret=os.environ.get("JAM_JWT_SECRET", ""),
        api_key=os.environ.get("JAM_API_KEY", ""),
        r2_account_id=os.environ.get("JAM_R2_ACCOUNT_ID", ""),
        r2_access_key_id=os.environ.get("JAM_R2_ACCESS_KEY_ID", ""),
        r2_secret_access_key=os.environ.get("JAM_R2_SECRET_ACCESS_KEY", ""),
        r2_bucket=os.environ.get("JAM_R2_BUCKET", ""),
        r2_custom_domain=os.environ.get("JAM_R2_CUSTOM_DOMAIN", ""),
    )


_config: Config | None = None


def get_config() -> Config:
    """Return the module-level Config singleton, building it on first call."""
    global _config
    if _config is None:
        _config = _build_config()
    return _config


def reset_config() -> None:
    """Clear the singleton so the next get_config() re-reads env vars."""
    global _config
    _config = None
