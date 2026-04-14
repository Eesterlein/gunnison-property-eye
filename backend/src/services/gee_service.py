"""
Google Earth Engine service — Phase 2

Handles GEE authentication and Sentinel-2 imagery retrieval.
NDBI = (SWIR - NIR) / (SWIR + NIR)
  - SWIR: Sentinel-2 Band 11 (B11)
  - NIR:  Sentinel-2 Band 8  (B8)

Cloud masking uses: GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED
Seasonal filter: May–October only (Gunnison at 7,700ft; snow unusable in winter)

TODO Phase 2:
  - ee.Initialize() with service account
  - get_ndbi_for_parcel(geometry, start_date, end_date) -> float
  - get_best_image(geometry, date_range) -> ee.Image (lowest cloud cover)
  - mask_clouds(image) -> ee.Image
  - compute_ndbi(image) -> ee.Image
  - compute_ndvi(image) -> ee.Image
"""
import os


def initialize():
    """Authenticate with GEE using service account credentials."""
    # TODO Phase 2
    raise NotImplementedError("GEE integration not yet implemented — Phase 2")


def get_ndbi_for_parcel(geometry_geojson: dict, start_date: str, end_date: str) -> dict:
    """
    Compute mean NDBI over a parcel polygon for a date range.

    Args:
        geometry_geojson: GeoJSON polygon of the parcel boundary
        start_date: ISO date string, e.g. "2023-06-01"
        end_date:   ISO date string, e.g. "2023-09-30"

    Returns:
        dict with keys: ndbi_mean, ndvi_mean, cloud_coverage_pct,
                        image_date, pixel_count
    """
    # TODO Phase 2
    raise NotImplementedError("GEE integration not yet implemented — Phase 2")
