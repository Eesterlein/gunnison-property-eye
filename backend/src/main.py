import time
from collections import defaultdict, deque

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import os

from src.database import create_tables
from src.routes import parcels, scans, detections, flags, auth
from src.services import gee_service
from src.scheduler import start_scheduler, stop_scheduler
from src.middleware.auth import get_current_user

# Public read-only demo: no login, every write refused, imagery requests
# rate-limited per visitor. Owner names are stripped from the demo database
# itself (scripts/export_demo_db.sh), not just hidden here.
DEMO_MODE = os.getenv("DEMO_MODE", "").lower() in ("1", "true", "yes")


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

if DEMO_MODE:
    class _DemoUser:
        id = None
        email = "demo"
        role = "viewer"
        is_active = True

    app.dependency_overrides[get_current_user] = lambda: _DemoUser()

    # Each aerial-history / close-up request costs several Earth Engine calls.
    IMAGERY_LIMIT_PER_MINUTE = int(os.getenv("DEMO_IMAGERY_LIMIT_PER_MINUTE", "20"))
    _imagery_hits: dict[str, deque] = defaultdict(deque)

    def _client_ip(request: Request) -> str:
        # Behind Caddy: the last X-Forwarded-For entry is the one Caddy added
        forwarded = request.headers.get("x-forwarded-for", "")
        return forwarded.split(",")[-1].strip() if forwarded else request.client.host

    @app.middleware("http")
    async def demo_guard(request: Request, call_next):
        if request.method not in ("GET", "HEAD", "OPTIONS"):
            return JSONResponse({"detail": "This is a read-only demo."}, status_code=403)
        if request.url.path.endswith(("/aerial-history", "/aerial-closeup", "/imagery")):
            hits = _imagery_hits[_client_ip(request)]
            now = time.monotonic()
            while hits and now - hits[0] > 60:
                hits.popleft()
            if len(hits) >= IMAGERY_LIMIT_PER_MINUTE:
                return JSONResponse(
                    {"detail": "Too many imagery requests — please wait a minute."}, status_code=429
                )
            hits.append(now)
        return await call_next(request)


app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(parcels.router, prefix="/api/parcels", tags=["parcels"])
app.include_router(scans.router, prefix="/api/scans", tags=["scans"])
app.include_router(detections.router, prefix="/api/detections", tags=["detections"])
app.include_router(flags.router, prefix="/api/flags", tags=["flags"])


@app.get("/api/health")
def health():
    return {"status": "ok", "demo": DEMO_MODE}
