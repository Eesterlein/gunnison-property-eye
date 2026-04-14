"""
Change detection service — Phase 3

Compares NDBI values between two time periods per parcel and creates flags
for parcels that exceed the change threshold.

Detection logic:
  1. For each parcel, pull NDBI for "before" period (prior year May–Oct)
  2. Pull NDBI for "after" period (current year May–Oct)
  3. Compute delta = ndbi_after - ndbi_before
  4. If delta > NDBI_THRESHOLD and NDVI delta is not positive (not vegetation),
     flag the parcel for human review
  5. Confidence score = scaled delta / max observed delta in this scan

TODO Phase 3:
  - run_detection(scan_id, parcel_ids) -> scan summary
  - compute_delta(ndbi_before, ndbi_after, ndvi_before, ndvi_after) -> dict
  - create_flag_if_warranted(detection) -> Flag or None
"""

NDBI_THRESHOLD = 0.15  # configurable; increase to reduce false positives
NDVI_VETO_THRESHOLD = 0.10  # if NDVI increased by this much, likely vegetation not construction


def run_detection(scan_id: int, parcel_ids: list[int], db) -> dict:
    """
    Run change detection for a scan across specified parcels.
    Returns summary dict with parcels_scanned and parcels_flagged.
    """
    # TODO Phase 3
    raise NotImplementedError("Detection not yet implemented — Phase 3")


def compute_delta(
    ndbi_before: float,
    ndbi_after: float,
    ndvi_before: float,
    ndvi_after: float,
) -> dict:
    """
    Compute NDBI delta and determine if the change warrants a flag.

    Returns:
        dict with: ndbi_delta, flagged (bool), confidence_score
    """
    ndbi_delta = ndbi_after - ndbi_before
    ndvi_delta = ndvi_after - ndvi_before

    # Veto if vegetation increased significantly (likely seasonal green-up)
    is_vegetation_change = ndvi_delta > NDVI_VETO_THRESHOLD

    flagged = ndbi_delta > NDBI_THRESHOLD and not is_vegetation_change
    confidence = min(1.0, max(0.0, ndbi_delta / (NDBI_THRESHOLD * 3))) if flagged else 0.0

    return {
        "ndbi_delta": ndbi_delta,
        "flagged": flagged,
        "confidence_score": round(confidence, 3),
    }
