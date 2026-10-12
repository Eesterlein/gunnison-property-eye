"""
Create (or reset the password of) a super admin account. Prompts for the
password so it never appears in shell history or logs.

Usage (inside the backend container, with a terminal):
    python scripts/create_admin.py you@example.com
"""
import getpass
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.database import SessionLocal, create_tables
from src.models import User, UserRole
from src.services.auth_service import hash_password

if len(sys.argv) != 2:
    sys.exit(__doc__)
email = sys.argv[1].strip().lower()

password = getpass.getpass("New password (12+ characters): ")
if len(password) < 12:
    sys.exit("Password must be at least 12 characters.")
if getpass.getpass("Repeat password: ") != password:
    sys.exit("Passwords didn't match.")

create_tables()
db = SessionLocal()
try:
    user = db.query(User).filter(User.email == email).first()
    if user:
        user.hashed_password = hash_password(password)
        user.role = UserRole.super_admin
        user.is_active = True
        action = "Password reset for"
    else:
        db.add(User(email=email, hashed_password=hash_password(password), name="Admin",
                    role=UserRole.super_admin, is_active=True))
        action = "Created admin"
    db.commit()
    print(f"{action} {email}")
finally:
    db.close()
