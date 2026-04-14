"""
Shapefile loading service.

Handles reading and reprojecting Gunnison County parcel shapefiles
for storage in PostGIS. Used by scripts/load_shapefile.py.

Gunnison County Taxparcelassessor shapefile fields (mapped to Parcel model):
  - ParcelNumb  -> apn
  - OWNERNAME   -> owner_name
  - PROPERTYLO  -> situs_address
  - GISAcres    -> acres
  - ACCOUNTTYP  -> land_use_code
  - jurisdiction -> derived from situs_address
  - geometry    -> geometry (reprojected from EPSG:2232 to EPSG:4326)
"""
import geopandas as gpd
from shapely.geometry import mapping


def load_shapefile(filepath: str) -> gpd.GeoDataFrame:
    """
    Read a shapefile and reproject to WGS84 (EPSG:4326).
    Returns a GeoDataFrame ready for column mapping.
    """
    gdf = gpd.read_file(filepath)
    if gdf.crs is None:
        raise ValueError("Shapefile has no CRS defined. Check the .prj file.")
    if gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)
    return gdf


def map_columns(gdf: gpd.GeoDataFrame, column_map: dict) -> gpd.GeoDataFrame:
    """
    Rename shapefile columns to match the Parcel model fields.

    column_map example:
        {"PARCEL_NO": "apn", "OWN_NAME": "owner_name", "SITUS": "situs_address"}
    """
    return gdf.rename(columns=column_map)


def geometry_to_wkt(geom) -> str:
    """Convert a shapely geometry to WKT string for PostGIS insertion."""
    return geom.wkt
