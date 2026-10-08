"""
Current high-resolution aerial imagery — Esri World Imagery.

Sentinel-2 (gee_service.py) is ~10m/pixel — enough for the NDBI math that
actually drives flagging, not for visually confirming what's on a parcel.
This pulls a current, much higher-resolution (often sub-meter) aerial photo
from Esri's free, keyless World Imagery service for the same parcel, purely
as a visual reference alongside the dated Sentinel-2 before/after.

Not a before/after comparison: World Imagery is a single "best available"
mosaic per location, not a queryable date archive, so this only reflects
whatever the most recent flight/pass Esri has for that area is — the exact
capture date is unknown and un-selectable via this endpoint.
"""
import httpx
from pyproj import Transformer
from shapely.ops import transform as shp_transform
from shapely.wkt import loads as wkt_loads

EXPORT_URL = "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export"

# UTM 13N covers Gunnison County — used to buffer in true meters before
# reprojecting to Web Mercator, which the export endpoint requires.
_TO_UTM13N = Transformer.from_crs("EPSG:4326", "EPSG:32613", always_xy=True)
_UTM13N_TO_3857 = Transformer.from_crs("EPSG:32613", "EPSG:3857", always_xy=True)


def get_current_aerial_image_url(geometry_wkt: str, buffer_m: int = 60, size: int = 480) -> str:
    """
    Build a URL to a current high-resolution aerial PNG centered on the
    parcel, buffered by buffer_m real-world meters for context.
    """
    geom = wkt_loads(geometry_wkt)
    geom_utm = shp_transform(_TO_UTM13N.transform, geom)
    buffered_3857 = shp_transform(_UTM13N_TO_3857.transform, geom_utm.buffer(buffer_m))
    xmin, ymin, xmax, ymax = buffered_3857.bounds

    params = {
        "bbox": f"{xmin},{ymin},{xmax},{ymax}",
        "bboxSR": 3857,
        "size": f"{size},{size}",
        "imageSR": 3857,
        "format": "png",
        "f": "image",
    }
    request = httpx.Request("GET", EXPORT_URL, params=params)
    return str(request.url)
