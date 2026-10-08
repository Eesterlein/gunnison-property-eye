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


# Cloud Score+ band used for masking. "cs" is the basic quality score;
# "cs_cdf" is the cumulative-distribution variant. Pixels scoring below
# CLOUD_SCORE_THRESHOLD (0–1, higher = clearer) are masked out.
CLOUD_SCORE_BAND = "cs"


def _masked_collection(
    geometry: ee.Geometry, start_date: str, end_date: str
) -> ee.ImageCollection:
    """
    Build a Sentinel-2 SR collection over the geometry/date range with per-pixel
    cloud masking applied via GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED.

    Each S2 scene is linked to its Cloud Score+ counterpart and pixels below the
    cloud-score threshold are masked before any index is computed. This is what
    the detection method promises — without it, NDBI would be computed over
    cloud tops and produce spurious deltas.
    """
    s2 = (
        ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
        .filterBounds(geometry)
        .filterDate(start_date, end_date)
        .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 80))
    )
    cloud_score = (
        ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED")
        .filterBounds(geometry)
        .filterDate(start_date, end_date)
    )
    linked = s2.linkCollection(cloud_score, [CLOUD_SCORE_BAND])

    def _apply_mask(image: ee.Image) -> ee.Image:
        clear = image.select(CLOUD_SCORE_BAND).gte(CLOUD_SCORE_THRESHOLD)
        return image.updateMask(clear)

    return linked.map(_apply_mask)


def _compute_ndbi(image: ee.Image) -> ee.Image:
    """NDBI = (B11 - B8) / (B11 + B8)"""
    return image.normalizedDifference(["B11", "B8"]).rename("NDBI")


def _compute_ndvi(image: ee.Image) -> ee.Image:
    """NDVI = (B8 - B4) / (B8 + B4)"""
    return image.normalizedDifference(["B8", "B4"]).rename("NDVI")


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

    collection = _masked_collection(geom, start_date, end_date)

    # Metadata about the contributing scenes (one round trip).
    # aggregate_* return None on an empty collection.
    meta = ee.Dictionary({
        "count": collection.size(),
        "cloud_mean": collection.aggregate_mean("CLOUDY_PIXEL_PERCENTAGE"),
        "latest": collection.aggregate_max("system:time_start"),
    }).getInfo()

    if not meta.get("count"):
        return {
            "ndbi_mean": None,
            "ndvi_mean": None,
            "cloud_coverage_pct": None,
            "image_date": None,
            "pixel_count": 0,
            "usable": False,
        }

    # Median composite over the (cloud-masked) seasonal window. A composite is
    # more robust than any single scene: masked-out cloudy pixels in one image
    # are filled from clear observations in others.
    composite = collection.median()
    ndbi = _compute_ndbi(composite)
    ndvi = _compute_ndvi(composite)

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

    cloud_pct = meta.get("cloud_mean")
    ts = meta.get("latest")
    # image_date = most recent contributing acquisition in the window
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


def get_thumbnail_url(
    geometry_wkt: str,
    start_date: str,
    end_date: str,
    buffer_m: int = 60,
    dimensions: int = 480,
) -> str | None:
    """
    Generate a true-color Sentinel-2 thumbnail URL for a parcel over a date range,
    so staff can visually confirm an NDBI-flagged change instead of reading raw
    index values. Uses the same cloud-masked median composite as get_ndbi_for_parcel.

    buffer_m pads the parcel bounds so the thumbnail shows surrounding context
    (a small parcel alone can render as a sliver too narrow to interpret).

    Returns None if no cloud-masked imagery is available for the window.
    """
    initialize()

    geom = _wkt_to_ee_geometry(geometry_wkt)
    collection = _masked_collection(geom, start_date, end_date)
    if collection.size().getInfo() == 0:
        return None

    composite = collection.median()
    region = geom.buffer(buffer_m).bounds()
    # Sentinel-2 SR reflectance is scaled 0-10000; 0-3000 is the standard
    # display stretch for well-exposed true-color scenes.
    vis = composite.visualize(bands=["B4", "B3", "B2"], min=0, max=3000, gamma=1.4)
    return vis.getThumbURL({"region": region, "dimensions": dimensions, "format": "png"})


# USDA NAIP aerial photography — flown every ~2 years over Colorado in
# summer/fall, 0.3–1m per pixel (newer flights are sharper). Far more detail
# than Sentinel-2's 10m, and each flight is dated, so it supports a real
# visual before/after. Not used for flagging (no SWIR band for NDBI).
NAIP_COLLECTION = "USDA/NAIP/DOQQ"


def get_naip_history(
    geometry_wkt: str,
    buffer_m: int = 40,
    dimensions: int = 768,
) -> list[dict]:
    """
    Every NAIP flight year covering the parcel, oldest first, each with a
    true-color thumbnail URL (parcel outline drawn in yellow) and the
    acquisition date range of the tiles that make up that year's mosaic.

    All years share the same region and dimensions, so the images line up
    pixel-for-pixel and can be overlaid in a swipe comparison.
    """
    from concurrent.futures import ThreadPoolExecutor

    initialize()

    geom = _wkt_to_ee_geometry(geometry_wkt)
    region = geom.buffer(buffer_m).bounds()
    collection = ee.ImageCollection(NAIP_COLLECTION).filterBounds(region)

    timestamps = collection.aggregate_array("system:time_start").getInfo()
    if not timestamps:
        return []

    dates_by_year: dict[int, list[str]] = {}
    for ts in timestamps:
        d = datetime.utcfromtimestamp(ts / 1000).date()
        dates_by_year.setdefault(d.year, []).append(d.isoformat())

    outline = (
        ee.Image()
        .byte()
        .paint(ee.FeatureCollection([ee.Feature(geom)]), 1, 2)
        .visualize(palette=["facc15"])
    )

    def _year_entry(year: int) -> dict:
        mosaic = collection.filter(ee.Filter.calendarRange(year, year, "year")).mosaic()
        vis = mosaic.visualize(bands=["R", "G", "B"], min=0, max=255)
        # Unbounded background so every year renders the full region — a
        # thumbnail is otherwise cropped to the flight's tile footprint and
        # years wouldn't line up when a parcel sits near a tile edge.
        background = (
            ee.Image.constant([241, 245, 249])
            .rename(["vis-red", "vis-green", "vis-blue"])
            .uint8()
        )
        url = ee.ImageCollection([background, vis, outline]).mosaic().getThumbURL(
            {"region": region, "dimensions": dimensions, "format": "png"}
        )
        dates = sorted(dates_by_year[year])
        return {"year": year, "date_start": dates[0], "date_end": dates[-1], "url": url}

    # getThumbURL is one round trip per year — run them concurrently.
    with ThreadPoolExecutor(max_workers=6) as pool:
        return list(pool.map(_year_entry, sorted(dates_by_year)))
