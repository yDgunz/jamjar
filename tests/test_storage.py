from unittest.mock import MagicMock, patch

import pytest

from jam_session_processor.config import reset_config
from jam_session_processor.storage import (
    LocalStorage,
    R2Storage,
    get_storage,
    reset_storage,
)


@pytest.fixture(autouse=True)
def _clean_singletons():
    reset_config()
    reset_storage()
    yield
    reset_config()
    reset_storage()


# --- LocalStorage tests ---


class TestLocalStorage:
    def test_is_not_remote(self):
        s = LocalStorage()
        assert s.is_remote is False

    def test_url_returns_none(self):
        s = LocalStorage()
        assert s.url("output/track.m4a") is None

    def test_put_is_noop(self, tmp_path):
        s = LocalStorage()
        local_file = tmp_path / "track.m4a"
        local_file.write_bytes(b"\x00" * 10)
        # Should not raise
        s.put("output/track.m4a", local_file)

    def test_get_returns_resolved_path(self, tmp_path, monkeypatch):
        monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
        reset_config()

        s = LocalStorage()
        result = s.get("output/track.m4a", tmp_path / "output" / "track.m4a")
        assert result == tmp_path / "output" / "track.m4a"

    def test_delete_removes_file(self, tmp_path, monkeypatch):
        monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
        reset_config()

        f = tmp_path / "output" / "track.m4a"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"\x00" * 10)
        assert f.exists()

        s = LocalStorage()
        s.delete("output/track.m4a")
        assert not f.exists()

    def test_delete_missing_file_no_error(self, tmp_path, monkeypatch):
        monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
        reset_config()

        s = LocalStorage()
        s.delete("output/nonexistent.m4a")  # Should not raise

    def test_rename_moves_file(self, tmp_path, monkeypatch):
        monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
        reset_config()

        old = tmp_path / "output" / "old.m4a"
        new = tmp_path / "output" / "new.m4a"
        old.parent.mkdir(parents=True, exist_ok=True)
        old.write_bytes(b"\x00" * 10)

        s = LocalStorage()
        s.rename("output/old.m4a", "output/new.m4a")
        assert not old.exists()
        assert new.exists()

    def test_rename_missing_file_no_error(self, tmp_path, monkeypatch):
        monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
        reset_config()

        s = LocalStorage()
        s.rename("output/missing.m4a", "output/new.m4a")  # Should not raise

    def test_exists(self, tmp_path, monkeypatch):
        monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
        reset_config()

        f = tmp_path / "output" / "track.m4a"
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_bytes(b"\x00" * 10)

        s = LocalStorage()
        assert s.exists("output/track.m4a") is True
        assert s.exists("output/missing.m4a") is False


# --- R2Storage tests ---


class TestR2Storage:
    @pytest.fixture
    def mock_boto3(self, tmp_path, monkeypatch):
        monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
        monkeypatch.setenv("JAM_R2_ACCOUNT_ID", "test-account")
        monkeypatch.setenv("JAM_R2_ACCESS_KEY_ID", "test-key")
        monkeypatch.setenv("JAM_R2_SECRET_ACCESS_KEY", "test-secret")
        monkeypatch.setenv("JAM_R2_BUCKET", "test-bucket")
        reset_config()

        mock_client = MagicMock()
        with patch("jam_session_processor.storage.boto3") as mock_boto:
            mock_boto.client.return_value = mock_client
            yield mock_client

    def test_is_remote(self, mock_boto3):
        s = R2Storage()
        assert s.is_remote is True

    def test_constructor_creates_s3_client(self, tmp_path, monkeypatch):
        monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
        monkeypatch.setenv("JAM_R2_ACCOUNT_ID", "acct123")
        monkeypatch.setenv("JAM_R2_ACCESS_KEY_ID", "key123")
        monkeypatch.setenv("JAM_R2_SECRET_ACCESS_KEY", "secret123")
        monkeypatch.setenv("JAM_R2_BUCKET", "mybucket")
        reset_config()

        with patch("jam_session_processor.storage.boto3") as mock_boto:
            R2Storage()
            mock_boto.client.assert_called_once_with(
                "s3",
                endpoint_url="https://acct123.r2.cloudflarestorage.com",
                aws_access_key_id="key123",
                aws_secret_access_key="secret123",
                region_name="auto",
            )

    def test_put_uploads_file(self, mock_boto3, tmp_path):
        import mimetypes

        s = R2Storage()
        local_file = tmp_path / "track.m4a"
        local_file.write_bytes(b"\x00" * 10)

        s.put("output/track.m4a", local_file)

        expected_type = mimetypes.guess_type("track.m4a")[0] or "application/octet-stream"
        mock_boto3.upload_file.assert_called_once_with(
            str(local_file),
            "test-bucket",
            "output/track.m4a",
            ExtraArgs={"ContentType": expected_type},
        )

    def test_get_downloads_if_missing(self, mock_boto3, tmp_path):
        s = R2Storage()
        local_path = tmp_path / "output" / "track.m4a"

        s.get("output/track.m4a", local_path)

        mock_boto3.download_file.assert_called_once_with(
            "test-bucket", "output/track.m4a", str(local_path)
        )

    def test_get_skips_download_if_exists(self, mock_boto3, tmp_path):
        s = R2Storage()
        local_path = tmp_path / "output" / "track.m4a"
        local_path.parent.mkdir(parents=True, exist_ok=True)
        local_path.write_bytes(b"\x00" * 10)

        result = s.get("output/track.m4a", local_path)

        assert result == local_path
        mock_boto3.download_file.assert_not_called()

    def test_delete_calls_delete_object(self, mock_boto3):
        s = R2Storage()
        s.delete("output/track.m4a")

        mock_boto3.delete_object.assert_called_once_with(
            Bucket="test-bucket", Key="output/track.m4a"
        )

    def test_rename_copies_then_deletes(self, mock_boto3):
        s = R2Storage()
        s.rename("output/old.m4a", "output/new.m4a")

        mock_boto3.copy_object.assert_called_once_with(
            Bucket="test-bucket",
            CopySource={"Bucket": "test-bucket", "Key": "output/old.m4a"},
            Key="output/new.m4a",
        )
        mock_boto3.delete_object.assert_called_once_with(
            Bucket="test-bucket", Key="output/old.m4a"
        )

    def test_exists_true(self, mock_boto3):
        s = R2Storage()
        assert s.exists("output/track.m4a") is True
        mock_boto3.head_object.assert_called_once_with(
            Bucket="test-bucket", Key="output/track.m4a"
        )

    def test_exists_false(self, mock_boto3):
        mock_boto3.head_object.side_effect = Exception("not found")
        s = R2Storage()
        assert s.exists("output/missing.m4a") is False

    def test_url_returns_presigned(self, mock_boto3):
        mock_boto3.generate_presigned_url.return_value = "https://r2.example.com/signed"
        s = R2Storage()
        url = s.url("output/track.m4a")

        assert url == "https://r2.example.com/signed"
        mock_boto3.generate_presigned_url.assert_called_once_with(
            "get_object",
            Params={"Bucket": "test-bucket", "Key": "output/track.m4a"},
            ExpiresIn=3600,
        )


# --- Singleton tests ---


class TestSingleton:
    def test_no_r2_env_returns_local(self, tmp_path, monkeypatch):
        monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
        monkeypatch.delenv("JAM_R2_BUCKET", raising=False)
        reset_config()

        storage = get_storage()
        assert isinstance(storage, LocalStorage)

    def test_r2_env_returns_r2(self, tmp_path, monkeypatch):
        monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
        monkeypatch.setenv("JAM_R2_ENABLED", "true")
        monkeypatch.setenv("JAM_R2_ACCOUNT_ID", "acct")
        monkeypatch.setenv("JAM_R2_ACCESS_KEY_ID", "key")
        monkeypatch.setenv("JAM_R2_SECRET_ACCESS_KEY", "secret")
        monkeypatch.setenv("JAM_R2_BUCKET", "bucket")
        reset_config()

        with patch("jam_session_processor.storage.boto3"):
            storage = get_storage()
        assert isinstance(storage, R2Storage)

    def test_singleton_is_cached(self, tmp_path, monkeypatch):
        monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
        monkeypatch.delenv("JAM_R2_BUCKET", raising=False)
        reset_config()

        s1 = get_storage()
        s2 = get_storage()
        assert s1 is s2

    def test_reset_clears_singleton(self, tmp_path, monkeypatch):
        monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
        monkeypatch.delenv("JAM_R2_BUCKET", raising=False)
        reset_config()

        s1 = get_storage()
        reset_storage()
        s2 = get_storage()
        assert s1 is not s2
