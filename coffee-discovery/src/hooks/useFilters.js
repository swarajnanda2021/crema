import { useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";

const EMPTY = {
  roasters: [],
  roastLevels: [],
  origins: [],
  processes: [],
  priceMin: null,
  priceMax: null,
  showUnavailable: true,
  sortBy: "newest",
  query: "",
};

function parseParams(sp) {
  return {
    roasters: sp.get("roaster")?.split(",").filter(Boolean) ?? [],
    roastLevels: sp.get("roast")?.split(",").filter(Boolean) ?? [],
    origins: sp.get("origin")?.split(",").filter(Boolean) ?? [],
    processes: sp.get("process")?.split(",").filter(Boolean) ?? [],
    priceMin: sp.get("priceMin") ? Number(sp.get("priceMin")) : null,
    priceMax: sp.get("priceMax") ? Number(sp.get("priceMax")) : null,
    showUnavailable: sp.get("avail") !== "0",
    sortBy: sp.get("sort") || "newest",
    query: sp.get("q") || "",
  };
}

function toParams(filters) {
  const p = new URLSearchParams();
  if (filters.roasters.length) p.set("roaster", filters.roasters.join(","));
  if (filters.roastLevels.length)
    p.set("roast", filters.roastLevels.join(","));
  if (filters.origins.length) p.set("origin", filters.origins.join(","));
  if (filters.processes.length) p.set("process", filters.processes.join(","));
  if (filters.priceMin != null) p.set("priceMin", String(filters.priceMin));
  if (filters.priceMax != null) p.set("priceMax", String(filters.priceMax));
  if (!filters.showUnavailable) p.set("avail", "0");
  if (filters.sortBy !== "newest") p.set("sort", filters.sortBy);
  if (filters.query) p.set("q", filters.query);
  return p;
}

export function useFilters() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = parseParams(searchParams);

  const setFilters = useCallback(
    (updater) => {
      const current = parseParams(searchParams);
      const next = typeof updater === "function" ? updater(current) : updater;
      setSearchParams(toParams(next), { replace: true });
    },
    [searchParams, setSearchParams]
  );

  const toggleArrayFilter = useCallback(
    (key, value) => {
      setFilters((prev) => {
        const arr = prev[key];
        const next = arr.includes(value)
          ? arr.filter((v) => v !== value)
          : [...arr, value];
        return { ...prev, [key]: next };
      });
    },
    [setFilters]
  );

  const clearAll = useCallback(() => {
    setSearchParams(new URLSearchParams(), { replace: true });
  }, [setSearchParams]);

  const hasActiveFilters =
    filters.roasters.length > 0 ||
    filters.roastLevels.length > 0 ||
    filters.origins.length > 0 ||
    filters.processes.length > 0 ||
    filters.priceMin != null ||
    filters.priceMax != null ||
    !filters.showUnavailable ||
    filters.query !== "";

  return {
    filters,
    setFilters,
    toggleArrayFilter,
    clearAll,
    hasActiveFilters,
  };
}
