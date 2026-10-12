"""
Run one-year detection scans for a range of seasons, one after another,
in this process (independent of the API server, so restarting the API
doesn't interrupt them).

Usage (inside the backend container):
    python scripts/run_scans.py 2018 2023     # 2018→2019 ... 2023→2024
"""
import os
import sys
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.database import SessionLocal
from src.models import Scan, ScanStatus
from src.services import gee_service
from src.services.detection import run_detection

if len(sys.argv) != 3:
    sys.exit(__doc__)
first, last = int(sys.argv[1]), int(sys.argv[2])

gee_service.initialize()
for year in range(first, last + 1):
    db = SessionLocal()
    try:
        scan = Scan(
            date_range_start=datetime(year, 5, 1),
            date_range_end=datetime(year, 10, 31),
            status=ScanStatus.pending,
            triggered_by="manual",
        )
        db.add(scan)
        db.commit()
        print(f"=== Scan #{scan.id}: summer {year} vs summer {year + 1}", flush=True)
        result = run_detection(scan.id, db)
        print(f"=== Scan #{scan.id} done: {result}", flush=True)
    finally:
        db.close()
