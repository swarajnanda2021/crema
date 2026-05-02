import { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef, ReactNode } from "react";
import { apiFetchRaw } from "../api/client";

// Bundled fallback data
import fallbackProducts from "../data/products.json";

const CoffeeDataContext = createContext<any>(null);

export function CoffeeDataProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Stale-while-revalidate. The first fetch on app boot blocks the
  // page (loading=true) so consumers can show a spinner. Subsequent
  // refetches — fired by `useFocusEffect` on Discover and similar
  // pages so admin-approved beans appear without an app reload —
  // run silently: they update `products` in place but never flip
  // `loading` back to true. The page renders the stale cache
  // instantly and updates a tick later when the fresh payload
  // lands. Without this, every Discover return triggered a full
  // ~MB payload + loading gate (the dominant Discover-load cost).
  const hasFetchedRef = useRef(false);
  const fetchProducts = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = opts?.silent ?? hasFetchedRef.current;
    if (!silent) setLoading(true);
    try {
      // Explicit high limit — the registry default is 500 and the
      // catalog passed that mark with the late-April scrape batch
      // (currently ~780 rows). Without this, alphabetically late
      // products silently disappear from Discover BEANS + the
      // per-roaster consumer page (both flow through this hook).
      // Bumping to 5000 covers headroom through Phase 2 catalog
      // growth before we'd ever need true pagination on Discover.
      const res = await apiFetchRaw<any>("/products?limit=5000");
      const data = res?.data ?? res;
      setProducts(Array.isArray(data) ? data : []);
      hasFetchedRef.current = true;
    } catch {
      // Fallback to bundled JSON only on the very first fetch — silent
      // refreshes that fail leave the existing cache untouched so the
      // user keeps seeing real data instead of being kicked back to
      // a stale bundle.
      if (!hasFetchedRef.current) {
        setProducts(Array.isArray(fallbackProducts) ? fallbackProducts : []);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const appendProducts = useCallback((newProducts: any[]) => {
    if (!newProducts || newProducts.length === 0) return;
    setProducts((prev) => {
      const ids = new Set(prev.map((p) => p.product_id));
      const fresh = newProducts.filter((p) => !ids.has(p.product_id));
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    });
  }, []);

  const removeProduct = useCallback((productId: string) => {
    setProducts((prev) => prev.filter((p) => p.product_id !== productId));
  }, []);

  // Normalise products: detect barrel-aged by name, stamp process field
  const BARREL_RE = /barrel[\s-]aged|rum[\s-]aged|whiskey[\s-]barrel|rum[\s-]barrel|wine[\s-]barrel|agave[\s-]barrel|cask[\s-]reserve/i;
  const normalisedProducts = useMemo(() => products.map((p) => {
    if (BARREL_RE.test(p.coffee_name || "")) {
      return { ...p, process: "Barrel-Aged" };
    }
    return p;
  }), [products]);

  const derived = useMemo(() => {
    const roasterMap = new Map();
    normalisedProducts.forEach((p) => {
      if (!roasterMap.has(p.roaster_slug)) {
        roasterMap.set(p.roaster_slug, {
          slug: p.roaster_slug,
          name: p.roaster_name,
          city: p.roaster_city,
          state: p.roaster_state,
          lat: p.roaster_lat,
          lng: p.roaster_lng,
          website: p.roaster_website,
          coffeeCount: 0,
        });
      }
      roasterMap.get(p.roaster_slug).coffeeCount++;
    });
    const roasters = Array.from(roasterMap.values()).sort((a: any, b: any) =>
      (a.name || "").localeCompare(b.name || "")
    );
    const roastLevels = [...new Set(normalisedProducts.map((p) => p.roast_level).filter(Boolean))]
      .filter((l) => l !== "Unknown")
      .sort();
    const origins = [...new Set(normalisedProducts.map((p) => p.origin).filter(Boolean))].sort();
    const processes = [...new Set(normalisedProducts.map((p) => p.process).filter(Boolean))].sort();
    const productMap = new Map(normalisedProducts.map((p) => [p.product_id, p]));
    return { roasters, roastLevels, origins, processes, productMap };
  }, [normalisedProducts]);

  return (
    <CoffeeDataContext.Provider value={{ products: normalisedProducts, loading, fetchProducts, appendProducts, removeProduct, ...derived }}>
      {children}
    </CoffeeDataContext.Provider>
  );
}

export function useCoffeeData() {
  const ctx = useContext(CoffeeDataContext);
  if (!ctx) throw new Error("useCoffeeData must be inside CoffeeDataProvider");
  return ctx;
}
