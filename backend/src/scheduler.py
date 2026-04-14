"""
APScheduler — automated seasonal scan trigger — Phase 6

Runs an annual change detection scan each May using the prior year's
May–October imagery as the "before" period and the current year's
May–October imagery as the "after" period.

Gunnison is at 7,700ft. Winter imagery (Nov–Apr) is largely snow-covered
and unusable for NDBI-based structure detection.

TODO Phase 6:
  - Start APScheduler with BackgroundScheduler
  - Schedule: first Monday in May at 6am Mountain time
  - Trigger: create a new Scan record and run detection on all active parcels
  - On completion: email summary to configured recipients
"""
from apscheduler.schedulers.background import BackgroundScheduler

scheduler = BackgroundScheduler(timezone="America/Denver")


def start_scheduler():
    """Register jobs and start the scheduler. Call from main.py lifespan."""
    # TODO Phase 6: add cron job
    # scheduler.add_job(run_annual_scan, "cron", month=5, day="1st mon", hour=6)
    scheduler.start()


def stop_scheduler():
    """Gracefully shut down the scheduler."""
    if scheduler.running:
        scheduler.shutdown()
