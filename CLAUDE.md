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
- Scheduler: APScheduler (automated seasonal scans)
- Frontend: React + Tailwind CSS + Leaflet.js (react-leaflet)
- Local Dev: Docker + Docker Compose (PostGIS container)
- Hosting: TBD (AWS or similar)

## Detection Method
- **Index**: NDBI = (SWIR - NIR) / (SWIR + NIR) — detects rooftops and built surfaces
- **Bands**: Sentinel-2 B11 (SWIR) and B8 (NIR)
- **Cloud masking**: GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED
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
- [x] Phase 1 — Project scaffold: docker-compose (PostGIS), FastAPI backend with
      full SQLAlchemy schema, React + Leaflet frontend scaffold, requirements.txt,
      .env.example, shapefile loader stub
- [ ] Phase 2 — GEE integration: authenticate, pull Sentinel-2 imagery, compute
      NDBI per parcel, store results
- [ ] Phase 3 — Change detection: compare before/after NDBI, apply threshold,
      create flags for review
- [ ] Phase 4 — Frontend map: display parcels, flag overlays, click for detail
- [ ] Phase 5 — Staff review workflow: accept/dismiss flags, notes, status tracking
- [ ] Phase 6 — Scheduler + automation: seasonal scan trigger, email summary

## Current Status
✅ Phase 1 complete. Full scaffold in place.

## Important Notes
- GEE authentication uses a service account JSON key — never commit to git
- PostGIS is required (not plain Postgres) for geometry column support
- Seasonal filtering is critical — winter imagery at 7,700ft is unusable
- Detection is a suggestion tool, not a final determination — always human review
- Start with a sample of ~500 parcels for dev; full county is ~15,000 parcels
