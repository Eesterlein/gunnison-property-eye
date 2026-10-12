from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from src.database import get_db
from src.models import Flag, FlagStatus, User, Parcel, Detection, Scan
from src.middleware.auth import get_current_user

router = APIRouter()


class FlagUpdate(BaseModel):
    status: FlagStatus
    notes: Optional[str] = None


@router.get("/flagged-parcel-ids")
def get_flagged_parcel_ids(
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    """Return the set of parcel IDs that have at least one pending flag."""
    rows = (
        db.query(Flag.parcel_id)
        .filter(Flag.status == FlagStatus.pending)
        .distinct()
        .all()
    )
    return {"parcel_ids": [r[0] for r in rows]}


@router.get("/")
def list_flags(
    status: Optional[FlagStatus] = None,
    parcel_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
    _user: User = Depends(get_current_user),
):
    query = (
        db.query(Flag, Parcel, Detection, Scan)
        .join(Parcel, Flag.parcel_id == Parcel.id)
        .join(Detection, Flag.detection_id == Detection.id)
        .join(Scan, Detection.scan_id == Scan.id)
    )
    if status:
        query = query.filter(Flag.status == status)
    if parcel_id:
        query = query.filter(Flag.parcel_id == parcel_id)
    total = query.count()
    # Newest seasons first, strongest change first within a season
    rows = (
        query.order_by(Scan.date_range_start.desc(), Detection.built_local_delta.desc().nullslast())
        .offset(skip)
        .limit(min(limit, 2000))
        .all()
    )
    return {"total": total, "flags": [_flag_to_dict(*row) for row in rows]}


@router.patch("/{flag_id}")
def update_flag(
    flag_id: int,
    body: FlagUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    flag = db.query(Flag).filter(Flag.id == flag_id).first()
    if not flag:
        raise HTTPException(status_code=404, detail="Flag not found")

    flag.status = body.status
    if body.notes is not None:
        flag.notes = body.notes
    # Use the authenticated user's email — ignore any reviewed_by from request body
    flag.reviewed_by = current_user.email
    flag.reviewed_at = datetime.utcnow()
    db.commit()
    db.refresh(flag)

    parcel = db.query(Parcel).filter(Parcel.id == flag.parcel_id).first()
    detection = db.query(Detection).filter(Detection.id == flag.detection_id).first()
    scan = db.query(Scan).filter(Scan.id == detection.scan_id).first() if detection else None
    return _flag_to_dict(flag, parcel, detection, scan)


def _flag_to_dict(f: Flag, parcel: Parcel = None, detection: Detection = None, scan: Scan = None) -> dict:
    return {
        "id": f.id,
        "parcel_id": f.parcel_id,
        "detection_id": f.detection_id,
        "status": f.status,
        "reviewed_by": f.reviewed_by,
        "reviewed_at": f.reviewed_at,
        "notes": f.notes,
        "priority": f.priority,
        "created_at": f.created_at,
        "parcel": {
            "apn": parcel.apn,
            "situs_address": parcel.situs_address,
            "owner_name": parcel.owner_name,
            "improvements_value": parcel.improvements_value,
        } if parcel else None,
        "detection": {
            "ndbi_delta": detection.ndbi_delta,
            "confidence_score": detection.confidence_score,
            "built_local_delta": detection.built_local_delta,
        } if detection else None,
        # The two summers this flag compares, e.g. [2024, 2025]
        "seasons": [scan.date_range_start.year, scan.date_range_start.year + 1] if scan else None,
    }
