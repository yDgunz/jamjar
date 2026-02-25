"""Storage abstraction for local filesystem and Cloudflare R2.

When JAM_R2_BUCKET is set, files are stored in R2 and served via presigned URLs.
Otherwise, files live on the local filesystem and are served by FastAPI directly.
"""

import logging
import mimetypes
from pathlib import Path
from typing import Protocol

import boto3
from botocore.config import Config as BotoConfig

from jam_session_processor.config import get_config

logger = logging.getLogger(__name__)


class Storage(Protocol):
    """Interface for file storage backends."""

    @property
    def is_remote(self) -> bool: ...

    def put(self, key: str, local_path: Path) -> None:
        """Upload a local file to storage. No-op for local backend."""
        ...

    def get(self, key: str, local_path: Path) -> Path:
        """Ensure file is available locally. Downloads from remote if needed."""
        ...

    def delete(self, key: str) -> None:
        """Remove a file from storage."""
        ...

    def rename(self, old_key: str, new_key: str) -> None:
        """Move/rename a file in storage."""
        ...

    def exists(self, key: str) -> bool:
        """Check if a file exists in storage."""
        ...

    def url(self, key: str) -> str | None:
        """Return a URL to access the file, or None for local backend."""
        ...

    def presigned_put_url(self, key: str, content_type: str, ttl: int = 900) -> str | None:
        """Return a presigned PUT URL for direct upload, or None for local backend."""
        ...


class LocalStorage:
    """Storage backend using the local filesystem.

    All operations resolve paths relative to the config data_dir.
    """

    @property
    def is_remote(self) -> bool:
        return False

    def put(self, key: str, local_path: Path) -> None:
        # No-op: file is already on local disk
        pass

    def get(self, key: str, local_path: Path) -> Path:
        cfg = get_config()
        return cfg.resolve_path(key)

    def delete(self, key: str) -> None:
        cfg = get_config()
        try:
            cfg.resolve_path(key).unlink(missing_ok=True)
        except OSError:
            pass

    def rename(self, old_key: str, new_key: str) -> None:
        cfg = get_config()
        old_path = cfg.resolve_path(old_key)
        new_path = cfg.resolve_path(new_key)
        if old_path.exists() and old_path != new_path:
            old_path.rename(new_path)

    def exists(self, key: str) -> bool:
        cfg = get_config()
        return cfg.resolve_path(key).exists()

    def url(self, key: str) -> str | None:
        return None

    def presigned_put_url(self, key: str, content_type: str, ttl: int = 900) -> str | None:
        return None


class R2Storage:
    """Storage backend using Cloudflare R2 (S3-compatible).

    Files are uploaded/downloaded via boto3. Audio serving uses presigned URLs
    so the browser fetches directly from R2.
    """

    PRESIGN_TTL = 3600  # 1 hour

    def __init__(self):
        cfg = get_config()
        self._bucket = cfg.r2_bucket
        self._custom_domain = cfg.r2_custom_domain
        self._client = boto3.client(
            "s3",
            endpoint_url=f"https://{cfg.r2_account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=cfg.r2_access_key_id,
            aws_secret_access_key=cfg.r2_secret_access_key,
            region_name="auto",
            config=BotoConfig(signature_version="s3v4"),
        )

    @property
    def is_remote(self) -> bool:
        return True

    def put(self, key: str, local_path: Path) -> None:
        content_type = mimetypes.guess_type(str(local_path))[0] or "application/octet-stream"
        self._client.upload_file(
            str(local_path),
            self._bucket,
            key,
            ExtraArgs={"ContentType": content_type},
        )
        logger.info("Uploaded %s to R2 key %s", local_path.name, key)

    def get(self, key: str, local_path: Path) -> Path:
        if local_path.exists():
            return local_path
        local_path.parent.mkdir(parents=True, exist_ok=True)
        self._client.download_file(self._bucket, key, str(local_path))
        logger.info("Downloaded R2 key %s to %s", key, local_path)
        return local_path

    def delete(self, key: str) -> None:
        try:
            self._client.delete_object(Bucket=self._bucket, Key=key)
            logger.info("Deleted R2 key %s", key)
        except Exception:
            logger.warning("Failed to delete R2 key %s", key, exc_info=True)
        # Also clean up local copy if present
        cfg = get_config()
        try:
            cfg.resolve_path(key).unlink(missing_ok=True)
        except OSError:
            pass

    def rename(self, old_key: str, new_key: str) -> None:
        self._client.copy_object(
            Bucket=self._bucket,
            CopySource={"Bucket": self._bucket, "Key": old_key},
            Key=new_key,
        )
        self._client.delete_object(Bucket=self._bucket, Key=old_key)
        # Also rename local copy if present
        cfg = get_config()
        old_path = cfg.resolve_path(old_key)
        new_path = cfg.resolve_path(new_key)
        if old_path.exists() and old_path != new_path:
            old_path.rename(new_path)

    def exists(self, key: str) -> bool:
        try:
            self._client.head_object(Bucket=self._bucket, Key=key)
            return True
        except Exception:
            return False

    def url(self, key: str) -> str | None:
        if self._custom_domain:
            from urllib.parse import quote

            return f"https://{self._custom_domain}/{quote(key)}"
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": self._bucket, "Key": key},
            ExpiresIn=self.PRESIGN_TTL,
        )

    def presigned_put_url(self, key: str, content_type: str, ttl: int = 900) -> str | None:
        return self._client.generate_presigned_url(
            "put_object",
            Params={
                "Bucket": self._bucket,
                "Key": key,
                "ContentType": content_type,
            },
            ExpiresIn=ttl,
        )


# --- Singleton ---

_storage: Storage | None = None


def get_storage() -> Storage:
    """Return the module-level Storage singleton.

    Returns R2Storage if JAM_R2_BUCKET is configured, else LocalStorage.
    """
    global _storage
    if _storage is None:
        cfg = get_config()
        if cfg.r2_enabled and cfg.r2_bucket:
            _storage = R2Storage()
        else:
            _storage = LocalStorage()
    return _storage


def reset_storage() -> None:
    """Clear the singleton so the next get_storage() re-creates it."""
    global _storage
    _storage = None
