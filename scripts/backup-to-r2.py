#!/usr/bin/env python3
"""Upload a backup file to Cloudflare R2.

Uses the same JAM_R2_* environment variables as the main application.
Stores backups under a `backups/` prefix in the bucket.

Usage:
    python scripts/backup-to-r2.py /path/to/backup.db.gz
"""

import os
import sys
from pathlib import Path

import boto3
from botocore.config import Config as BotoConfig


def upload_backup(file_path: str) -> None:
    path = Path(file_path)
    if not path.exists():
        print(f"ERROR: File not found: {path}", file=sys.stderr)
        sys.exit(1)

    account_id = os.environ.get("JAM_R2_ACCOUNT_ID", "")
    access_key = os.environ.get("JAM_R2_ACCESS_KEY_ID", "")
    secret_key = os.environ.get("JAM_R2_SECRET_ACCESS_KEY", "")
    bucket = os.environ.get("JAM_R2_BUCKET", "")

    if not all([account_id, access_key, secret_key, bucket]):
        print(
            "ERROR: R2 env vars not set (need JAM_R2_ACCOUNT_ID,"
            " JAM_R2_ACCESS_KEY_ID, JAM_R2_SECRET_ACCESS_KEY, JAM_R2_BUCKET)",
            file=sys.stderr,
        )
        sys.exit(1)

    client = boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
        config=BotoConfig(signature_version="s3v4"),
    )

    key = f"backups/{path.name}"
    client.upload_file(str(path), bucket, key)
    print(f"Uploaded {path.name} to R2 bucket {bucket} key {key}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: {sys.argv[0]} <backup-file>", file=sys.stderr)
        sys.exit(1)
    upload_backup(sys.argv[1])
