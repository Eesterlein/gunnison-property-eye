import time
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from typing import Optional

from src.database import get_db
from src.models import Parcel, Scan, Flag, FlagStatus
from src.middleware.auth import get_current_user
from fastapi.responses import FileResponse

from src.services import gee_service, aerial_service, aerial_cache
from src.services.detection import get_scan_date_ranges

router = APIRouter()

# Imagery URL cache: (endpoint, parcel_id, years) -> (expires_at, response).
# Earth Engine thumbnail URLs stay valid for hours, and each response costs
# several Earth Engine round trips, so repeat views reuse the last hour's URLs.
_IMAGERY_TTL_S = 3600
_imagery_cache: dict[tuple, tuple[float, dict]] = {}


def _cached(key: tuple, build):
    now = time.time()
    hit = _imagery_cache.get(key)
    if hit and hit[0] > now:
        return hit[1]
    value = build()
    if len(_imagery_cache) > 2000:
        _imagery_cache.clear()
    _imagery_cache[key] = (now + _IMAGERY_TTL_S, value)
    return value


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
        raise HTTPException(status_code=404, detail="Parcel not found")
    return _parcel_to_dict(parcel)


@router.get("/{parcel_id}/imagery")
def get_parcel_imagery(
    parcel_id: int,
    scan_id: int,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    """
    True-color Sentinel-2 before/after thumbnails for a parcel + scan, so staff
    can visually confirm what an NDBI-flagged change actually looks like.
    """
    from geoalchemy2.shape import to_shape

    parcel = db.query(Parcel).filter(Parcel.id == parcel_id).first()
    if not parcel:
        raise HTTPException(status_code=404, detail="Parcel not found")

    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        raise HTTPException(status_code=404, detail="Scan not found")

    wkt = to_shape(parcel.geometry).wkt
    before_start, before_end, after_start, after_end = get_scan_date_ranges(scan)

    before_url = gee_service.get_thumbnail_url(wkt, before_start, before_end)
    after_url = gee_service.get_thumbnail_url(wkt, after_start, after_end)

    # Undated, much higher-resolution reference photo — not part of the
    # before/after comparison, which stays Sentinel-2 based.
    try:
        current_aerial_url = aerial_service.get_current_aerial_image_url(wkt)
    except Exception:
        current_aerial_url = None

    return {
        "before_url": before_url,
        "after_url": after_url,
        "before_range": [before_start, before_end],
        "after_range": [after_start, after_end],
        "current_aerial_url": current_aerial_url,
    }


# Image framing per view: the page's swipe/filmstrip, and the full-screen close-up
_IMAGE_KINDS = {
    "normal": {"buffer_m": 40, "dimensions": 768},
    "closeup": {"buffer_m": 10, "dimensions": 2048},
}


def _with_image_urls(parcel_id: int, entries: list[dict], kind: str) -> list[dict]:
    return [
        {
            **e,
            "url": f"/api/parcels/{parcel_id}/aerial-image?year={e['year']}&source={e['source']}&kind={kind}",
        }
        for e in entries
    ]


def _parcel_wkt(db: Session, parcel_id: int) -> str:
    from geoalchemy2.shape import to_shape

    parcel = db.query(Parcel).filter(Parcel.id == parcel_id).first()
    if not parcel:
        raise HTTPException(status_code=404, detail="Parcel not found")
    return to_shape(parcel.geometry).wkt


@router.get("/{parcel_id}/aerial-history")
def get_parcel_aerial_history(
    parcel_id: int,
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    """
    Dated high-resolution NAIP aerial photos of the parcel for every flight
    year available (~every 2 years since 2005), plus ~10m satellite composites
    for newer seasons not yet covered by NAIP, for visual change review.
    Image URLs point at /aerial-image, which renders and caches each one.
    """
    wkt = _parcel_wkt(db, parcel_id)
    entries = _cached(("years", parcel_id), lambda: gee_service.get_aerial_years(wkt))
    return {"years": _with_image_urls(parcel_id, entries, "normal")}


@router.get("/{parcel_id}/aerial-closeup")
def get_parcel_aerial_closeup(
    parcel_id: int,
    years: str = Query(..., description="Comma-separated flight years, e.g. 2021,2023"),
    db: Session = Depends(get_db),
    _user=Depends(get_current_user),
):
    """
    Large, tightly framed renders of the requested years for the
    full-screen swipe comparison.
    """
    try:
        year_list = sorted({int(y) for y in years.split(",") if y.strip()})
    except ValueError:
        raise HTTPException(status_code=422, detail="years must be comma-separated integers")
    if not 1 <= len(year_list) <= 4:
        raise HTTPException(status_code=422, detail="Request 1-4 years")

    wkt = _parcel_wkt(db, parcel_id)
    entries = _cached(("years", parcel_id), lambda: gee_service.get_aerial_years(wkt))
    wanted = [e for e in entries if e["year"] in year_list]
    return {"years": _with_image_urls(parcel_id, wanted, "closeup")}


@router.get("/{parcel_id}/aerial-image")
def get_parcel_aerial_image(
    parcel_id: int,
    year: int,
    source: str = Query(..., pattern="^(naip|sentinel2)$"),
    kind: str = Query("normal", pattern="^(normal|closeup)$"),
    db: Session = Depends(get_db),
):
    """
    One rendered year of imagery as a PNG, cached on disk after the first
    request (see services/aerial_cache.py). No login required: it's requested
    by <img> tags, which can't send a token, and only shows public imagery.
    """
    wkt = _parcel_wkt(db, parcel_id)
    key = f"{parcel_id}_{year}_{source}_{kind}"
    try:
        path = aerial_cache.get_image_path(
            key, lambda: gee_service.get_aerial_thumb_url(wkt, year, source, **_IMAGE_KINDS[kind])
        )
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Imagery temporarily unavailable: {str(e)[:120]}")
    # Flight photos and completed seasons never change, so browsers can keep them
    return FileResponse(path, media_type="image/png", headers={"Cache-Control": "public, max-age=604800"})


def _parcel_to_dict(p: Parcel) -> dict:
    return {
        "id": p.id,
        "apn": p.apn,
        "owner_name": p.owner_name,
        "situs_address": p.situs_address,
        "jurisdiction": p.jurisdiction,
        "acres": p.acres,
        "land_use_code": p.land_use_code,
        "improvements_value": p.improvements_value,
        "last_scan_date": p.last_scan_date,
    }
