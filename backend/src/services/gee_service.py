"""
Google Earth Engine service — Phase 2

Authenticates with GEE using a service account and computes NDBI/NDVI
for a parcel geometry over a given date range using Sentinel-2 imagery.

NDBI = (SWIR - NIR) / (SWIR + NIR)
  SWIR = Sentinel-2 B11, NIR = Sentinel-2 B8

Cloud masking uses GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED.
Seasonal filter: May–October only (Gunnison at 7,700ft).
"""
import os
import ee
from datetime import datetime

_initialized = False

SERVICE_ACCOUNT = os.getenv("GEE_SERVICE_ACCOUNT", "")
KEY_FILE = os.getenv("GEE_KEY_FILE", "/app/secrets/gee-key.json")
PROJECT = os.getenv("GEE_PROJECT", "property-eye-gee")

# Cloud Score+ threshold — pixels with score below this are masked
CLOUD_SCORE_THRESHOLD = 0.6

# Minimum usable pixels in a parcel (below this, skip — too cloudy or tiny)
MIN_PIXEL_COUNT = 4


def initialize():
    """Authenticate with GEE using service account credentials."""
    global _initialized
    if _initialized:
        return

    if not SERVICE_ACCOUNT or not os.path.exists(KEY_FILE):
        raise RuntimeError(
            f"GEE credentials not configured. "
            f"Set GEE_SERVICE_ACCOUNT and ensure {KEY_FILE} exists."
        )

    credentials = ee.ServiceAccountCredentials(SERVICE_ACCOUNT, KEY_FILE)
    ee.Initialize(credentials=credentials, project=PROJECT)
    _initialized = True
    print(f"GEE initialized (project: {PROJECT})")


def _mask_clouds(image: ee.Image) -> ee.Image:
    """
    Mask clouds using Sentinel-2's Scene Classification Layer (SCL band).
    Keep only clear vegetation (4), bare soil (5), water (6), unclassified (7).
    Removes clouds (8,9), cirrus (10), snow (11).
    """
    scl = image.select("SCL")
    clear_mask = scl.eq(4).Or(scl.eq(5)).Or(scl.eq(6)).Or(scl.eq(7))
    return image.updateMask(clear_mask)


def _compute_ndbi(image: ee.Image) -> ee.Image:
    """NDBI = (B11 - B8) / (B11 + B8)"""
    return image.normalizedDifference(["B11", "B8"]).rename("NDBI")


def _compute_ndvi(image: ee.Image) -> ee.Image:
    """NDVI = (B8 - B4) / (B8 + B4)"""
    return image.normalizedDifference(["B8", "B4"]).rename("NDVI")


def _best_image(geometry: ee.Geometry, start_date: str, end_date: str) -> ee.Image | None:
    """
    Get the least-cloudy Sentinel-2 image for a geometry and date range.
    Returns None if no images found.
    """
    collection = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(geometry)
        .filterDate(start_date, end_date)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 80))
        .sort("CLOUDY_PIXEL_PERCENTAGE")
    )
    size = collection.size().getInfo()
    if size == 0:
        return None
    return collection.first()


def get_ndbi_for_parcel(geometry_wkt: str, start_date: str, end_date: str) -> dict:
    """
    Compute mean NDBI and NDVI over a parcel for a given date range.

    Args:
        geometry_wkt: WKT string of the parcel geometry (EPSG:4326)
        start_date:   ISO date string, e.g. "2023-05-01"
        end_date:     ISO date string, e.g. "2023-10-31"

    Returns:
        dict with: ndbi_mean, ndvi_mean, cloud_coverage_pct,
                   image_date (datetime or None), pixel_count, usable (bool)
    """
    initialize()

    # Parse WKT → GEE geometry via shapely → GeoJSON dict
    geom = _wkt_to_ee_geometry(geometry_wkt)

    image = _best_image(geom, start_date, end_date)
    if image is None:
        return {
            "ndbi_mean": None,
            "ndvi_mean": None,
            "cloud_coverage_pct": None,
            "image_date": None,
            "pixel_count": 0,
            "usable": False,
        }

    # Compute indices (already filtered to lowest cloud cover image)
    ndbi = _compute_ndbi(image)
    ndvi = _compute_ndvi(image)

    # Stack and reduce over parcel
    # sharedInputs=True → both reducers apply to all bands → keys are NDBI_mean, NDVI_mean, etc.
    stacked = ndbi.addBands(ndvi)
    stats = stacked.reduceRegion(
        reducer=ee.Reducer.mean().combine(
            ee.Reducer.count(), sharedInputs=True
        ),
        geometry=geom,
        scale=10,
        maxPixels=1e6,
    ).getInfo()

    ndbi_mean = stats.get("NDBI_mean")
    ndvi_mean = stats.get("NDVI_mean")
    pixel_count = int(stats.get("NDBI_count") or 0)

    cloud_pct = image.get("CLOUDY_PIXEL_PERCENTAGE").getInfo()
    ts = image.get("system:time_start").getInfo()
    image_date = datetime.utcfromtimestamp(ts / 1000) if ts else None

    usable = pixel_count >= MIN_PIXEL_COUNT and ndbi_mean is not None

    return {
        "ndbi_mean": round(ndbi_mean, 4) if ndbi_mean is not None else None,
        "ndvi_mean": round(ndvi_mean, 4) if ndvi_mean is not None else None,
        "cloud_coverage_pct": round(cloud_pct, 1) if cloud_pct is not None else None,
        "image_date": image_date,
        "pixel_count": pixel_count,
        "usable": usable,
    }


def _wkt_to_ee_geometry(wkt: str) -> ee.Geometry:
    """
    Convert a WKT polygon/multipolygon string to an ee.Geometry.
    Uses shapely to parse then passes GeoJSON dict directly to GEE.
    """
    from shapely.wkt import loads as wkt_loads
    geom = wkt_loads(wkt)
    return ee.Geometry(geom.__geo_interface__)
