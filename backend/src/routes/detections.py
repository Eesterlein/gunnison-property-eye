from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from src.database import get_db
from src.models import Detection

router = APIRouter()


@router.get("/")
def list_detections(
    scan_id: Optional[int] = None,
    parcel_id: Optional[int] = None,
    flagged_only: bool = False,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    query = db.query(Detection)
    if scan_id:
        query = query.filter(Detection.scan_id == scan_id)
    if parcel_id:
        query = query.filter(Detection.parcel_id == parcel_id)
    if flagged_only:
        query = query.filter(Detection.flagged == True)
    total = query.count()
    detections = query.offset(skip).limit(limit).all()
    return {"total": total, "detections": [_det_to_dict(d) for d in detections]}


def _det_to_dict(d: Detection) -> dict:
    return {
        "id": d.id,
        "parcel_id": d.parcel_id,
        "scan_id": d.scan_id,
        "ndbi_before": d.ndbi_before,
        "ndbi_after": d.ndbi_after,
        "ndbi_delta": d.ndbi_delta,
        "ndvi_before": d.ndvi_before,
        "ndvi_after": d.ndvi_after,
        "image_date_before": d.image_date_before,
        "image_date_after": d.image_date_after,
        "cloud_coverage_pct": d.cloud_coverage_pct,
        "flagged": d.flagged,
        "confidence_score": d.confidence_score,
        "created_at": d.created_at,
    }
