"""
Crema API — CRUD Utopia edition.

Clean architecture: resource registry → generic CRUD engine → auto-generated endpoints.
Business logic lives in services, triggered by hooks.
Every response follows the { data, meta } envelope.
"""

import os
import re
import threading
from queue import Queue, Empty
import json
import asyncio

# Load `.env` from the same directory as this `main.py`, regardless of
# the cwd uvicorn was launched from. `load_dotenv()` with no argument
# walks up from cwd, which silently fails when uvicorn is started from
# a parent / sibling directory — surface as "ANTHROPIC_API_KEY is not
# set" 503s. Anchoring to `__file__` makes it cwd-independent.
# Production (Fly) injects the same vars via `fly secrets set`, so the
# `os.environ.get(...)` read-path is identical in both worlds.
# Per LAUNCH_TODO §1.2, the file is gitignored at repo root (line 11).
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent / ".env")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sse_starlette.sse import EventSourceResponse

from database import init_db, get_db
from resources.envelope import ok
from services.auth import get_current_user
from services.catalog_sync import sync_products
from fastapi import Depends, Header

# ── App setup ────────────────────────────────────────────────────────────────

app = FastAPI(
    title="Crema API",
    version="2.0",
    description="CRUD Utopia — resource-driven API for Indian specialty coffee community.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize database
init_db()

# Uploads directory
_UPLOADS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(_UPLOADS_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=_UPLOADS_DIR), name="uploads")

# ── Mount routers ────────────────────────────────────────────────────────────

from routes.auth import router as auth_router
from routes.uploads import router as uploads_router
from routes.dictionary_routes import router as dictionary_router
from routes.specific import router as specific_router
from routes.resources import router as resources_router

app.include_router(auth_router)
app.include_router(uploads_router)
app.include_router(dictionary_router)
app.include_router(specific_router)  # specific routes BEFORE catch-all
app.include_router(resources_router)  # catch-all LAST


# ── Root ─────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"service": "Crema API", "version": "2.0", "architecture": "CRUD Utopia"}


# Link-preview used to be declared here on @app.get, but it was
# shadowed by resources_router's `/{resource}` catch-all which
# matched "link-preview" first. Moved to specific.py so it sits
# under the same router as other pre-catchall endpoints.


# ── Catalog Sync (imports scraped JSON → products table) ─────────────────────

@app.post("/api/catalog/sync")
def catalog_sync(user=Depends(get_current_user)):
    """Import all scraped/manual products into the products table."""
    result = sync_products()
    return ok(result, resource="catalog")


# ── Catalog Refresh (SSE scraper — preserved from v1) ────────────────────────

_BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_refresh_lock = threading.Lock()


@app.get("/api/catalog/refresh")
async def refresh_all(user=Depends(get_current_user)):
    """SSE endpoint: runs catalog discovery + product scraper end-to-end."""
    if not _refresh_lock.acquire(blocking=False):
        async def already_running():
            yield {"event": "error", "data": json.dumps({"error": "Refresh already in progress"})}
        return EventSourceResponse(already_running())

    queue = Queue()

    def _run_full_refresh():
        try:
            import importlib.util
            import sys

            _CATALOG_PIPELINE = os.path.join(_BASE, "Scraper", "coffee-catalog", "pipeline")
            _SCRAPER_DIR = os.path.join(_BASE, "Scraper", "scraper")

            # Phase 1-4: Catalog pipeline
            phases = [
                ("discovery", "01_discover.py"),
                ("verification", "02_verify.py"),
                ("enrichment", "03_enrich.py"),
                ("assembly", "04_assemble.py"),
            ]
            for phase_name, script in phases:
                script_path = os.path.join(_CATALOG_PIPELINE, script)
                if not os.path.exists(script_path):
                    queue.put({"event": phase_name, "data": json.dumps({"status": "skipped", "reason": "script not found"})})
                    continue
                try:
                    spec = importlib.util.spec_from_file_location(f"phase_{phase_name}", script_path)
                    mod = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(mod)
                    if hasattr(mod, "main"):
                        mod.main()
                    queue.put({"event": phase_name, "data": json.dumps({"status": "complete"})})
                except Exception as e:
                    queue.put({"event": phase_name, "data": json.dumps({"status": "error", "error": str(e)})})

            # Phase 5: Scraper
            queue.put({"event": "scraping", "data": json.dumps({"status": "starting"})})
            scraper_main = os.path.join(_SCRAPER_DIR, "main.py")
            if os.path.exists(scraper_main):
                try:
                    spec = importlib.util.spec_from_file_location("scraper_main", scraper_main)
                    mod = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(mod)
                    if hasattr(mod, "main"):
                        mod.main()
                    queue.put({"event": "scraping", "data": json.dumps({"status": "complete"})})
                except Exception as e:
                    queue.put({"event": "scraping", "data": json.dumps({"status": "error", "error": str(e)})})

            # Final: sync into DB
            result = sync_products()
            queue.put({"event": "sync", "data": json.dumps({"status": "complete", **result})})
        finally:
            queue.put(None)
            _refresh_lock.release()

    thread = threading.Thread(target=_run_full_refresh, daemon=True)
    thread.start()

    async def event_stream():
        while True:
            try:
                event = await asyncio.get_event_loop().run_in_executor(None, queue.get, True, 1.0)
            except Empty:
                continue
            if event is None:
                break
            yield event

    return EventSourceResponse(event_stream())
