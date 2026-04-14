from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Text, ForeignKey, Enum
import enum
from .base import Base


class FlagStatus(str, enum.Enum):
    pending = "pending"       # Newly flagged, not yet reviewed
    confirmed = "confirmed"   # Staff confirmed likely construction
    dismissed = "dismissed"   # Staff dismissed as false positive
    investigated = "investigated"  # Field visit completed


class Flag(Base):
    __tablename__ = "flags"

    id = Column(Integer, primary_key=True, index=True)
    parcel_id = Column(Integer, ForeignKey("parcels.id"), nullable=False, index=True)
    detection_id = Column(Integer, ForeignKey("detections.id"), nullable=False)
    status = Column(Enum(FlagStatus), default=FlagStatus.pending)
    reviewed_by = Column(String(255), nullable=True)   # user email
    reviewed_at = Column(DateTime, nullable=True)
    notes = Column(Text, nullable=True)
    priority = Column(Integer, default=0)  # 0=normal, 1=high
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
