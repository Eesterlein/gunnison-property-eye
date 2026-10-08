"""
Send a test email using the SMTP_* settings, to confirm scan notifications work.

Usage (inside the backend container):
    python scripts/send_test_email.py
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.services import notification_service as n

if not n.SMTP_HOST or not n.NOTIFICATION_RECIPIENTS:
    sys.exit("SMTP_HOST and SCAN_NOTIFICATION_EMAILS must be set.")

n.send_email(
    "Gunnison Property Eye — test email",
    "Scan notifications are set up. You'll get a summary like this after each scheduled scan.",
)
print(f"Sent test email from {n.SMTP_FROM} to {', '.join(n.NOTIFICATION_RECIPIENTS)}")
