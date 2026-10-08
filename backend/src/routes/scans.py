from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from pydantic import BaseModel, field_validator, ValidationInfo
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

    @field_validator("date_range_end")
    @classmethod
    def validate_season_window(cls, end: datetime, info: ValidationInfo) -> datetime:
        """
        Enforce a single May 1 - Oct 31 "before" season, with the auto-derived
        "after" season (same months, one year later) already fully elapsed.
        Without this, a malformed range (e.g. spanning multiple years, or
        reaching into the future) silently burns Earth Engine calls on a
        comparison that can't produce a meaningful result.
        """
        start = info.data.get("date_range_start")
        if start is None:
            return end
        if (start.month, start.day) != (5, 1):
            raise ValueError("date_range_start must be May 1")
        if (end.month, end.day) != (10, 31):
            raise ValueError("date_range_end must be Oct 31")
        if end.year != start.year:
            raise ValueError("date_range_start and date_range_end must be the same year")

        after_season_end = end.replace(year=end.year + 1)
        if after_season_end > datetime.utcnow():
            raise ValueError(
                f"The {end.year + 1} season isn't over yet (ends {after_season_end.date()}) — "
                f"choose an earlier season year"
            )
        return end


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
        "total_parcels": s.total_parcels,
        "parcels_scanned": s.parcels_scanned,
        "parcels_flagged": s.parcels_flagged,
        "triggered_by": s.triggered_by,
        "started_at": s.started_at,
        "completed_at": s.completed_at,
        "created_at": s.created_at,
        "error_message": s.error_message,
    }
