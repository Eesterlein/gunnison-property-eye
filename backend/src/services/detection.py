"""
Change detection service — Phase 2/3

Compares NDBI values between two time periods per parcel and creates flags
for parcels that exceed the change threshold.

Detection logic:
  1. For each parcel, pull NDBI for "before" period (prior year May–Oct)
  2. Pull NDBI for "after" period (current year May–Oct)
  3. Compute delta = ndbi_after - ndbi_before
  4. If delta > NDBI_THRESHOLD and NDVI delta is NOT positive (not vegetation),
     flag the parcel for human review
"""
import os
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from geoalchemy2.shape import to_shape

from src.models import Parcel, Scan, Detection, Flag, ScanStatus, FlagStatus
from src.services import gee_service

NDBI_THRESHOLD = float(os.getenv("NDBI_THRESHOLD", "0.15"))
NDVI_VETO_THRESHOLD = 0.10  # if NDVI increased by this much, likely vegetation not construction


def compute_delta(
    ndbi_before: float,
    ndbi_after: float,
    ndvi_before: float | None,
    ndvi_after: float | None,
) -> dict:
    """
    Compute NDBI delta and determine if the change warrants a flag.
    """
    ndbi_delta = ndbi_after - ndbi_before

    # Veto if vegetation increased significantly
    ndvi_delta = (ndvi_after - ndvi_before) if (ndvi_before is not None and ndvi_after is not None) else 0
    is_vegetation_change = ndvi_delta > NDVI_VETO_THRESHOLD

    flagged = ndbi_delta > NDBI_THRESHOLD and not is_vegetation_change
    confidence = min(1.0, max(0.0, ndbi_delta / (NDBI_THRESHOLD * 3))) if flagged else 0.0

    return {
        "ndbi_delta": round(ndbi_delta, 4),
        "flagged": flagged,
        "confidence_score": round(confidence, 3),
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


def run_detection(scan_id: int, db: Session, limit: int | None = None) -> dict:
    """
    Run change detection for a scan across all parcels.

    Args:
        scan_id: ID of the Scan record to run
        db:      SQLAlchemy session
        limit:   Optional max parcels to process (useful for testing)

    Returns:
        dict with parcels_scanned and parcels_flagged
    """
    scan = db.query(Scan).filter(Scan.id == scan_id).first()
    if not scan:
        raise ValueError(f"Scan {scan_id} not found")

    # Update scan status
    scan.status = ScanStatus.running
    scan.started_at = datetime.now(timezone.utc)
    db.commit()

    before_start, before_end, after_start, after_end = get_scan_date_ranges(scan)

    parcels_query = db.query(Parcel)
    if limit:
        parcels_query = parcels_query.limit(limit)
    parcels = parcels_query.all()

    scan.total_parcels = len(parcels)
    db.commit()

    scanned = 0
    flagged = 0
    errors = 0

    try:
        for parcel in parcels:
            try:
                # Convert PostGIS geometry to WKT
                shape = to_shape(parcel.geometry)
                wkt = shape.wkt

                # Pull NDBI for before and after periods
                before = gee_service.get_ndbi_for_parcel(wkt, before_start, before_end)
                after = gee_service.get_ndbi_for_parcel(wkt, after_start, after_end)

                if not before["usable"] or not after["usable"]:
                    scanned += 1
                    continue

                delta = compute_delta(
                    before["ndbi_mean"],
                    after["ndbi_mean"],
                    before["ndvi_mean"],
                    after["ndvi_mean"],
                )

                detection = Detection(
                    parcel_id=parcel.id,
                    scan_id=scan_id,
                    ndbi_before=before["ndbi_mean"],
                    ndbi_after=after["ndbi_mean"],
                    ndbi_delta=delta["ndbi_delta"],
                    ndvi_before=before["ndvi_mean"],
                    ndvi_after=after["ndvi_mean"],
                    image_date_before=before["image_date"],
                    image_date_after=after["image_date"],
                    cloud_coverage_pct=after["cloud_coverage_pct"],
                    pixel_count=after["pixel_count"],
                    flagged=delta["flagged"],
                    confidence_score=delta["confidence_score"],
                )
                db.add(detection)

                if delta["flagged"]:
                    db.flush()  # get detection.id
                    flag = Flag(
                        parcel_id=parcel.id,
                        detection_id=detection.id,
                        status=FlagStatus.pending,
                        priority=1 if delta["confidence_score"] > 0.7 else 0,
                    )
                    db.add(flag)
                    flagged += 1

                scanned += 1

                # Commit every 50 parcels, updating live progress so the UI can
                # show real numbers instead of 0 until the whole scan finishes
                if scanned % 50 == 0:
                    scan.parcels_scanned = scanned
                    scan.parcels_flagged = flagged
                    db.commit()
                    print(f"  Scanned {scanned}/{len(parcels)} parcels, {flagged} flagged so far...")

            except Exception as e:
                errors += 1
                print(f"  Error on parcel {parcel.apn}: {e}")
                continue

        db.commit()

        # Update parcel last_scan_date
        for parcel in parcels:
            parcel.last_scan_date = datetime.now(timezone.utc)
        db.commit()

        scan.status = ScanStatus.complete
        scan.parcels_scanned = scanned
        scan.parcels_flagged = flagged
        scan.completed_at = datetime.now(timezone.utc)
        if errors:
            scan.error_message = f"{errors} parcels failed (see logs)"
        db.commit()

        print(f"Scan {scan_id} complete: {scanned} scanned, {flagged} flagged, {errors} errors")
        return {"parcels_scanned": scanned, "parcels_flagged": flagged, "errors": errors}

    except Exception as e:
        scan.status = ScanStatus.failed
        scan.error_message = str(e)
        scan.completed_at = datetime.now(timezone.utc)
        db.commit()
        raise
