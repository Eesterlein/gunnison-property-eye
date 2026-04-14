from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Boolean, Enum
import enum
from .base import Base


class UserRole(str, enum.Enum):
    staff = "staff"
    super_admin = "super_admin"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    hashed_password = Column(String(255), nullable=False)
    name = Column(String(255))
    role = Column(Enum(UserRole), default=UserRole.staff)
    jurisdiction = Column(String(100), nullable=True)  # None = all jurisdictions
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_login = Column(DateTime, nullable=True)
