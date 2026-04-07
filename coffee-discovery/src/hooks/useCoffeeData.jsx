import { createContext, useContext, useState, useEffect, useMemo, useCallback } from "react";

const CoffeeDataContext = createContext(null);

/**
 * Provider — wraps the app, fetches from /api/products on mount.
 * No confidence gate — all products are shown. Sold-out and unknown-roast
 * filtering happens in filterCoffees.js instead.
 */
export function CoffeeDataProvider({ children }) {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/products");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setProducts(data);
    } catch (err) {
      console.error("Failed to fetch products:", err);
      try {
        const mod = await import("../data/products.json");
        const fallback = mod.default || mod;
        setProducts(Array.isArray(fallback) ? fallback : []);
      } catch {
        // No data at all
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const appendProducts = useCallback((newProducts) => {
    if (!newProducts || newProducts.length === 0) return;
    setProducts((prev) => {
      const ids = new Set(prev.map((p) => p.product_id));
      const fresh = newProducts.filter((p) => !ids.has(p.product_id));
      return fresh.length > 0 ? [...prev, ...fresh] : prev;
    });
  }, []);

  const derived = useMemo(() => {
    const roasterMap = new Map();
    products.forEach((p) => {
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
    const roasters = Array.from(roasterMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
    const roastLevels = [...new Set(products.map((p) => p.roast_level).filter(Boolean))].sort();
    const origins = [...new Set(products.map((p) => p.origin).filter(Boolean))].sort();
    const processes = [...new Set(products.map((p) => p.process).filter(Boolean))].sort();
    const productMap = new Map(products.map((p) => [p.product_id, p]));

    return { roasters, roastLevels, origins, processes, productMap };
  }, [products]);

  const value = {
    products,
    loading,
    fetchProducts,
    appendProducts,
    ...derived,
  };

  return (
    <CoffeeDataContext.Provider value={value}>
      {children}
    </CoffeeDataContext.Provider>
  );
}

export function useCoffeeData() {
  const ctx = useContext(CoffeeDataContext);
  if (!ctx) throw new Error("useCoffeeData must be inside CoffeeDataProvider");
  return ctx;
}
