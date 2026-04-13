import { createContext, useContext, useState, useEffect, useMemo, useCallback, ReactNode } from "react";
import { apiFetchRaw } from "../api/client";

// Bundled fallback data
import fallbackProducts from "../data/products.json";

const CoffeeDataContext = createContext<any>(null);

export function CoffeeDataProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetchRaw<any>("/products");
      const data = res?.data ?? res;
      setProducts(Array.isArray(data) ? data : []);
    } catch {
      // Fallback to bundled JSON
      setProducts(Array.isArray(fallbackProducts) ? fallbackProducts : []);
    } finally {
      setLoading(false);
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
