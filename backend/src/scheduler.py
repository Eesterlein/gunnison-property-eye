"""
APScheduler — automated seasonal scan trigger — Phase 6

Runs an annual change detection scan every November, comparing the growing
season that just ended (May-Oct of the current year) against the same
window the year before.

Originally planned to fire in May comparing "current year's May-Oct" against
the prior year, but that can't work: in May, the current year's May-Oct
season hasn't happened yet. Scheduled for November instead, once both
seasonal windows have fully elapsed.

Gunnison is at 7,700ft. Winter imagery (Nov-Apr) is largely snow-covered
and unusable for NDBI-based structure detection.
"""
from datetime import datetime
from apscheduler.schedulers.background import BackgroundScheduler

from src.database import SessionLocal
from src.models import Scan, ScanStatus
from src.services.detection import run_detection
from src.services.notification_service import send_scan_summary_email

scheduler = BackgroundScheduler(timezone="America/Denver")


def run_annual_scan(limit: int | None = None) -> None:
    """
    Create a Scan for the two most recently completed May-Oct seasons and run
    detection across all parcels. Intended to fire once a year from the cron
    job below; `limit` exists for manual/test invocation.
    """
    now = datetime.now(scheduler.timezone)
    before_year = now.year - 1  # season before the one that just ended

    db = SessionLocal()
    try:
        scan = Scan(
            date_range_start=datetime(before_year, 5, 1),
            date_range_end=datetime(before_year, 10, 31),
            triggered_by="scheduler",
            status=ScanStatus.pending,
        )
        db.add(scan)
        db.commit()
        db.refresh(scan)

        print(f"[scheduler] Starting annual scan {scan.id}: {before_year} vs {before_year + 1} season")
        result = run_detection(scan.id, db, limit=limit)

        db.refresh(scan)
        send_scan_summary_email(scan, result)
    except Exception as e:
        print(f"[scheduler] Annual scan failed: {e}")
    finally:
        db.close()


def start_scheduler():
    """Register jobs and start the scheduler. Call from main.py lifespan."""
    scheduler.add_job(
        run_annual_scan,
        "cron",
        month=11,
        day="1st mon",
        hour=6,
        id="annual_scan",
        replace_existing=True,
    )
    scheduler.start()


def stop_scheduler():
    """Gracefully shut down the scheduler."""
    if scheduler.running:
        scheduler.shutdown()
