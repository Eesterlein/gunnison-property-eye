"""
Pre-render and cache the aerial history for every parcel with a pending flag
(each year's image, plus the close-up of the two newest aerial years), so a
demo or review session doesn't wait on Earth Engine for first views.

Usage (inside the backend container):
    python scripts/warm_aerial_cache.py
"""
import os
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from geoalchemy2.shape import to_shape

from src.database import SessionLocal
from src.models import Flag, FlagStatus, Parcel
from src.routes.parcels import _IMAGE_KINDS
from src.services import aerial_cache, gee_service

db = SessionLocal()
parcels = (
    db.query(Parcel.id, Parcel.geometry)
    .join(Flag, Flag.parcel_id == Parcel.id)
    .filter(Flag.status == FlagStatus.pending)
    .distinct()
    .all()
)
jobs = [(pid, to_shape(geom).wkt) for pid, geom in parcels]
db.close()


def warm(job) -> tuple[int, int]:
    pid, wkt = job
    years = gee_service.get_aerial_years(wkt)
    naip = [y for y in years if y["source"] == "naip"][-2:]
    wanted = [(y, "normal") for y in years] + [(y, "closeup") for y in naip]
    ok = 0
    for y, kind in wanted:
        key = f"{pid}_{y['year']}_{y['source']}_{kind}"
        try:
            aerial_cache.get_image_path(
                key,
                lambda: gee_service.get_aerial_thumb_url(wkt, y["year"], y["source"], **_IMAGE_KINDS[kind]),
            )
            ok += 1
        except Exception as e:
            print(f"  parcel {pid} {y['year']} {kind}: {e}", flush=True)
    return ok, len(wanted)


with ThreadPoolExecutor(3) as pool:
    results = list(pool.map(warm, jobs))
print(f"Cached {sum(r[0] for r in results)}/{sum(r[1] for r in results)} images for {len(jobs)} flagged parcels")
