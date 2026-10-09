"""
Re-run detection for parcels a scan has no result for (e.g. after Earth Engine
errors), adding to that scan's existing totals.

Usage (inside the backend container):
    python scripts/rescan_missing.py <scan_id>
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.database import SessionLocal
from src.services import gee_service
from src.services.detection import run_detection

if len(sys.argv) != 2:
    sys.exit(__doc__)

gee_service.initialize()
db = SessionLocal()
try:
    print(run_detection(int(sys.argv[1]), db, only_missing=True))
finally:
    db.close()
