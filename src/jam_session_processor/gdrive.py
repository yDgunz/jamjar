"""Read-only Google Drive access through a service account.

People share a Drive folder with the service account's email address; JamJar
then lists the folder's audio files and downloads them for import. Configure
with JAM_GOOGLE_SERVICE_ACCOUNT: the service account's JSON key, given as raw
JSON, base64-encoded JSON, or a path to the key file.
"""

import base64
import json
import logging
import re
import threading
import time
from pathlib import Path

import jwt
import requests

from jam_session_processor.config import get_config

logger = logging.getLogger(__name__)

TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://www.googleapis.com/drive/v3"
SCOPE = "https://www.googleapis.com/auth/drive.readonly"
FOLDER_MIME = "application/vnd.google-apps.folder"
AUDIO_EXTS = {".m4a", ".wav", ".mp3", ".flac", ".ogg"}
_FILE_FIELDS = "id,name,mimeType,size,createdTime,modifiedTime,parents"


class DriveError(Exception):
    """A Drive API call failed. `status` is the HTTP status (0 for transport errors)."""

    def __init__(self, message: str, status: int = 0):
        super().__init__(message)
        self.status = status


def parse_folder_id(url_or_id: str) -> str | None:
    """Pull a folder ID out of a Drive folder URL, or accept a bare ID."""
    s = url_or_id.strip()
    m = re.search(r"/folders/([A-Za-z0-9_-]{10,})", s) or re.search(
        r"[?&]id=([A-Za-z0-9_-]{10,})", s
    )
    if m:
        return m.group(1)
    if re.fullmatch(r"[A-Za-z0-9_-]{10,}", s):
        return s
    return None


def _load_key(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("{"):
        return json.loads(raw)
    path = Path(raw)
    if len(raw) < 1024 and path.is_file():
        return json.loads(path.read_text())
    return json.loads(base64.b64decode(raw))


class DriveClient:
    def __init__(self, key: dict):
        self.email: str = key["client_email"]
        self._private_key: str = key["private_key"]
        self._token: str | None = None
        self._token_exp = 0.0
        self._lock = threading.Lock()

    def _access_token(self) -> str:
        with self._lock:
            if self._token and time.time() < self._token_exp - 60:
                return self._token
            now = int(time.time())
            assertion = jwt.encode(
                {
                    "iss": self.email,
                    "scope": SCOPE,
                    "aud": TOKEN_URL,
                    "iat": now,
                    "exp": now + 3600,
                },
                self._private_key,
                algorithm="RS256",
            )
            try:
                resp = requests.post(
                    TOKEN_URL,
                    data={
                        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
                        "assertion": assertion,
                    },
                    timeout=20,
                )
            except requests.RequestException as e:
                raise DriveError(f"Could not reach Google: {e}")
            if resp.status_code != 200:
                raise DriveError(f"Google sign-in failed: {resp.text[:200]}", resp.status_code)
            body = resp.json()
            self._token = body["access_token"]
            self._token_exp = time.time() + int(body.get("expires_in", 3600))
            return self._token

    def _get(self, path: str, params: dict | None = None, stream: bool = False):
        params = {**(params or {}), "supportsAllDrives": "true"}
        try:
            resp = requests.get(
                f"{API}{path}",
                params=params,
                headers={"Authorization": f"Bearer {self._access_token()}"},
                timeout=60,
                stream=stream,
            )
        except requests.RequestException as e:
            raise DriveError(f"Could not reach Google Drive: {e}")
        if resp.status_code != 200:
            msg = resp.text[:300] if not stream else resp.reason
            raise DriveError(f"Google Drive error {resp.status_code}: {msg}", resp.status_code)
        return resp

    def get_file(self, file_id: str) -> dict:
        return self._get(f"/files/{file_id}", {"fields": _FILE_FIELDS}).json()

    def _children(self, folder_id: str) -> list[dict]:
        out, token = [], None
        while True:
            params = {
                "q": f"'{folder_id}' in parents and trashed = false",
                "fields": f"nextPageToken,files({_FILE_FIELDS})",
                "pageSize": "1000",
                "includeItemsFromAllDrives": "true",
            }
            if token:
                params["pageToken"] = token
            body = self._get("/files", params).json()
            out.extend(body.get("files", []))
            token = body.get("nextPageToken")
            if not token:
                return out

    def list_audio(self, folder_id: str, max_depth: int = 3) -> list[dict]:
        """Audio files in a folder and its subfolders. Each gets a `path` of subfolder names."""
        found: list[dict] = []
        queue: list[tuple[str, list[str], int]] = [(folder_id, [], 0)]
        while queue:
            fid, path, depth = queue.pop(0)
            for f in self._children(fid):
                if f.get("mimeType") == FOLDER_MIME:
                    if depth < max_depth:
                        queue.append((f["id"], [*path, f["name"]], depth + 1))
                    continue
                name = f.get("name", "")
                is_audio = f.get("mimeType", "").startswith("audio/")
                if (is_audio or Path(name).suffix.lower() in AUDIO_EXTS) and not name.startswith(
                    "._"
                ):
                    found.append({**f, "path": path, "size": int(f.get("size") or 0)})
        return found

    def download(self, file_id: str, dest: Path, on_progress=None) -> int:
        """Stream a file's bytes to `dest`. Returns the number of bytes written."""
        resp = self._get(f"/files/{file_id}", {"alt": "media"}, stream=True)
        dest.parent.mkdir(parents=True, exist_ok=True)
        written = 0
        with open(dest, "wb") as f:
            for chunk in resp.iter_content(chunk_size=1024 * 1024):
                f.write(chunk)
                written += len(chunk)
                if on_progress:
                    on_progress(written)
        return written


_client: DriveClient | None = None
_client_loaded = False


def get_drive_client() -> DriveClient | None:
    """The configured Drive client, or None when no service account is set up."""
    global _client, _client_loaded
    if not _client_loaded:
        raw = get_config().google_service_account
        if raw:
            try:
                _client = DriveClient(_load_key(raw))
            except Exception:
                logger.error("JAM_GOOGLE_SERVICE_ACCOUNT is set but could not be parsed")
                _client = None
        _client_loaded = True
    return _client


def reset_drive_client() -> None:
    global _client, _client_loaded
    _client = None
    _client_loaded = False
