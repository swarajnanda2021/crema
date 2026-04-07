import { useState, useCallback, useRef } from "react";

/**
 * SSE-based hook to trigger and track a catalog refresh (scrape).
 *
 * @param {Object} opts
 * @param {Function} opts.onProducts  — called with an array of new products per roaster
 * @param {Function} opts.onComplete  — called when the full scrape finishes
 */
export function useScrape({ onProducts, onComplete }) {
  const [scraping, setScraping] = useState(false);
  const [progress, setProgress] = useState(null);
  const esRef = useRef(null);

  const startScrape = useCallback(() => {
    if (scraping) return;
    setScraping(true);
    setProgress({
      index: 0,
      total: 0,
      roaster: "Connecting...",
      platform: "",
      coffeesFound: 0,
    });

    const es = new EventSource("/api/scrape");
    esRef.current = es;

    es.addEventListener("roaster_start", (e) => {
      const d = JSON.parse(e.data);
      setProgress((prev) => ({
        ...prev,
        index: d.index,
        total: d.total,
        roaster: d.roaster,
        platform: d.platform,
      }));
    });

    es.addEventListener("roaster_done", (e) => {
      const d = JSON.parse(e.data);
      setProgress((prev) => ({
        ...prev,
        coffeesFound: (prev?.coffeesFound || 0) + d.coffees_found,
      }));
      if (d.products && d.products.length > 0) {
        onProducts(d.products);
      }
    });

    es.addEventListener("roaster_failed", () => {
      // Failures are expected for some sites — just continue
    });

    es.addEventListener("scrape_complete", (e) => {
      const d = JSON.parse(e.data);
      es.close();
      setScraping(false);
      setProgress(null);
      onComplete?.(d);
    });

    es.addEventListener("error", (e) => {
      // SSE "error" can be a named event from the server (already running)
      // or a connection error. Handle both.
      try {
        if (e.data) {
          const d = JSON.parse(e.data);
          console.warn("Scrape error:", d.error);
        }
      } catch {
        // connection error, not a JSON event
      }
      es.close();
      setScraping(false);
      setProgress(null);
    });

    es.onerror = () => {
      es.close();
      setScraping(false);
      setProgress(null);
    };
  }, [scraping, onProducts, onComplete]);

  const cancelScrape = useCallback(() => {
    esRef.current?.close();
    setScraping(false);
    setProgress(null);
  }, []);

  return { scraping, progress, startScrape, cancelScrape };
}
