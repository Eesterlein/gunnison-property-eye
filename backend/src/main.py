from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import os

from src.database import create_tables
from src.routes import parcels, scans, detections, flags, auth
from src.services import gee_service
from src.scheduler import start_scheduler, stop_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    create_tables()
    try:
        gee_service.initialize()
    except Exception as e:
        print(f"WARNING: GEE initialization failed: {e}")
        print("Detection scans will not work until GEE is configured.")
    start_scheduler()
    yield
    stop_scheduler()


app = FastAPI(
    title="Gunnison Property Eye API",
    description="Satellite imagery change detection for Gunnison County assessors",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
origins = [
    "http://localhost:5173",
    "http://localhost:3000",
]
if os.getenv("FRONTEND_URL"):
    origins.append(os.getenv("FRONTEND_URL"))

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(parcels.router, prefix="/api/parcels", tags=["parcels"])
app.include_router(scans.router, prefix="/api/scans", tags=["scans"])
app.include_router(detections.router, prefix="/api/detections", tags=["detections"])
app.include_router(flags.router, prefix="/api/flags", tags=["flags"])


@app.get("/api/health")
def health():
    return {"status": "ok"}
