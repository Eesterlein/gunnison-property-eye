"""
Server-side cache for aerial/satellite thumbnails.

Browsers used to load every year's thumbnail straight from Earth Engine — a
dozen requests at once per parcel page, which Earth Engine answers with
"429 Too Many Requests" whenever the project is busy (e.g. during a scan).
Now the server fetches each image at most once, with a small global limit on
concurrent Earth Engine requests and retries on 429, and serves it from disk
afterwards. NAIP flights and completed satellite seasons never change, so a
cached image stays valid.
"""
import os
import threading
import time
from pathlib import Path

import httpx

CACHE_DIR = Path(os.getenv("AERIAL_CACHE_DIR", "/app/cache/aerial"))
MAX_CACHE_BYTES = int(os.getenv("AERIAL_CACHE_MAX_MB", "3000")) * 1024 * 1024
MAX_CONCURRENT_EE_FETCHES = 3
RETRY_DELAYS_S = [1, 2, 4, 8, 15]

_ee_slots = threading.Semaphore(MAX_CONCURRENT_EE_FETCHES)
_key_locks: dict[str, threading.Lock] = {}
_key_locks_guard = threading.Lock()


def _lock_for(key: str) -> threading.Lock:
    with _key_locks_guard:
        return _key_locks.setdefault(key, threading.Lock())


def _download(url: str) -> bytes:
    """Fetch a rendered PNG from Earth Engine, retrying while it's rate-limited."""
    for attempt, delay in enumerate([0] + RETRY_DELAYS_S):
        if delay:
            time.sleep(delay)
        with _ee_slots:
            resp = httpx.get(url, timeout=120)
        if resp.status_code == 200:
            return resp.content
        if resp.status_code not in (429, 500, 502, 503, 504) or attempt == len(RETRY_DELAYS_S):
            resp.raise_for_status()
    raise RuntimeError("unreachable")


def _prune() -> None:
    """Drop the least recently used images once the cache passes its size cap."""
    files = [(f.stat().st_atime, f.stat().st_size, f) for f in CACHE_DIR.glob("*.png")]
    total = sum(size for _, size, _ in files)
    for _, size, f in sorted(files):
        if total <= MAX_CACHE_BYTES * 0.8:
            break
        f.unlink(missing_ok=True)
        total -= size


def get_image_path(key: str, build_url) -> Path:
    """
    Local path of the cached PNG for `key`, rendering it via `build_url()`
    (which returns an Earth Engine thumbnail URL) on first request.
    """
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    path = CACHE_DIR / f"{key}.png"
    if path.exists():
        return path
    with _lock_for(key):  # concurrent requests for the same image wait for one fetch
        if path.exists():
            return path
        with _ee_slots:
            url = build_url()
        data = _download(url)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(data)
        tmp.replace(path)
    if sum(f.stat().st_size for f in CACHE_DIR.glob("*.png")) > MAX_CACHE_BYTES:
        _prune()
    return path
