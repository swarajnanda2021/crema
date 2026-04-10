"""
FastAPI server bridging the Python scraper to the React frontend via SSE.

    cd Scraper/
    pip install -r server/requirements.txt
    uvicorn server.app:app --port 8000 --reload
"""

import asyncio
import json
import os
import sys
import threading
from queue import Queue, Empty

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sse_starlette.sse import EventSourceResponse

# Add the scraper package to sys.path
_SERVER_DIR = os.path.dirname(os.path.abspath(__file__))
_SCRAPER_DIR = os.path.join(_SERVER_DIR, "..", "scraper")
_OUTPUT_DIR = os.path.join(_SERVER_DIR, "..", "output")
sys.path.insert(0, _SCRAPER_DIR)

from main import scrape_all_generator, passes_quality_gate  # noqa: E402

app = FastAPI(title="CoffeeCatalog API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Lock to prevent concurrent scrapes
_scrape_lock = threading.Lock()


@app.get("/api/products")
def get_products():
    """
    Return products. Prefers products_enriched.json (LLM-enriched) when it
    exists; falls back to products.json (raw scrape output).
    """
    for filename in ("products_enriched.json", "products.json"):
        path = os.path.join(_OUTPUT_DIR, filename)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as f:
                return json.load(f)
    return []


@app.get("/api/roasters")
def get_roasters():
    """Return enriched roaster profiles from the crema-app data file."""
    # Primary: enriched roasters.json maintained in crema-app
    primary_path = os.path.join(
        os.path.dirname(__file__), "..", "..", "crema-app", "src", "data", "roasters.json"
    )
    if os.path.exists(primary_path):
        with open(primary_path, encoding="utf-8") as f:
            return json.load(f)
    # Fallback: old catalog pipeline output
    catalog_path = os.path.join(
        os.path.dirname(__file__), "..", "coffee-catalog", "output",
        "verified_roasters_catalog.json"
    )
    if not os.path.exists(catalog_path):
        return []
    with open(catalog_path, encoding="utf-8") as f:
        data = json.load(f)
    return data.get("roasters", [])


@app.get("/api/scrape")
async def scrape_sse():
    """
    SSE endpoint — starts the scraper in a background thread and
    streams events (roaster_start, roaster_done, roaster_failed,
    scrape_complete) to the connected client.
    """
    if not _scrape_lock.acquire(blocking=False):

        async def already_running():
            yield {
                "event": "error",
                "data": json.dumps({"error": "A catalog refresh is already in progress."}),
            }

        return EventSourceResponse(already_running())

    queue: Queue = Queue()

    def run_scraper():
        try:
            for event in scrape_all_generator():
                queue.put(event)
        except Exception as exc:
            queue.put({
                "event": "error",
                "data": {"error": str(exc)},
            })
        finally:
            queue.put(None)  # sentinel — signals end of stream
            _scrape_lock.release()

    thread = threading.Thread(target=run_scraper, daemon=True)
    thread.start()

    async def event_stream():
        loop = asyncio.get_event_loop()
        while True:
            try:
                event = await loop.run_in_executor(None, lambda: queue.get(timeout=1))
            except Empty:
                # Send keepalive comment to prevent proxy timeouts
                yield {"comment": "keepalive"}
                continue

            if event is None:
                break

            # Serialize the data payload to JSON string
            data = event.get("data", {})
            yield {
                "event": event["event"],
                "data": json.dumps(data, ensure_ascii=False, default=str),
            }

    return EventSourceResponse(event_stream())
