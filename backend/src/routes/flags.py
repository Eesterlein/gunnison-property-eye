from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from datetime import datetime

from src.database import get_db
from src.models import Flag, FlagStatus, User, Parcel, Detection
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
    query = db.query(Flag, Parcel, Detection).join(Parcel, Flag.parcel_id == Parcel.id).join(
        Detection, Flag.detection_id == Detection.id
    )
    if status:
        query = query.filter(Flag.status == status)
    if parcel_id:
        query = query.filter(Flag.parcel_id == parcel_id)
    total = query.count()
    rows = query.order_by(Flag.created_at.desc()).offset(skip).limit(limit).all()
    return {"total": total, "flags": [_flag_to_dict(f, parcel, detection) for f, parcel, detection in rows]}


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
    return _flag_to_dict(flag, parcel, detection)


def _flag_to_dict(f: Flag, parcel: Parcel = None, detection: Detection = None) -> dict:
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
        } if parcel else None,
        "detection": {
            "ndbi_delta": detection.ndbi_delta,
            "confidence_score": detection.confidence_score,
        } if detection else None,
    }
