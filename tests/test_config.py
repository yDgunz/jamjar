from pathlib import Path

import pytest

from jam_session_processor.config import Config, get_config, reset_config


@pytest.fixture(autouse=True)
def _clean_config():
    """Reset the config singleton before and after each test."""
    reset_config()
    yield
    reset_config()


def test_defaults_match_current_behavior(monkeypatch, tmp_path):
    monkeypatch.delenv("JAM_DATA_DIR", raising=False)
    monkeypatch.delenv("JAM_DB_PATH", raising=False)
    monkeypatch.delenv("JAM_INPUT_DIR", raising=False)
    monkeypatch.delenv("JAM_OUTPUT_DIR", raising=False)
    monkeypatch.delenv("JAM_CORS_ORIGINS", raising=False)
    monkeypatch.delenv("JAM_PORT", raising=False)
    monkeypatch.chdir(tmp_path)

    cfg = get_config()
    assert cfg.data_dir == tmp_path
    assert cfg.db_path == tmp_path / "jam_sessions.db"
    assert cfg.input_dir == tmp_path / "input"
    assert cfg.output_dir == tmp_path / "output"
    assert cfg.cors_origins == ["http://localhost:5173"]
    assert cfg.port == 8000


def test_custom_env_vars(monkeypatch, tmp_path):
    monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("JAM_DB_PATH", "mydb.sqlite")
    monkeypatch.setenv("JAM_INPUT_DIR", "uploads")
    monkeypatch.setenv("JAM_OUTPUT_DIR", "exports")
    monkeypatch.setenv("JAM_CORS_ORIGINS", "http://localhost:3000,https://example.com")
    monkeypatch.setenv("JAM_PORT", "9000")

    cfg = get_config()
    assert cfg.data_dir == tmp_path
    assert cfg.db_path == tmp_path / "mydb.sqlite"
    assert cfg.input_dir == tmp_path / "uploads"
    assert cfg.output_dir == tmp_path / "exports"
    assert cfg.cors_origins == ["http://localhost:3000", "https://example.com"]
    assert cfg.port == 9000


def test_absolute_paths_override_data_dir(monkeypatch, tmp_path):
    other = tmp_path / "other"
    other.mkdir()
    monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("JAM_DB_PATH", str(other / "custom.db"))

    cfg = get_config()
    assert cfg.db_path == other / "custom.db"


def test_resolve_path_relative(tmp_path):
    cfg = Config(
        data_dir=tmp_path,
        db_path=tmp_path / "db.sqlite",
        input_dir=tmp_path / "input",
        output_dir=tmp_path / "output",
        cors_origins=["http://localhost:5173"],
        port=8000,
        max_upload_mb=500,
    )
    assert cfg.resolve_path("output/session/track.ogg") == tmp_path / "output/session/track.ogg"


def test_resolve_path_absolute(tmp_path):
    cfg = Config(
        data_dir=tmp_path,
        db_path=tmp_path / "db.sqlite",
        input_dir=tmp_path / "input",
        output_dir=tmp_path / "output",
        cors_origins=["http://localhost:5173"],
        port=8000,
        max_upload_mb=500,
    )
    abs_path = "/some/absolute/path.ogg"
    assert cfg.resolve_path(abs_path) == Path(abs_path)


def test_make_relative_inside_data_dir(tmp_path):
    cfg = Config(
        data_dir=tmp_path,
        db_path=tmp_path / "db.sqlite",
        input_dir=tmp_path / "input",
        output_dir=tmp_path / "output",
        cors_origins=["http://localhost:5173"],
        port=8000,
        max_upload_mb=500,
    )
    absolute = tmp_path / "output" / "session" / "track.ogg"
    assert cfg.make_relative(absolute) == "output/session/track.ogg"


def test_make_relative_outside_data_dir(tmp_path):
    cfg = Config(
        data_dir=tmp_path / "data",
        db_path=tmp_path / "data" / "db.sqlite",
        input_dir=tmp_path / "data" / "input",
        output_dir=tmp_path / "data" / "output",
        cors_origins=["http://localhost:5173"],
        port=8000,
        max_upload_mb=500,
    )
    outside = tmp_path / "elsewhere" / "file.ogg"
    assert cfg.make_relative(outside) == str(outside)


def test_output_dir_for_source(tmp_path):
    cfg = Config(
        data_dir=tmp_path,
        db_path=tmp_path / "db.sqlite",
        input_dir=tmp_path / "input",
        output_dir=tmp_path / "output",
        cors_origins=["http://localhost:5173"],
        port=8000,
        max_upload_mb=500,
    )
    assert cfg.output_dir_for_source("my-session") == tmp_path / "output" / "my-session"


def test_reset_clears_singleton(monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("JAM_PORT", raising=False)

    cfg1 = get_config()
    assert cfg1.port == 8000

    monkeypatch.setenv("JAM_PORT", "9999")
    reset_config()

    cfg2 = get_config()
    assert cfg2.port == 9999
    assert cfg1 is not cfg2
