from pathlib import Path

import click

from jam_session_processor.config import get_config
from jam_session_processor.db import Database


def _get_db() -> Database:
    return Database()


@click.group()
def cli():
    """Jam session processor — admin CLI and server."""


@cli.command()
@click.option("-p", "--port", type=int, default=None, help="Port (default: JAM_PORT or 8000).")
@click.option("--reload", "use_reload", is_flag=True, help="Enable auto-reload for development.")
def serve(port: int | None, use_reload: bool):
    """Start the API server."""
    import uvicorn

    if port is None:
        port = get_config().port
    click.echo(f"Starting server on http://localhost:{port}")
    uvicorn.run(
        "jam_session_processor.api:app",
        host="0.0.0.0",
        port=port,
        reload=use_reload,
    )


UPLOAD_EXTENSIONS = {".m4a", ".wav", ".mp3", ".flac", ".ogg"}


@cli.command()
@click.argument("file", type=click.Path(exists=True, path_type=Path))
@click.option(
    "-s",
    "--server",
    required=True,
    help="Server URL (e.g. http://localhost:8000).",
)
@click.option(
    "-g",
    "--group",
    required=True,
    help="Group name to upload into.",
)
@click.option(
    "--api-key",
    envvar="JAM_API_KEY",
    required=True,
    help="API key for authentication (or set JAM_API_KEY env var).",
)
def upload(file: Path, server: str, group: str, api_key: str):
    """Upload an audio file to a remote server for processing."""
    import requests

    ext = file.suffix.lower()
    if ext not in UPLOAD_EXTENSIONS:
        allowed = ", ".join(sorted(UPLOAD_EXTENSIONS))
        click.echo(f"Error: Invalid file type '{ext}'. Allowed: {allowed}")
        raise SystemExit(1)

    base = server.rstrip("/")
    url = f"{base}/api/sessions/upload"
    file_size = file.stat().st_size
    size_mb = file_size / (1024 * 1024)
    click.echo(f"Uploading {file.name} ({size_mb:.1f} MB) to {server} (group: {group})...")

    # Resolve group name to group_id via the remote server
    headers = {"X-API-Key": api_key}
    try:
        groups_resp = requests.get(f"{base}/api/admin/groups", headers=headers, timeout=10)
    except requests.ConnectionError:
        click.echo(f"Error: Could not connect to {server}")
        raise SystemExit(1)
    if groups_resp.status_code != 200:
        click.echo(f"Error: Failed to fetch groups (status {groups_resp.status_code})")
        raise SystemExit(1)
    groups_data = groups_resp.json()
    matched = [g for g in groups_data if g["name"] == group]
    if not matched:
        available = ", ".join(g["name"] for g in groups_data)
        click.echo(f"Error: Group '{group}' not found on server. Available: {available}")
        raise SystemExit(1)
    group_id = matched[0]["id"]

    try:
        with open(file, "rb") as f:
            resp = requests.post(
                url,
                files={"file": (file.name, f)},
                headers=headers,
                params={"group_id": group_id},
                timeout=600,
            )
    except requests.ConnectionError:
        click.echo(f"Error: Could not connect to {server}")
        raise SystemExit(1)
    except requests.Timeout:
        click.echo("Error: Upload timed out (10 minutes)")
        raise SystemExit(1)

    if resp.status_code not in (200, 202):
        detail = ""
        try:
            detail = resp.json().get("detail", "")
        except Exception:
            pass
        msg = f"Error: Server returned {resp.status_code}"
        if detail:
            msg += f" — {detail}"
        click.echo(msg)
        raise SystemExit(1)

    data = resp.json()

    if resp.status_code == 202:
        # Async processing — poll job until complete
        import time

        job_id = data.get("id")
        session_id = data.get("session_id")
        click.echo(f"Uploaded. Session id={session_id}, processing (job {job_id})...")

        job_url = f"{base}/api/jobs/{job_id}"
        while True:
            time.sleep(3)
            try:
                job_resp = requests.get(job_url, headers=headers, timeout=10)
                job_data = job_resp.json()
            except Exception:
                click.echo("  Waiting...")
                continue

            status = job_data.get("status", "unknown")
            progress = job_data.get("progress", "")
            if progress:
                click.echo(f"  {status}: {progress}")
            else:
                click.echo(f"  {status}")

            if status == "completed":
                click.echo(f"Done. Session id={session_id}")
                break
            elif status == "failed":
                click.echo(f"Error: Processing failed — {job_data.get('error', 'unknown')}")
                raise SystemExit(1)
    else:
        click.echo(f"Session created (id={data['id']})")
        click.echo(f"  Date: {data.get('date') or 'unknown'}")
        click.echo(f"  Tracks: {data.get('track_count', 0)}")
        click.echo(f"  Source: {data.get('source_file', '')}")


# --- Admin commands ---


@cli.command("add-user")
@click.argument("email")
@click.option("--name", default="", help="Display name for the user.")
@click.option(
    "--role",
    type=click.Choice(["superadmin", "admin", "editor", "readonly"]),
    default="editor",
    help="User role (default: editor).",
)
def add_user(email: str, name: str, role: str):
    """Create a new user. Prompts for password."""
    from jam_session_processor.auth import hash_password

    password = click.prompt("Password", hide_input=True, confirmation_prompt=True)
    if not password:
        click.echo("Error: Password cannot be empty")
        raise SystemExit(1)

    db = _get_db()
    existing = db.get_user_by_email(email)
    if existing:
        click.echo(f"Error: User '{email}' already exists")
        db.close()
        raise SystemExit(1)

    user_id = db.create_user(email, hash_password(password), name=name, role=role)
    db.close()
    click.echo(f"Created user '{email}' (id={user_id}, role={role})")


@cli.command("add-group")
@click.argument("name")
def add_group(name: str):
    """Create a new group."""
    db = _get_db()
    existing = db.get_group_by_name(name)
    if existing:
        click.echo(f"Error: Group '{name}' already exists")
        db.close()
        raise SystemExit(1)

    group_id = db.create_group(name)
    db.close()
    click.echo(f"Created group '{name}' (id={group_id})")


@cli.command("assign-user")
@click.argument("email")
@click.argument("group_name")
def assign_user(email: str, group_name: str):
    """Add a user to a group."""
    db = _get_db()
    user = db.get_user_by_email(email)
    if not user:
        click.echo(f"Error: User '{email}' not found")
        db.close()
        raise SystemExit(1)

    group = db.get_group_by_name(group_name)
    if not group:
        click.echo(f"Error: Group '{group_name}' not found")
        db.close()
        raise SystemExit(1)

    db.assign_user_to_group(user.id, group.id)
    db.close()
    click.echo(f"Assigned '{email}' to group '{group_name}'")


@cli.command("remove-user")
@click.argument("email")
@click.argument("group_name")
def remove_user(email: str, group_name: str):
    """Remove a user from a group."""
    db = _get_db()
    user = db.get_user_by_email(email)
    if not user:
        click.echo(f"Error: User '{email}' not found")
        db.close()
        raise SystemExit(1)

    group = db.get_group_by_name(group_name)
    if not group:
        click.echo(f"Error: Group '{group_name}' not found")
        db.close()
        raise SystemExit(1)

    db.remove_user_from_group(user.id, group.id)
    db.close()
    click.echo(f"Removed '{email}' from group '{group_name}'")


@cli.command("list-users")
def list_users():
    """List all users and their group memberships."""
    db = _get_db()
    users = db.list_users()
    if not users:
        click.echo("No users.")
        db.close()
        return

    for u in users:
        groups = db.get_user_groups(u.id)
        group_names = ", ".join(g.name for g in groups) or "(no groups)"
        name_part = f" ({u.name})" if u.name else ""
        click.echo(f"  {u.email}{name_part} [{u.role}] — {group_names}")
    db.close()


@cli.command("list-groups")
def list_groups():
    """List all groups."""
    db = _get_db()
    groups = db.list_groups()
    if not groups:
        click.echo("No groups.")
        db.close()
        return

    for g in groups:
        click.echo(f"  {g.name} (id={g.id})")
    db.close()


@cli.command("reset-db")
def reset_db():
    """Clear all data from the database (with confirmation)."""
    click.echo("This will delete ALL data (users, groups, sessions, tracks, songs).")
    if not click.confirm("Are you sure?"):
        click.echo("Aborted.")
        return
    db = _get_db()
    db.reset()
    db.close()
    click.echo("Database reset complete.")


@cli.command("reset-password")
@click.argument("email")
def reset_password(email: str):
    """Reset a user's password. Prompts for new password."""
    from jam_session_processor.auth import hash_password

    db = _get_db()
    user = db.get_user_by_email(email)
    if not user:
        click.echo(f"Error: User '{email}' not found")
        db.close()
        raise SystemExit(1)

    password = click.prompt("New password", hide_input=True, confirmation_prompt=True)
    if not password:
        click.echo("Error: Password cannot be empty")
        db.close()
        raise SystemExit(1)

    db.update_user_password(user.id, hash_password(password))
    db.close()
    click.echo(f"Password updated for '{email}'")


@cli.command("set-role")
@click.argument("email")
@click.argument("role", type=click.Choice(["superadmin", "admin", "editor", "readonly"]))
def set_role(email: str, role: str):
    """Set a user's role."""
    db = _get_db()
    user = db.get_user_by_email(email)
    if not user:
        click.echo(f"Error: User '{email}' not found")
        db.close()
        raise SystemExit(1)

    db.update_user_role(user.id, role)
    db.close()
    click.echo(f"Updated '{email}' role to '{role}'")
