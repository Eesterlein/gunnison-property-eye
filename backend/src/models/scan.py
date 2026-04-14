from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Float, Text, Enum
import enum
from .base import Base


class ScanStatus(str, enum.Enum):
    pending = "pending"
    running = "running"
    complete = "complete"
    failed = "failed"


class Scan(Base):
    __tablename__ = "scans"

    id = Column(Integer, primary_key=True, index=True)
    status = Column(Enum(ScanStatus), default=ScanStatus.pending)
    date_range_start = Column(DateTime, nullable=False)  # "before" period start
    date_range_end = Column(DateTime, nullable=False)    # "after" period end
    parcels_scanned = Column(Integer, default=0)
    parcels_flagged = Column(Integer, default=0)
    avg_cloud_coverage = Column(Float, nullable=True)
    error_message = Column(Text, nullable=True)
    triggered_by = Column(String(100), default="scheduler")  # "scheduler" or user email
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
