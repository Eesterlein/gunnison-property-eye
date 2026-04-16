from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, Text
from geoalchemy2 import Geometry
from .base import Base


class Parcel(Base):
    __tablename__ = "parcels"

    id = Column(Integer, primary_key=True, index=True)
    apn = Column(String(50), unique=True, nullable=False, index=True)  # Assessor Parcel Number
    owner_name = Column(String(255))
    situs_address = Column(String(500))
    jurisdiction = Column(String(100))  # Gunnison County, City of Gunnison, etc.
    acres = Column(Float)
    land_use_code = Column(String(50))
    geometry = Column(Geometry(srid=4326), nullable=False)
    last_scan_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    notes = Column(Text, nullable=True)
