# Gunnison Property Eye

Satellite change detection for property assessment. Gunnison Property Eye monitors
Gunnison County, Colorado parcels with Sentinel-2 imagery from Google Earth Engine and flags
parcels that show signs of new construction or land modification, so assessor staff can
review them. Every flag is a suggestion for human review, not a determination.

> **Independent project.** This is an independent project and is not an official product of the Gunnison County Assessor's Office or Gunnison County. Any county data it works with comes from publicly available assessor and GIS data, and results may contain errors or out-of-date information. Always verify against official county records.

## How it works

1. Parcel polygons are loaded from the county parcel shapefile into PostGIS.
2. For each parcel, the backend computes the Normalized Difference Built-up Index
   (NDBI = (SWIR − NIR) / (SWIR + NIR), Sentinel-2 bands B11 and B8) for two seasons.
3. Cloudy pixels are masked, winter imagery is excluded (the county sits at 7,700 ft and is
   snow-covered much of the year), and an NDVI check filters out vegetation growth.
4. Parcels whose NDBI change exceeds a configurable threshold (default 0.15) are flagged.
5. Staff review flagged parcels on a map and mark them confirmed or dismissed.

## Tech stack

| Layer | Tools |
|---|---|
| Backend | Python, FastAPI, SQLAlchemy, GeoAlchemy2, APScheduler |
| Geospatial | PostgreSQL/PostGIS, GeoPandas, Shapely, Rasterio, tipg (OGC API) |
| Imagery | Google Earth Engine Python API (Sentinel-2) |
| Frontend | React, Tailwind CSS, MapLibre GL JS / Leaflet |
| Local dev | Docker Compose |

## Status

In development. The project scaffold, database schema, parcel loading and map display are in
place; Earth Engine integration, change detection and the review workflow are next.

## Running locally

```bash
cp .env.example .env        # fill in database and Earth Engine settings
docker compose up -d        # PostGIS, API and frontend
```

The Earth Engine service-account key is supplied locally and must never be committed.
