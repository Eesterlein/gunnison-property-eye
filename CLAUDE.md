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
- Scheduler: APScheduler (automated annual scan, first Monday of November)
- Frontend: React + Tailwind CSS + **MapLibre GL** via `react-map-gl` (migrated
  away from the originally-planned Leaflet)
- Vector tiles: **tipg** (OGC Features/tiles served directly from PostGIS) — the
  frontend fetches parcel geometry from tipg, not the FastAPI backend
- Local Dev: Docker + Docker Compose (PostGIS + backend + tipg)
- Hosting: single server via `docker-compose.prod.yml` + Caddy (see Public demo deployment)

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

### Detection v2 — parcel-specific, building-aware (added 2026-10-07)
Staff found nearly every flag showed no real change. Causes found:
- 597 of 645 pending flags came from scan #5 (April 2026), which compared single
  least-cloudy scenes; on the same parcels the median-composite method agreed with
  only 19 of its 179 flags (delta correlation 0.38). Those 597 were bulk-dismissed
  with an explanatory note (backup taken first); stuck scan #14 marked failed.
- NDBI rises for dry grass/bare soil, and at 10m a lot is only 6–8 pixels, so new
  roads or houses NEXT DOOR bleed into a parcel's mean.

`services/detection.py` now calls `gee_service.get_parcel_change_batch` (1,000
parcels per request, batches sorted into ~1km grid cells; full county ≈ 1 hour vs
days for the old per-parcel calls). Per parcel, for Jun–Sep of both years:
Dynamic World `built` probability + Cloud Score+ NDBI/NDVI over the parcel
**interior** (5m trimmed) and a **ring** 10–60m outside it. Local change =
interior change − ring change. Flag when local built change > `BUILT_LOCAL_THRESHOLD`
(0.15) AND local NDBI change > `NDBI_LOCAL_THRESHOLD` (0.02) AND NDVI didn't rise
> 0.10. Priority 1 when `parcels.improvements_value == 0` (vacant on the books;
loaded from shapefile IMPSACTUAL via `load_shapefile.py --update-values`).
New detection columns: built_before, built_after, built_local_delta,
ndbi_local_delta (added by manual ALTER TABLE).

Calibration (2021 vs 2023, checked against NAIP photos, random 8 per tier):
built_local > 0.15 → 6/8 real construction; 0.08–0.15 → 2/8; 0.05–0.08 → 1–2/8.
Ring subtraction lowers scores for whole new subdivisions (neighbors change too),
so some townhome projects land in the lower tiers. County-wide 2021→2023:
31 flags at the default thresholds, 80 at 0.10, 275 at 0.05.

Scan #16 (2024 vs 2025, first full v2 scan, 2026-10-07): 8 flags, 6 on parcels
vacant on the books. One 1,000-parcel batch failed with Earth Engine's 10 MB
request-payload limit (detailed parcel boundaries). Fixed: outlines are simplified
to ~1m before sending, and a failed batch is split in half and retried down to
single parcels (`_fetch_batch`). `scripts/rescan_missing.py <scan_id>` fills in
parcels a scan has no result for; it completed #16 with 0 errors (30 parcels have
no usable pixels, which is expected).

Lesson from this change: add DB columns BEFORE deploying a model that selects
them (uvicorn --reload picked up the model first → 500s), and never hold a read
transaction open across a long Earth Engine run (it blocked ALTER TABLE, which
then blocked every parcel query). `run_detection` commits right after loading.

### Satellite years in the aerial viewer (added 2026-10-07)
`get_aerial_history` (renamed from `get_naip_history`) also returns Sentinel-2
composites (`source: "sentinel2"`) for each completed season after the newest NAIP
flight — no free sharp imagery of Gunnison exists past 2023 (NAIP, Microsoft
Planetary Computer and Esri Wayback all checked; Wayback's newest local capture is
Oct 2022). Labeled "satellite" everywhere; the viewer defaults to the two newest
NAIP years. On small lots the 10m composite is mostly blur — useful only for large
parcels. NAIP 2025 for Colorado was not yet delivered as of 2026-10-07; once it is
in Earth Engine it appears automatically and replaces the 2025 satellite entry.

### Public demo deployment (added 2026-10-07)
Hosted as a read-only portfolio demo on one small server (DigitalOcean planned).
- `docker-compose.prod.yml`: db, backend (1 worker — the scheduler is in-process),
  tipg (restricted to `public.parcels`, no PostGIS functions), web (Caddy + built
  React app via `deploy/web.Dockerfile`; `deploy/Caddyfile` proxies `/api` →
  backend and `/tipg/*` → tipg, auto-HTTPS, `index.html` no-cache). Only 80/443 exposed.
- `DEMO_MODE=true` (backend, `main.py`): get_current_user overridden with a viewer,
  all non-GET requests → 403, imagery endpoints limited to 20/min per IP.
  `VITE_DEMO_MODE=true` (frontend, `src/demo.js`): no login, banner, no owner
  names, no review/scan controls, flags worded "Detected Changes".
- Imagery URLs cached 1 hour per parcel/years (`routes/parcels.py`), both modes.
- `deploy/export_demo_db.sh` copies the local DB into a scratch DB, NULLs owner
  names, empties users, clears reviewer/notes, keeps only v2 detections, verifies,
  then dumps `deploy/demo.dump`. The real local DB is never modified.
- `deploy/deploy.sh <ip> [--load-data]` installs Docker if needed, opens 22/80/443,
  rsyncs code, copies secrets + `deploy/.env.production`, builds, restarts web (so
  Caddy rereads its bind-mounted config), optionally restores the dump.
- Emails: `SMTP_FROM` separate from `SMTP_USER` (Brevo logins aren't mailboxes);
  `APP_URL` is linked in scan summaries; `scripts/send_test_email.py` to test.
- Dry-run of the full prod stack passed locally (2026-10-07) as compose project
  `propeye-prodtest` on ports 80/443. Map canvas can't be checked in a hidden
  automation tab (Chrome pauses rendering); tiles were verified with curl.

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
