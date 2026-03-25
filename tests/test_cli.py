"""Tests for CLI commands in cli.py using Click's CliRunner."""

from unittest.mock import patch

import pytest
from click.testing import CliRunner

from jam_session_processor.auth import hash_password, verify_password
from jam_session_processor.cli import cli
from jam_session_processor.config import reset_config
from jam_session_processor.db import Database


@pytest.fixture
def db(tmp_path, monkeypatch):
    """Create a temp database and patch _get_db to return it.

    The CLI commands call db.close() after each invocation, which would
    close the shared connection. We patch close() to be a no-op so
    the test can still query the database after running a command.
    """
    monkeypatch.setenv("JAM_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("JAM_JWT_SECRET", "test-secret")
    monkeypatch.delenv("JAM_R2_BUCKET", raising=False)
    monkeypatch.delenv("JAM_SMTP_HOST", raising=False)
    reset_config()

    db_path = tmp_path / "test_cli.db"
    database = Database(db_path)
    real_close = database.close
    database.close = lambda: None  # no-op so CLI doesn't close our connection
    with patch("jam_session_processor.cli._get_db", return_value=database):
        yield database
    real_close()
    reset_config()


@pytest.fixture
def runner():
    return CliRunner()


# --- add-group ---


def test_add_group(runner, db):
    result = runner.invoke(cli, ["add-group", "MyBand"])
    assert result.exit_code == 0
    assert "Created group 'MyBand'" in result.output

    group = db.get_group_by_name("MyBand")
    assert group is not None
    assert group.name == "MyBand"


def test_add_group_duplicate(runner, db):
    db.create_group("MyBand")
    result = runner.invoke(cli, ["add-group", "MyBand"])
    assert result.exit_code != 0
    assert "already exists" in result.output


# --- add-user ---


def test_add_user_with_password(runner, db):
    result = runner.invoke(
        cli,
        ["add-user", "alice@example.com", "--password", "--name", "Alice"],
        input="secret123\nsecret123\n",
    )
    assert result.exit_code == 0
    assert "Created user 'alice@example.com'" in result.output
    assert "role=editor" in result.output

    user = db.get_user_by_email("alice@example.com")
    assert user is not None
    assert user.name == "Alice"
    assert verify_password("secret123", user.password_hash)


def test_add_user_with_role(runner, db):
    result = runner.invoke(
        cli,
        ["add-user", "bob@example.com", "--password", "--role", "admin"],
        input="pass1234\npass1234\n",
    )
    assert result.exit_code == 0
    assert "role=admin" in result.output

    user = db.get_user_by_email("bob@example.com")
    assert user.role == "admin"


def test_add_user_duplicate_email(runner, db):
    db.create_user("alice@example.com", hash_password("pw"), name="Alice")
    result = runner.invoke(
        cli,
        ["add-user", "alice@example.com", "--password"],
        input="newpw\nnewpw\n",
    )
    assert result.exit_code != 0
    assert "already exists" in result.output


def test_add_user_with_group(runner, db):
    db.create_group("Rockers")
    result = runner.invoke(
        cli,
        ["add-user", "carol@example.com", "--password", "-g", "Rockers"],
        input="pass1234\npass1234\n",
    )
    assert result.exit_code == 0
    assert "groups: Rockers" in result.output

    user = db.get_user_by_email("carol@example.com")
    groups = db.get_user_groups(user.id)
    assert len(groups) == 1
    assert groups[0].name == "Rockers"


def test_add_user_with_nonexistent_group(runner, db):
    result = runner.invoke(
        cli,
        ["add-user", "dan@example.com", "--password", "-g", "NoSuchBand"],
        input="pass1234\npass1234\n",
    )
    assert result.exit_code != 0
    assert "Group 'NoSuchBand' not found" in result.output


def test_add_user_invite_no_smtp(runner, db):
    """Without --password and no SMTP, should create user and show invite link."""
    result = runner.invoke(cli, ["add-user", "eve@example.com", "--name", "Eve"])
    assert result.exit_code == 0
    assert "Created user 'eve@example.com'" in result.output
    assert "invite" in result.output.lower()


# --- assign-user / remove-user ---


def test_assign_user(runner, db):
    uid = db.create_user("alice@example.com", hash_password("pw"))
    db.create_group("Band1")

    result = runner.invoke(cli, ["assign-user", "alice@example.com", "Band1"])
    assert result.exit_code == 0
    assert "Assigned 'alice@example.com' to group 'Band1'" in result.output

    groups = db.get_user_groups(uid)
    assert any(g.name == "Band1" for g in groups)


def test_assign_user_nonexistent_user(runner, db):
    db.create_group("Band1")
    result = runner.invoke(cli, ["assign-user", "nobody@example.com", "Band1"])
    assert result.exit_code != 0
    assert "User 'nobody@example.com' not found" in result.output


def test_assign_user_nonexistent_group(runner, db):
    db.create_user("alice@example.com", hash_password("pw"))
    result = runner.invoke(cli, ["assign-user", "alice@example.com", "NoGroup"])
    assert result.exit_code != 0
    assert "Group 'NoGroup' not found" in result.output


def test_remove_user(runner, db):
    uid = db.create_user("alice@example.com", hash_password("pw"))
    gid = db.create_group("Band1")
    db.assign_user_to_group(uid, gid)

    result = runner.invoke(cli, ["remove-user", "alice@example.com", "Band1"])
    assert result.exit_code == 0
    assert "Removed 'alice@example.com' from group 'Band1'" in result.output

    groups = db.get_user_groups(uid)
    assert not any(g.name == "Band1" for g in groups)


def test_remove_user_nonexistent_user(runner, db):
    db.create_group("Band1")
    result = runner.invoke(cli, ["remove-user", "nobody@example.com", "Band1"])
    assert result.exit_code != 0
    assert "User 'nobody@example.com' not found" in result.output


def test_remove_user_nonexistent_group(runner, db):
    db.create_user("alice@example.com", hash_password("pw"))
    result = runner.invoke(cli, ["remove-user", "alice@example.com", "NoGroup"])
    assert result.exit_code != 0
    assert "Group 'NoGroup' not found" in result.output


# --- list-users ---


def test_list_users_empty(runner, db):
    result = runner.invoke(cli, ["list-users"])
    assert result.exit_code == 0
    assert "No users." in result.output


def test_list_users(runner, db):
    uid = db.create_user("alice@example.com", hash_password("pw"), name="Alice", role="admin")
    gid = db.create_group("Band1")
    db.assign_user_to_group(uid, gid)

    result = runner.invoke(cli, ["list-users"])
    assert result.exit_code == 0
    assert "alice@example.com" in result.output
    assert "(Alice)" in result.output
    assert "[admin]" in result.output
    assert "Band1" in result.output


def test_list_users_no_groups(runner, db):
    db.create_user("bob@example.com", hash_password("pw"))
    result = runner.invoke(cli, ["list-users"])
    assert result.exit_code == 0
    assert "bob@example.com" in result.output
    assert "(no groups)" in result.output


# --- list-groups ---


def test_list_groups_empty(runner, db):
    result = runner.invoke(cli, ["list-groups"])
    assert result.exit_code == 0
    assert "No groups." in result.output


def test_list_groups(runner, db):
    db.create_group("Band1")
    db.create_group("Band2")

    result = runner.invoke(cli, ["list-groups"])
    assert result.exit_code == 0
    assert "Band1" in result.output
    assert "Band2" in result.output


# --- reset-password ---


def test_reset_password(runner, db):
    db.create_user("alice@example.com", hash_password("oldpw"))

    result = runner.invoke(
        cli,
        ["reset-password", "alice@example.com"],
        input="newpw123\nnewpw123\n",
    )
    assert result.exit_code == 0
    assert "Password updated for 'alice@example.com'" in result.output

    user = db.get_user_by_email("alice@example.com")
    assert verify_password("newpw123", user.password_hash)


def test_reset_password_nonexistent_user(runner, db):
    result = runner.invoke(
        cli,
        ["reset-password", "nobody@example.com"],
        input="newpw\nnewpw\n",
    )
    assert result.exit_code != 0
    assert "User 'nobody@example.com' not found" in result.output


# --- set-role ---


def test_set_role(runner, db):
    db.create_user("alice@example.com", hash_password("pw"), role="editor")

    result = runner.invoke(cli, ["set-role", "alice@example.com", "admin"])
    assert result.exit_code == 0
    assert "Updated 'alice@example.com' role to 'admin'" in result.output

    user = db.get_user_by_email("alice@example.com")
    assert user.role == "admin"


def test_set_role_all_transitions(runner, db):
    """Test transitioning through all valid roles."""
    db.create_user("alice@example.com", hash_password("pw"), role="editor")

    for role in ["readonly", "admin", "superadmin", "editor"]:
        result = runner.invoke(cli, ["set-role", "alice@example.com", role])
        assert result.exit_code == 0
        user = db.get_user_by_email("alice@example.com")
        assert user.role == role


def test_set_role_invalid(runner, db):
    db.create_user("alice@example.com", hash_password("pw"))
    result = runner.invoke(cli, ["set-role", "alice@example.com", "megaadmin"])
    assert result.exit_code != 0


def test_set_role_nonexistent_user(runner, db):
    result = runner.invoke(cli, ["set-role", "nobody@example.com", "admin"])
    assert result.exit_code != 0
    assert "User 'nobody@example.com' not found" in result.output


# --- reset-db ---


def test_reset_db_confirmed(runner, db):
    # Seed some data
    db.create_user("alice@example.com", hash_password("pw"))
    db.create_group("Band1")

    result = runner.invoke(cli, ["reset-db"], input="y\n")
    assert result.exit_code == 0
    assert "Database reset complete." in result.output

    # Data should be gone
    assert db.get_user_by_email("alice@example.com") is None
    assert db.get_group_by_name("Band1") is None


def test_reset_db_aborted(runner, db):
    db.create_user("alice@example.com", hash_password("pw"))

    result = runner.invoke(cli, ["reset-db"], input="n\n")
    assert result.exit_code == 0
    assert "Aborted." in result.output

    # Data should still exist
    assert db.get_user_by_email("alice@example.com") is not None
