from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import Optional

from src.database import get_db
from src.models import Parcel, Flag, FlagStatus
from src.middleware.auth import get_current_user

router = APIRouter()


@router.get("/")
def list_parcels(
    jurisdiction: Optional[str] = None,
    q: Optional[str] = None,
    flagged_only: bool = False,
    skip: int = 0,
    limit: int = 100,
    db: Session = Depends(get_db),
):
    query = db.query(Parcel)
    if jurisdiction:
        query = query.filter(Parcel.jurisdiction == jurisdiction)
    if q:
        query = query.filter(
            Parcel.apn.ilike(f"%{q}%") |
            Parcel.owner_name.ilike(f"%{q}%") |
            Parcel.situs_address.ilike(f"%{q}%")
        )
    total = query.count()
    parcels = query.offset(skip).limit(limit).all()
    return {"total": total, "parcels": [_parcel_to_dict(p) for p in parcels]}


@router.get("/flagged-geojson")
def get_flagged_geojson(
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    """Return a GeoJSON FeatureCollection of all parcels with pending flags."""
    from geoalchemy2.shape import to_shape
    import json

    flagged_parcel_ids = (
        db.query(Flag.parcel_id)
        .filter(Flag.status == FlagStatus.pending)
        .distinct()
        .all()
    )
    ids = [r[0] for r in flagged_parcel_ids]

    parcels = db.query(Parcel).filter(Parcel.id.in_(ids)).all()

    features = []
    for p in parcels:
        if p.geometry is None:
            continue
        shape = to_shape(p.geometry)
        geom = json.loads(json.dumps(shape.__geo_interface__))
        features.append({
            "type": "Feature",
            "geometry": geom,
            "properties": {"id": p.id, "apn": p.apn, "situs_address": p.situs_address},
        })

    return {"type": "FeatureCollection", "features": features}


@router.get("/{parcel_id}")
def get_parcel(parcel_id: int, db: Session = Depends(get_db)):
    parcel = db.query(Parcel).filter(Parcel.id == parcel_id).first()
    if not parcel:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Parcel not found")
    return _parcel_to_dict(parcel)


def _parcel_to_dict(p: Parcel) -> dict:
    return {
        "id": p.id,
        "apn": p.apn,
        "owner_name": p.owner_name,
        "situs_address": p.situs_address,
        "jurisdiction": p.jurisdiction,
        "acres": p.acres,
        "land_use_code": p.land_use_code,
        "last_scan_date": p.last_scan_date,
    }
