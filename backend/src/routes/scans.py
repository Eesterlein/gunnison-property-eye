from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel
from datetime import datetime
from typing import Optional

from src.database import get_db, SessionLocal
from src.models import Scan, ScanStatus, User
from src.middleware.auth import get_current_user

router = APIRouter()


class ScanCreate(BaseModel):
    date_range_start: datetime
    date_range_end: datetime
    triggered_by: Optional[str] = "manual"
    limit: Optional[int] = None  # max parcels to process (for testing)


def _run_detection_background(scan_id: int, limit: Optional[int]):
    """Run detection in a background thread with its own DB session."""
    from src.services.detection import run_detection
    db = SessionLocal()
    try:
        run_detection(scan_id, db, limit=limit)
    except Exception as e:
        print(f"Background detection failed for scan {scan_id}: {e}")
    finally:
        db.close()


@router.get("/")
def list_scans(
    skip: int = 0,
    limit: int = 50,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    scans = db.query(Scan).order_by(Scan.created_at.desc()).offset(skip).limit(limit).all()
    return [_scan_to_dict(s) for s in scans]


@router.get("/{scan_id}")
def get_scan(
    scan_id: int,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")
    return _scan_to_dict(scan)


@router.post("/")
def create_scan(
    body: ScanCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    scan = Scan(
        date_range_start=body.date_range_start,
        date_range_end=body.date_range_end,
        triggered_by=current_user.email,
        status=ScanStatus.pending,
    )
    db.add(scan)
    db.commit()
    db.refresh(scan)

    # Run detection in background so API returns immediately
    background_tasks.add_task(_run_detection_background, scan.id, body.limit)

    return _scan_to_dict(scan)


def _scan_to_dict(s: Scan) -> dict:
    return {
        "id": s.id,
        "status": s.status,
        "date_range_start": s.date_range_start,
        "date_range_end": s.date_range_end,
        "parcels_scanned": s.parcels_scanned,
        "parcels_flagged": s.parcels_flagged,
        "triggered_by": s.triggered_by,
        "started_at": s.started_at,
        "completed_at": s.completed_at,
        "created_at": s.created_at,
        "error_message": s.error_message,
    }
