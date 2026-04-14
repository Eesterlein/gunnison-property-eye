from datetime import datetime
from sqlalchemy import Column, Integer, Float, DateTime, Boolean, ForeignKey
from .base import Base


class Detection(Base):
    __tablename__ = "detections"

    id = Column(Integer, primary_key=True, index=True)
    parcel_id = Column(Integer, ForeignKey("parcels.id"), nullable=False, index=True)
    scan_id = Column(Integer, ForeignKey("scans.id"), nullable=False, index=True)

    # NDBI values
    ndbi_before = Column(Float, nullable=True)   # mean NDBI over "before" period
    ndbi_after = Column(Float, nullable=True)    # mean NDBI over "after" period
    ndbi_delta = Column(Float, nullable=True)    # ndbi_after - ndbi_before

    # NDVI (used to filter false positives from vegetation)
    ndvi_before = Column(Float, nullable=True)
    ndvi_after = Column(Float, nullable=True)

    # Image metadata
    image_date_before = Column(DateTime, nullable=True)
    image_date_after = Column(DateTime, nullable=True)
    cloud_coverage_pct = Column(Float, nullable=True)
    pixel_count = Column(Integer, nullable=True)  # usable pixels in parcel

    # Result
    flagged = Column(Boolean, default=False)
    confidence_score = Column(Float, nullable=True)  # 0–1
    created_at = Column(DateTime, default=datetime.utcnow)
