"""Email utilities for sending invite and password reset links."""

import logging
import smtplib
from email.mime.text import MIMEText

from jam_session_processor.config import get_config

logger = logging.getLogger(__name__)


def _send_email(to_email: str, subject: str, body: str) -> bool:
    """Send an email via SMTP. Returns True if sent, False if SMTP is not configured."""
    cfg = get_config()
    if not cfg.smtp_host:
        logger.warning("SMTP not configured — email not sent to %s", to_email)
        return False

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = cfg.smtp_from or cfg.smtp_user
    msg["To"] = to_email

    try:
        with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port) as server:
            server.starttls()
            if cfg.smtp_user and cfg.smtp_password:
                server.login(cfg.smtp_user, cfg.smtp_password)
            server.send_message(msg)
        logger.info("Email sent to %s: %s", to_email, subject)
        return True
    except Exception:
        logger.exception("Failed to send email to %s", to_email)
        return False


def send_invite_email(to_email: str, token: str, name: str = "") -> bool:
    """Send an invite email with a link to set password.

    Returns True if sent, False if SMTP is not configured.
    """
    cfg = get_config()
    invite_url = f"{cfg.app_url.rstrip('/')}/invite/{token}"
    greeting = f"Hi {name},\n\n" if name else "Hi,\n\n"

    body = (
        f"{greeting}"
        f"You've been invited to JamJar — a tool for organizing and cataloging "
        f"band jam session recordings. You can listen back to takes, tag songs, "
        f"compare versions across sessions, and build setlists.\n\n"
        f"Click the link below to set your password and get started:\n\n"
        f"{invite_url}\n\n"
        f"This link expires in 7 days.\n\n"
        f"— JamJar"
    )

    return _send_email(to_email, "You're invited to JamJar", body)


def send_password_reset_email(to_email: str, token: str, name: str = "") -> bool:
    """Send a password reset email with a link to reset password.

    Returns True if sent, False if SMTP is not configured.
    """
    cfg = get_config()
    reset_url = f"{cfg.app_url.rstrip('/')}/reset-password/{token}"
    greeting = f"Hi {name},\n\n" if name else "Hi,\n\n"

    body = (
        f"{greeting}"
        f"We received a request to reset your JamJar password.\n\n"
        f"Click the link below to set a new password:\n\n"
        f"{reset_url}\n\n"
        f"This link expires in 1 hour. If you didn't request this, "
        f"you can safely ignore this email.\n\n"
        f"— JamJar"
    )

    return _send_email(to_email, "Reset your JamJar password", body)
