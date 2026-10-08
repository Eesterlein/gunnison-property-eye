# Gunnison Property Eye

Satellite change detection for property assessment. Gunnison Property Eye monitors
Gunnison County, Colorado parcels with satellite imagery from Google Earth Engine and flags
parcels that show signs of new construction, so assessor staff can review them alongside
dated aerial photography. Every flag is a suggestion for human review, not a determination.

> **Independent project.** This is an independent project and is not an official product of the Gunnison County Assessor's Office or Gunnison County. Any county data it works with comes from publicly available assessor and GIS data, and results may contain errors or out-of-date information. Always verify against official county records.

## How it works

### Detection

1. Parcel polygons and assessor values are loaded from the county parcel shapefile into PostGIS.
2. For two consecutive snow-free seasons (June–September; the county sits at 7,700 ft and
   above), each parcel is measured in batched Earth Engine requests using:
   - **Dynamic World** "built" probability — a per-pixel land-cover model trained to tell
     buildings and pavement apart from grass, shrub and bare ground
   - **NDBI** (Normalized Difference Built-up Index, Sentinel-2 bands B11/B8) and **NDVI**
     from a cloud-masked (Cloud Score+) median composite
3. Measurements are taken over the parcel **interior** (boundary trimmed) and over a **ring**
   of surrounding land. Change in the ring is subtracted, so neighborhood-wide change — a
   new road, a whole subdivision going in — cancels out and only change on the parcel itself
   remains. Sentinel-2 pixels are 10 m, so on a typical lot this matters a lot.
4. A parcel is flagged when both the built-probability and NDBI changes exceed their
   thresholds and vegetation didn't simply green up.
5. Flags on parcels the assessor carries with **$0 in improvements** are marked high
   priority — a new building there is the strongest lead for unreported construction.

A scheduled scan runs each November, comparing the two most recent completed seasons. Scans
can also be started manually from the map.

### Review

Staff work from a map of flagged parcels and a flagged-parcels list (exportable to CSV). Each
parcel page shows the detection measurements with plain-language explanations, and an
**aerial photo history**:

- USDA NAIP aerial photography for every flight year since 2005 (about every two years; the
  2023 flight is about 0.3 m per pixel), with the parcel outline drawn in
- a swipe comparison between any two years, plus a full-screen close-up view
- Sentinel-2 satellite composites (~10 m per pixel, clearly labeled) for seasons newer than
  the latest aerial flight; new NAIP years appear automatically once published

Staff confirm or dismiss each flag, with notes.

## Tech stack

| Layer | Tools |
|---|---|
| Backend | Python, FastAPI, SQLAlchemy, GeoAlchemy2, APScheduler |
| Geospatial | PostgreSQL/PostGIS, GeoPandas, Shapely, tipg (OGC API) |
| Imagery | Google Earth Engine: Sentinel-2, Cloud Score+, Dynamic World, USDA NAIP |
| Frontend | React, Tailwind CSS, MapLibre GL JS (react-map-gl), Vite |
| Local dev | Docker Compose |

## Status

Working end to end: parcel loading, Earth Engine detection, scheduled scans with email
summaries, the map and review workflow, and the aerial photo history. Deployable as a
read-only public demo (see below).

## Running locally

```bash
cp .env.example .env        # fill in database, Earth Engine and auth settings
docker compose up -d        # PostGIS, API (port 8003) and tipg vector tiles (port 8002)

# Load parcels (first run), or refresh assessor values later with --update-values
docker exec -w /app property_eye_backend \
  python scripts/load_shapefile.py --file data/sample/Taxparcelassessor.shp

cd frontend && npm install && npm run dev   # http://localhost:5173
```

## Deploying (public demo)

A single small Ubuntu server runs everything with Docker Compose; Caddy serves the app and
gets HTTPS certificates automatically.

```bash
cp deploy/.env.production.example deploy/.env.production   # fill in address, Earth Engine, email
deploy/export_demo_db.sh                                     # public-safe copy of the local DB
deploy/deploy.sh <server-ip> --load-data                     # first deploy (later: omit --load-data)
```

With `DEMO_MODE=true` the app is read-only and needs no login: every write is refused,
imagery requests are rate-limited per visitor, and the exported database contains no owner
names, staff accounts or review notes. Scan summaries are emailed via any SMTP service
(`SMTP_*` settings); `python scripts/send_test_email.py` in the backend container sends a test.

The Earth Engine service-account key is supplied locally (`secrets/`) and must never be
committed. Detection thresholds can be tuned with the `BUILT_LOCAL_THRESHOLD` and
`NDBI_LOCAL_THRESHOLD` environment variables.
