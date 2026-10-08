# Gunnison Property Eye — CLAUDE.md

## What This Is
An automated satellite imagery change detection system for the Gunnison County
Assessor's Office. The system monitors parcel boundaries using Google Earth Engine
(Sentinel-2 imagery) to detect new construction, structure changes, and land
modifications that may indicate unreported improvements.

## Problem It Solves
Property assessors manually inspect the county to find unpermitted construction.
This tool automates detection by comparing NDBI (Normalized Difference Built-up
Index) values across parcel boundaries between seasons, flagging parcels with
significant change for human review.

## Who Uses It
- **Assessor staff**: review flagged parcels, mark as investigated, assign follow-up
- **Super admin (Elissa)**: configure detection thresholds, manage users, run manual scans

## Tech Stack
- Backend: Python + FastAPI
- Database: PostgreSQL with PostGIS extension (geometry columns for parcel polygons)
- ORM: SQLAlchemy + GeoAlchemy2
- Satellite Imagery: Google Earth Engine (GEE) Python API
- Geospatial Processing: GeoPandas, Shapely, Rasterio
- Scheduler: APScheduler (automated seasonal scans) — stubbed, not yet wired
- Frontend: React + Tailwind CSS + **MapLibre GL** via `react-map-gl` (migrated
  away from the originally-planned Leaflet)
- Vector tiles: **tipg** (OGC Features/tiles served directly from PostGIS) — the
  frontend fetches parcel geometry from tipg, not the FastAPI backend
- Local Dev: Docker + Docker Compose (PostGIS + backend + tipg)
- Hosting: TBD (AWS or similar)

### Local ports (this machine shares ports with other projects)
- PostGIS: host **5433** → container 5432
- FastAPI backend: host **8003** → container 8000 (moved off 8001, which another
  long-running project occupies)
- tipg: host **8002** → container 80
- Vite dev server: **5173**

## Detection Method
- **Index**: NDBI = (SWIR - NIR) / (SWIR + NIR) — detects rooftops and built surfaces
- **Bands**: Sentinel-2 B11 (SWIR) and B8 (NIR)
- **Cloud masking**: GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED — each scene is
  linked to its Cloud Score+ counterpart and pixels below the score threshold
  (0.6) are masked, then a **median composite** over the seasonal window is used
- **Composite**: median over the May–Oct window (robust to residual clouds)
- **Seasonal filter**: May–October only (Gunnison at 7,700ft has heavy winter snow)
- **Change threshold**: Configurable NDBI delta — default 0.15
- **False positive filter**: NDVI check to exclude vegetation growth

## Project Structure

```
gunnison-property-eye/
├── backend/
│   ├── src/
│   │   ├── routes/          # FastAPI routers
│   │   ├── services/        # GEE, detection, shapefile logic
│   │   ├── models/          # SQLAlchemy models
│   │   └── main.py          # FastAPI app entry point
│   ├── scripts/
│   │   └── load_shapefile.py  # One-time parcel shapefile loader
│   ├── requirements.txt
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── MapDashboard.jsx    # Main parcel map with flagged overlays
│   │   │   ├── ParcelDetail.jsx    # Individual parcel + history
│   │   │   └── InspectionLog.jsx   # All flagged parcels, status filters
│   │   └── components/
│   ├── package.json
│   └── index.html
├── data/
│   └── sample/              # Sample shapefiles for dev/testing
├── docker-compose.yml
├── .env.example
└── CLAUDE.md
```

## Database Tables
- `parcels` — parcel polygons (PostGIS geometry), APN, owner, address
- `scans` — each time a detection job runs (date range, status, summary)
- `detections` — per-parcel NDBI change results from a scan
- `flags` — human-reviewed records (status: pending/confirmed/dismissed)
- `users` — assessor staff logins

## Key Parcel Fields
apn (parcel number), owner_name, situs_address, geometry (PostGIS polygon),
jurisdiction, acres, last_scan_date, created_at

## Key Detection Fields
parcel_id, scan_id, ndbi_before, ndbi_after, ndbi_delta, cloud_coverage,
image_date_before, image_date_after, flagged, confidence_score

## Build Phases
> Note: commit messages used their own "Phase 2/3" numbering that differs from
> this roadmap. Status below reflects what is actually in the code.
- [x] Phase 1 — Project scaffold (commit `fa4df3f`); parcel loader + tipg +
      MapLibre and ~20k parcels loaded from shapefile (commit `f51854b`)
- [x] Phase 2 — GEE integration: service-account auth, Sentinel-2 imagery,
      Cloud Score+ masking + median composite, NDBI/NDVI per parcel
- [x] Phase 3 — Change detection: before/after NDBI delta, NDVI veto, threshold,
      flag creation (`services/detection.py`, run in background from `POST /api/scans`)
- [x] Phase 4 — Frontend map: MapDashboard with parcel + flag overlays, detail view
- [x] Phase 5 — Staff review workflow: auth/login, flag accept/dismiss, parcel review UI
      (`InspectionLog.jsx`/`Flagged Parcels` page was committed as a hardcoded
      `const flags = []` stub despite the commit message — wired up to
      `GET/PATCH /api/flags` on 2026-09-08)
- [x] Phase 6 — Scheduler + automation: `scheduler.py` registers an APScheduler
      cron job wired into `main.py`'s lifespan, firing the first Monday of
      **November** (not May — see note below) each year, comparing the two most
      recently completed May–Oct seasons. `notification_service.py` emails a
      summary via SMTP if `SMTP_HOST`/`SCAN_NOTIFICATION_EMAILS` are set, otherwise
      logs it. Added and verified (manual `run_annual_scan(limit=3)` invocation
      against live GEE) on 2026-09-13.

## Current Status
All 6 phases are committed and **verified end-to-end against live GEE** (2026-09-08
through 2026-09-13): service account auth works, real scans have run (20k+ parcels,
599 real flags in dev DB), the full review workflow (map → flag list →
confirm/dismiss → persists) was exercised in a browser, and the annual scheduler
was smoke-tested against real Earth Engine data. **SMTP is not yet configured**
(no real credentials set) — scan summaries currently just print to the backend
log instead of emailing anyone; see `.env.example` for the vars to fill in when
you have an SMTP provider.

### Scheduler date-fix note (2026-09-13)
The original Phase 6 TODO said to run in May, comparing the current year's
May–Oct season against the prior year's. That can't work — in May, the current
year's May–Oct season hasn't happened yet. Moved the cron trigger to the first
Monday in **November**, once both seasons have fully elapsed, comparing the
season that just ended against the one before it.

### Map UI polish (added 2026-09-18)
- `MapDashboard.jsx`: basemap switcher (`BASEMAP_OPTIONS`) — default changed from
  Carto Positron (nearly blank at county zoom) to Voyager (more detail/labels),
  plus a Satellite option using Esri World Imagery raster tiles (free, no API key).
  Parcel/flag overlays render as `<Source>`/`<Layer>` children so they persist
  across a basemap style swap.
- `ParcelDetail.jsx`: added `InfoLabel` — hover tooltips explaining NDBI, NDVI,
  Delta, Confidence, and Cloud cover in plain language (`TERM_INFO` map) next to
  every jargon label in the Detection History card. Also added a click-to-enlarge
  lightbox for the before/after satellite thumbnails, with an explicit "~10m per
  pixel" caption so the resolution limit stays visible rather than implied.

### Live scan progress + ETA (added 2026-09-18)
`Scan` gained a `total_parcels` column (set once at the start of `run_detection`,
after `limit` is applied) — added via manual `ALTER TABLE`, since this project has
no Alembic migrations wired up despite it being in `requirements.txt`; schema
changes to existing tables need a manual `ALTER TABLE` on top of the model edit,
`create_all()` only creates missing tables. `parcels_scanned`/`parcels_flagged` on
the `Scan` row now update every 50-parcel checkpoint (previously only written once
at the very end, so the UI showed 0 for the entire run). `MapDashboard.jsx`'s scan
status badge now shows `started_at`, live `X / total_parcels` progress, and an
extrapolated "~Nm/Nh remaining" estimate computed client-side from progress-so-far.
Note: backend timestamps are naive UTC with no "Z" suffix — the frontend's
`parseUtc()` helper appends it before parsing, otherwise the browser reads them as
local time and skews all elapsed-time math by the local UTC offset.

### Manual scan date validation (added 2026-09-18)
The original "Run New Scan" form took two free-text date inputs, which allowed
malformed ranges — a real one happened: a user-entered range spanning 2024-05-01
to "today" (2.4 years) burned live GEE quota on a comparison that could never
produce a valid result before being manually killed. Replaced with a single
"season year" `<select>` in `MapDashboard.jsx` that can only produce a valid
May 1-Oct 31 pair, and added a matching `field_validator` on `ScanCreate` in
`routes/scans.py` so a malformed request is rejected even if it bypasses the UI
(same May 1/Oct 31/same-year/season-already-elapsed rules).

### Satellite imagery viewer (added 2026-09-08)
`ParcelDetail.jsx` has a "View satellite imagery" button per detection that lazy-loads
true-color Sentinel-2 before/after thumbnails via `GET /api/parcels/{id}/imagery?scan_id=`
(`gee_service.get_thumbnail_url`). **Known limitation**: Sentinel-2 is 10m/pixel, so
thumbnails show blocky shapes sufficient to sanity-check "something changed here"
but not fine architectural detail (roofline, additions). Getting real structural
detail would require a different, higher-resolution paid imagery source (e.g.
Planet, Maxar/NearMap) — a separate integration, not a tweak to this endpoint.
Decided 2026-09-08 to ship the Sentinel-2 version as-is rather than pursue that.

### Aerial photo history (added 2026-10-07)
Sentinel-2 thumbnails were too coarse to verify flags, and paid sub-foot
imagery (EagleView, Nearmap) is out of scope. `ParcelDetail.jsx` now
opens with an **Aerial Photo History** card backed by
`GET /api/parcels/{id}/aerial-history` (`gee_service.get_naip_history`): USDA
NAIP aerial photography (`USDA/NAIP/DOQQ`) from the same GEE account, free,
dated, ~every 2 years since 2005 (2023 flight is 0.3m/pixel). One true-color
thumbnail per flight year with the parcel outline in yellow, a two-year swipe
comparison (defaults to the two latest years), and a filmstrip of all years.
- Every year is rendered over the same region + dimensions and mosaicked onto a
  constant background — without that, Earth Engine crops a thumbnail to the
  flight tile's footprint and years misalign when a parcel sits near a tile edge.
- NAIP is review-only, not used for flagging (no SWIR band for NDBI). Its
  2-year cadence means construction from the latest season may not appear yet.
- **View closer** button opens a full-screen swipe comparison backed by
  `GET /api/parcels/{id}/aerial-closeup?years=YYYY,YYYY` — same renderer with a
  10m buffer at 2048px (several MB per image), fetched only on demand. All NAIP
  renders use bicubic resampling (nearest-neighbor showed hard pixel blocks).
  The swipe uses pointer events (click/drag anywhere; arrow keys when focused) —
  an invisible `<input type="range">` overlay only responded when grabbed at its
  thumb mid-height, so it seemed broken. It shows a "Loading photos…" cover
  until both images load, otherwise
  the bottom year shows through on both sides and reads as "no change".
- 0.3m (2023) is the sharpest free imagery here — Esri World Imagery over
  Gunnison is also ~0.31m (WorldView-3, 2022). Zooming past that adds no detail.
- Possible next step: NAIP-based detection (NDVI loss + brightness gain at
  sub-meter resolution) to catch small additions the 10m NDBI method misses.

## Important Notes
- GEE authentication uses a service account JSON key — never commit to git
- PostGIS is required (not plain Postgres) for geometry column support
- Seasonal filtering is critical — winter imagery at 7,700ft is unusable
- Detection is a suggestion tool, not a final determination — always human review
- ~20k parcels are already loaded from `data/sample/Taxparcelassessor.shp`
  (`scripts/load_shapefile.py`); use `limit` on `POST /api/scans` to test on a subset
- **Commit messages/phase checkmarks in this project have proven unreliable** —
  e.g. Phase 5 was committed as "done" with `InspectionLog.jsx` still a hardcoded
  stub. Verify against the actual code, not the commit message, before trusting
  a phase status.
