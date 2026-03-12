"""Email utilities for sending invite links."""

import logging
import smtplib
from email.mime.text import MIMEText

from jam_session_processor.config import get_config

logger = logging.getLogger(__name__)


def send_invite_email(to_email: str, token: str, name: str = "") -> bool:
    """Send an invite email with a link to set password.

    Returns True if sent, False if SMTP is not configured.
    """
    cfg = get_config()
    if not cfg.smtp_host:
        logger.warning("SMTP not configured — invite email not sent to %s", to_email)
        return False

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

    msg = MIMEText(body)
    msg["Subject"] = "You're invited to JamJar"
    msg["From"] = cfg.smtp_from or cfg.smtp_user
    msg["To"] = to_email

    try:
        with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port) as server:
            server.starttls()
            if cfg.smtp_user and cfg.smtp_password:
                server.login(cfg.smtp_user, cfg.smtp_password)
            server.send_message(msg)
        logger.info("Invite email sent to %s", to_email)
        return True
    except Exception:
        logger.exception("Failed to send invite email to %s", to_email)
        return False
