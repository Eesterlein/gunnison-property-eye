"""
Change detection service — v2 (parcel-specific, building-aware)

Compares two snow-free seasons (June–September) per parcel and flags parcels
where something built-up appeared ON THE PARCEL, not just nearby.

Detection logic, per parcel:
  1. Measure the parcel interior (boundary trimmed) and a ring of land around it,
     for both seasons, in batched Earth Engine requests
     (gee_service.get_parcel_change_batch):
       - Dynamic World "built" probability — trained to tell buildings and
         pavement apart from grass, shrub and bare ground
       - NDBI and NDVI from the cloud-masked Sentinel-2 median composite
  2. Local change = interior change − ring change, so neighborhood-wide change
     (a new road, a whole subdivision going in) cancels out
  3. Flag when BOTH the local built-probability change and the local NDBI change
     exceed their thresholds, and vegetation didn't simply green up
  4. High priority when the assessor carries the parcel as vacant
     (improvements_value == 0) — the strongest lead for unreported construction

v1 (single NDBI threshold on the raw parcel mean) flagged mostly dry-grass and
neighbor/road changes; see CLAUDE.md for the calibration against NAIP photos.
"""
import os
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from geoalchemy2.shape import to_shape

from src.models import Parcel, Scan, Detection, Flag, ScanStatus, FlagStatus
from src.services import gee_service

# Calibrated 2026-10-07 against 2021 vs 2023 NAIP aerial photos (random samples
# of flagged parcels): local built change > 0.15 → 6 of 8 were real new
# construction; 0.08–0.15 → 2 of 8; 0.05–0.08 → 1–2 of 8.
BUILT_LOCAL_THRESHOLD = float(os.getenv("BUILT_LOCAL_THRESHOLD", "0.15"))
NDBI_LOCAL_THRESHOLD = float(os.getenv("NDBI_LOCAL_THRESHOLD", "0.02"))
NDVI_VETO_THRESHOLD = 0.10  # if NDVI increased by this much, likely vegetation not construction

BATCH_SIZE = 1000


def compute_change(inner: dict, ring: dict) -> dict | None:
    """
    Parcel-specific change metrics and flag decision from the interior and ring
    band means returned by get_parcel_change_batch. None if the parcel had no
    usable (cloud-free) pixels in either season.
    """
    needed = ("built_b", "built_a", "ndbi_b", "ndbi_a", "ndvi_b", "ndvi_a")
    if any(inner.get(k) is None for k in needed):
        return None

    built_delta = inner["built_a"] - inner["built_b"]
    ndbi_delta = inner["ndbi_a"] - inner["ndbi_b"]
    ndvi_delta = inner["ndvi_a"] - inner["ndvi_b"]

    # Ring can be empty (e.g. parcel surrounded by water/no data) — then no correction
    ring_ok = all(ring.get(k) is not None for k in ("built_b", "built_a", "ndbi_b", "ndbi_a"))
    built_local = built_delta - ((ring["built_a"] - ring["built_b"]) if ring_ok else 0.0)
    ndbi_local = ndbi_delta - ((ring["ndbi_a"] - ring["ndbi_b"]) if ring_ok else 0.0)

    flagged = (
        built_local > BUILT_LOCAL_THRESHOLD
        and ndbi_local > NDBI_LOCAL_THRESHOLD
        and ndvi_delta <= NDVI_VETO_THRESHOLD
    )
    # How far past the built threshold, scaled 0-1 (0.15 over threshold = 1.0)
    confidence = min(1.0, (built_local - BUILT_LOCAL_THRESHOLD) / 0.15) if flagged else 0.0

    return {
        "built_delta": built_delta,
        "built_local": built_local,
        "ndbi_delta": ndbi_delta,
        "ndbi_local": ndbi_local,
        "flagged": flagged,
        "confidence": round(max(0.0, confidence), 3),
    }


def get_scan_date_ranges(scan: Scan) -> tuple[str, str, str, str]:
    """
    Derive the "before"/"after" imagery date ranges for a scan.
    "After" is the same months, one year later than "before".
    """
    before_start = scan.date_range_start.strftime("%Y-%m-%d")
    before_end = scan.date_range_end.strftime("%Y-%m-%d")
    after_start = scan.date_range_start.replace(year=scan.date_range_start.year + 1).strftime("%Y-%m-%d")
    after_end = scan.date_range_end.replace(year=scan.date_range_end.year + 1).strftime("%Y-%m-%d")
    return before_start, before_end, after_start, after_end


def _r(value: float | None, digits: int = 4) -> float | None:
    return round(value, digits) if value is not None else None


# Parcel outlines are simplified to ~1m before being sent to Earth Engine:
# far below the 10m pixel size, and it keeps detailed boundaries from pushing a
# batch request past Earth Engine's 10 MB payload limit.
SIMPLIFY_DEGREES = 0.00001


def _fetch_batch(items: list[tuple[int, str]], before_year: int, after_year: int) -> tuple[dict, list[int]]:
    """
    Earth Engine results for a batch of (parcel_id, wkt). On failure (e.g. the
    request is still too large, or a transient error) the batch is split in
    half and each half retried, down to single parcels — so one bad request
    no longer skips a whole batch. Returns (results, failed parcel ids).
    """
    try:
        return gee_service.get_parcel_change_batch(items, before_year, after_year), []
    except Exception as e:
        if len(items) == 1:
            print(f"  Parcel {items[0][0]} failed: {e}")
            return {}, [items[0][0]]
        print(f"  Batch of {len(items)} failed ({str(e)[:80]}); splitting and retrying")
        mid = len(items) // 2
        left, left_failed = _fetch_batch(items[:mid], before_year, after_year)
        right, right_failed = _fetch_batch(items[mid:], before_year, after_year)
        return {**left, **right}, left_failed + right_failed


def run_detection(
    scan_id: int, db: Session, limit: int | None = None, only_missing: bool = False
) -> dict:
    """
    Run change detection for a scan across all parcels.

    Args:
        scan_id:      ID of the Scan record to run
        db:           SQLAlchemy session
        limit:        Optional max parcels to process (useful for testing)
        only_missing: Re-run only parcels this scan has no result for yet
                      (e.g. after failures), adding to its existing totals

    Returns:
        dict with parcels_scanned, parcels_flagged and errors
    """
    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        raise ValueError(f"Scan {scan_id} not found")

    scan.status = ScanStatus.running
    if not only_missing:
        scan.started_at = datetime.now(timezone.utc)
    db.commit()

    before_year = scan.date_range_start.year
    after_year = before_year + 1

    parcels_query = db.query(Parcel.id, Parcel.geometry, Parcel.improvements_value).order_by(Parcel.id)
    if only_missing:
        done = db.query(Detection.parcel_id).filter(Detection.scan_id == scan_id)
        parcels_query = parcels_query.filter(~Parcel.id.in_(done))
    if limit:
        parcels_query = parcels_query.limit(limit)

    # Sort into ~1km grid cells so each Earth Engine batch covers a compact area
    parcels = []
    for pid, geom, imps in parcels_query.all():
        shape = to_shape(geom)
        c = shape.centroid
        wkt = shape.simplify(SIMPLIFY_DEGREES, preserve_topology=True).wkt
        parcels.append((round(c.y, 2), round(c.x, 2), pid, wkt, imps))
    parcels.sort()

    if not only_missing:
        scan.total_parcels = len(parcels)
    # Commit ends the read transaction — holding it open for the whole
    # (long) Earth Engine run blocks schema changes and other writers.
    db.commit()

    image_date_before = datetime(before_year, 9, 30)
    image_date_after = datetime(after_year, 9, 30)

    # A fill-in run continues the scan's totals; failures are recounted from scratch
    if only_missing:
        scanned = (scan.parcels_scanned or 0) - len(parcels)
        flagged = scan.parcels_flagged or 0
    else:
        scanned = flagged = 0
    errors = 0
    try:
        for i in range(0, len(parcels), BATCH_SIZE):
            batch = parcels[i:i + BATCH_SIZE]
            results, failed = _fetch_batch(
                [(pid, wkt) for _, _, pid, wkt, _ in batch], before_year, after_year
            )
            errors += len(failed)

            for _, _, pid, _, imps in batch:
                scanned += 1
                r = results.get(pid)
                change = compute_change(r["inner"], r.get("ring", {})) if r else None
                if change is None:
                    continue
                inner = r["inner"]

                detection = Detection(
                    parcel_id=pid,
                    scan_id=scan_id,
                    ndbi_before=_r(inner["ndbi_b"]),
                    ndbi_after=_r(inner["ndbi_a"]),
                    ndbi_delta=_r(change["ndbi_delta"]),
                    ndvi_before=_r(inner["ndvi_b"]),
                    ndvi_after=_r(inner["ndvi_a"]),
                    built_before=_r(inner["built_b"]),
                    built_after=_r(inner["built_a"]),
                    built_local_delta=_r(change["built_local"]),
                    ndbi_local_delta=_r(change["ndbi_local"]),
                    image_date_before=image_date_before,
                    image_date_after=image_date_after,
                    pixel_count=int(inner.get("count") or 0),
                    flagged=change["flagged"],
                    confidence_score=change["confidence"],
                )
                db.add(detection)

                if change["flagged"]:
                    db.flush()  # get detection.id
                    db.add(Flag(
                        parcel_id=pid,
                        detection_id=detection.id,
                        status=FlagStatus.pending,
                        # Vacant on the books + new building = strongest lead
                        priority=1 if imps == 0 else 0,
                    ))
                    flagged += 1

            # Commit per batch, updating live progress for the UI
            scan.parcels_scanned = scanned
            scan.parcels_flagged = flagged
            db.commit()
            print(f"  Scanned {scanned}/{scan.total_parcels} parcels, {flagged} flagged so far...")

        now = datetime.now(timezone.utc)
        for _, _, pid, _, _ in parcels:
            db.query(Parcel).filter(Parcel.id == pid).update({"last_scan_date": now})
        scan.status = ScanStatus.complete
        scan.parcels_scanned = scanned
        scan.parcels_flagged = flagged
        scan.completed_at = now
        scan.error_message = f"{errors} parcels failed (see logs)" if errors else None
        db.commit()

        print(f"Scan {scan_id} complete: {scanned} scanned, {flagged} flagged, {errors} errors")
        return {"parcels_scanned": scanned, "parcels_flagged": flagged, "errors": errors}

    except Exception as e:
        db.rollback()
        scan.status = ScanStatus.failed
        scan.error_message = str(e)
        scan.completed_at = datetime.now(timezone.utc)
        db.commit()
        raise
