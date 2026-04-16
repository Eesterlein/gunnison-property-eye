"""
One-time parcel shapefile loader.

Usage:
    cd backend
    python scripts/load_shapefile.py --file ../data/sample/Taxparcelassessor.shp [--dry-run]

This script reads the Gunnison County Taxparcelassessor shapefile, maps columns
to the Parcel model, and bulk-inserts records into the PostGIS database.

Before running:
  1. Ensure Taxparcelassessor.shp (+ .dbf, .prj, .shx) is in data/sample/
  2. Copy .env.example to .env and fill in DATABASE_URL
  3. Run: docker compose up db -d
  4. Run this script

Actual shapefile columns (Gunnison County Taxparcelassessor):
  Shapefile column  -> Parcel field
  ----------------     ------------
  ParcelNumb        -> apn
  OWNERNAME         -> owner_name
  PROPERTYLO        -> situs_address  (property location address)
  GISAcres          -> acres
  ACCOUNTTYP        -> land_use_code  (Residential, Commercial, etc.)
  jurisdiction      -> derived from situs_address (see derive_jurisdiction())

Other useful columns available (not stored in Parcel table):
  ACCOUNTNO, TOTALACTUA, IMPSACTUAL, LANDACTUAL, TAXDISTRIC, MILLLEVY,
  SUBDIVISIO, LEGALDESCR, SALESAMOUN, SALEDATE, AssessorRe (URL)
"""
import argparse
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import text
from src.database import engine, SessionLocal
from src.models import Base, Parcel
from src.services.shapefile import load_shapefile, map_columns

# Gunnison County Taxparcelassessor column mapping
COLUMN_MAP = {
    "ParcelNumb": "apn",
    "OWNERNAME": "owner_name",
    "PROPERTYLO": "situs_address",
    "GISAcres": "acres",
    "ACCOUNTTYP": "land_use_code",
}

JURISDICTION_KEYWORDS = {
    "MT CRESTED BUTTE": "Mt. Crested Butte",
    "CRESTED BUTTE": "Crested Butte",
    "GUNNISON": "City of Gunnison",
}


def derive_jurisdiction(situs_address: str) -> str:
    """Derive jurisdiction from the property address string."""
    if not situs_address:
        return "Gunnison County"
    addr = situs_address.upper()
    for keyword, name in JURISDICTION_KEYWORDS.items():
        if keyword in addr:
            return name
    return "Gunnison County"


def main():
    parser = argparse.ArgumentParser(description="Load parcel shapefile into PostGIS")
    parser.add_argument("--file", required=True, help="Path to .shp file")
    parser.add_argument("--dry-run", action="store_true", help="Parse only, do not insert")
    args = parser.parse_args()

    print(f"Reading shapefile: {args.file}")
    gdf = load_shapefile(args.file)
    print(f"  Loaded {len(gdf)} features, CRS: {gdf.crs}")
    print(f"  Columns: {list(gdf.columns)}")

    gdf = map_columns(gdf, COLUMN_MAP)

    if args.dry_run:
        print("Dry run — first 3 rows:")
        print(gdf[["apn", "owner_name", "situs_address", "acres", "land_use_code"]].head(3))
        return

    # Ensure tables exist
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    inserted = 0
    skipped = 0
    seen_apns = set()  # track duplicates within this run (e.g. condo units sharing an APN)

    try:
        for _, row in gdf.iterrows():
            apn = str(row.get("apn", "")).strip()
            if not apn:
                skipped += 1
                continue

            if apn in seen_apns:
                skipped += 1
                continue
            seen_apns.add(apn)

            existing = db.query(Parcel).filter(Parcel.apn == apn).first()
            if existing:
                skipped += 1
                continue

            geom = row.geometry
            if geom is None or geom.is_empty:
                skipped += 1
                continue

            # Store WKT directly — model accepts any geometry type
            geom_wkt = geom.wkt

            situs = str(row.get("situs_address", "") or "").strip() or None
            parcel = Parcel(
                apn=apn,
                owner_name=str(row.get("owner_name", "") or "").strip() or None,
                situs_address=situs,
                jurisdiction=derive_jurisdiction(situs),
                acres=float(row["acres"]) if row.get("acres") else None,
                land_use_code=str(row.get("land_use_code", "") or "").strip() or None,
                geometry=f"SRID=4326;{geom_wkt}",
            )
            db.add(parcel)
            inserted += 1

            if inserted % 500 == 0:
                db.commit()
                print(f"  Committed {inserted} parcels...")

        db.commit()
        print(f"\nDone. Inserted: {inserted}, Skipped: {skipped}")
    except Exception as e:
        db.rollback()
        print(f"Error: {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
