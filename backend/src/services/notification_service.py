"""
Email notifications for scheduled scan completions — Phase 6.

Configured via SMTP_* environment variables (see .env.example). If SMTP host
or recipients aren't configured, the summary is logged instead of sent, so
the scheduler never crashes over a missing mail setup.
"""
import os
import smtplib
from email.mime.text import MIMEText

from src.models import Scan

SMTP_HOST = os.getenv("SMTP_HOST", "")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
# Sender address. Services like Brevo use a login that isn't a mailbox, so the
# From address is set separately (must be a sender verified with the service).
SMTP_FROM = os.getenv("SMTP_FROM", "") or SMTP_USER
APP_URL = os.getenv("APP_URL", "").rstrip("/")
NOTIFICATION_RECIPIENTS = [
    e.strip() for e in os.getenv("SCAN_NOTIFICATION_EMAILS", "").split(",") if e.strip()
]


def send_scan_summary_email(scan: Scan, result: dict) -> None:
    """Send (or log, if SMTP isn't configured) a summary of a completed scan."""
    after_year = scan.date_range_start.year + 1
    subject = f"Gunnison Property Eye — Scan #{scan.id} complete"
    body = (
        f"Scan #{scan.id}: {scan.date_range_start.year} season vs {after_year} season\n\n"
        f"Parcels scanned: {result.get('parcels_scanned')}\n"
        f"Parcels flagged: {result.get('parcels_flagged')}\n"
        f"Errors: {result.get('errors')}\n\n"
        f"Review flagged parcels in the app under \"Flagged Parcels\""
        + (f": {APP_URL}/inspections" if APP_URL else ".")
    )
    send_email(subject, body)


def send_email(subject: str, body: str) -> None:
    """Send a plain-text email to SCAN_NOTIFICATION_EMAILS (or log it if SMTP isn't configured)."""
    if not SMTP_HOST or not NOTIFICATION_RECIPIENTS:
        print(f"[notification] SMTP not configured — logging email instead:\n{body}")
        return

    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = SMTP_FROM
    msg["To"] = ", ".join(NOTIFICATION_RECIPIENTS)

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.starttls()
        if SMTP_USER:
            server.login(SMTP_USER, SMTP_PASSWORD)
        server.sendmail(SMTP_FROM, NOTIFICATION_RECIPIENTS, msg.as_string())
