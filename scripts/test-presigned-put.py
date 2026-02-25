#!/usr/bin/env python3
"""Quick test: generate a presigned PUT URL and try uploading a small file to R2."""

import sys
sys.path.insert(0, "src")

from jam_session_processor.config import get_config
from jam_session_processor.storage import R2Storage

cfg = get_config()
print(f"R2 bucket: {cfg.r2_bucket}")
print(f"R2 account: {cfg.r2_account_id}")
print(f"R2 enabled: {cfg.r2_enabled}")

storage = R2Storage()

key = "recordings/test-presigned.txt"
url = storage.presigned_put_url(key, "text/plain", ttl=300)
print(f"\nPresigned URL:\n{url}\n")

# Try the PUT
import requests

data = b"hello from presigned upload test"
resp = requests.put(url, data=data, headers={"Content-Type": "text/plain"})
print(f"Status: {resp.status_code}")
print(f"Headers: {dict(resp.headers)}")
print(f"Body: {resp.text}")

if resp.status_code < 300:
    print("\nSuccess! Cleaning up...")
    storage.delete(key)
    print("Deleted test object.")
else:
    print("\nFailed. Check the error above.")
