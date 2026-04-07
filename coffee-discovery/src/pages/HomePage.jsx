import { useMemo, useState, useEffect } from "react";
import { useCoffeeData } from "../hooks/useCoffeeData";
import { useFilters } from "../hooks/useFilters";
import { filterCoffees } from "../utils/filterCoffees";
import CardGrid from "../components/CardGrid";
import FilterSidebar from "../components/FilterSidebar";
// Recommender removed from Browse per user request
import { SlidersHorizontal, X } from "lucide-react";

export default function HomePage() {
  const { products, roasters, roastLevels, processes } = useCoffeeData();
  const { filters, setFilters, toggleArrayFilter, clearAll, hasActiveFilters } =
    useFilters();

  const [mobileFilterOpen, setMobileFilterOpen] = useState(false);
  const [popularity, setPopularity] = useState({});

  // Fetch popularity counts
  useEffect(() => {
    fetch(`http://${window.location.hostname}:8000/api/products/popularity`)
      .then((r) => r.ok ? r.json() : {})
      .then(setPopularity)
      .catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    let result = filterCoffees(products, filters);
    // Default sort: most popular first (by number of users who have it on shelf)
    if (filters.sortBy === "newest" && Object.keys(popularity).length > 0) {
      result = [...result].sort((a, b) =>
        (popularity[b.product_id] || 0) - (popularity[a.product_id] || 0)
      );
    }
    return result;
  }, [products, filters, popularity]);

  return (
    <div className="flex max-w-[1600px] mx-auto">
      {/* Desktop sidebar */}
      <aside
        className="hidden lg:block w-[260px] shrink-0 p-6 sticky top-16 h-[calc(100vh-64px)] overflow-y-auto border-r"
        style={{ borderColor: "var(--color-border)" }}
      >
        <FilterSidebar
          roasters={roasters}
          roastLevels={roastLevels}
          processes={processes}
          filters={filters}
          toggleArrayFilter={toggleArrayFilter}
          setFilters={setFilters}
          clearAll={clearAll}
          hasActiveFilters={hasActiveFilters}
          resultCount={filtered.length}
        />
      </aside>

      {/* Main content */}
      <div className="flex-1 p-4 md:p-6">
        {/* Toolbar */}
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>
            <span className="font-semibold" style={{ color: "var(--color-text-primary)" }}>
              {filtered.length}
            </span>{" "}
            coffees from{" "}
            <span className="font-semibold" style={{ color: "var(--color-text-primary)" }}>
              {roasters.length}
            </span>{" "}
            roasters
          </p>

          {/* Mobile filter toggle */}
          <button
            onClick={() => setMobileFilterOpen(true)}
            className="lg:hidden flex items-center gap-1.5 px-3 py-2 rounded-lg border text-sm font-medium cursor-pointer"
            style={{ borderColor: "var(--color-border)" }}
          >
            <SlidersHorizontal size={16} />
            Filters
            {hasActiveFilters && (
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: "var(--color-accent)" }}
              />
            )}
          </button>
        </div>

        {/* Active filter chips */}
        {hasActiveFilters && (
          <div className="flex flex-wrap gap-2 mb-4">
            {filters.roasters.map((slug) => {
              const r = roasters.find((r) => r.slug === slug);
              return (
                <Chip
                  key={slug}
                  label={r?.name || slug}
                  onRemove={() => toggleArrayFilter("roasters", slug)}
                />
              );
            })}
            {filters.roastLevels.map((level) => (
              <Chip
                key={level}
                label={level}
                onRemove={() => toggleArrayFilter("roastLevels", level)}
              />
            ))}
            {filters.processes.map((p) => (
              <Chip
                key={p}
                label={p}
                onRemove={() => toggleArrayFilter("processes", p)}
              />
            ))}
            {filters.query && (
              <Chip
                label={`"${filters.query}"`}
                onRemove={() => setFilters((f) => ({ ...f, query: "" }))}
              />
            )}
            <button
              onClick={clearAll}
              className="text-xs font-medium cursor-pointer hover:underline px-2"
              style={{ color: "var(--color-accent)" }}
            >
              Clear all
            </button>
          </div>
        )}

        <CardGrid coffees={filtered} popularity={popularity} />
      </div>

      {/* Mobile filter bottom sheet */}
      {mobileFilterOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setMobileFilterOpen(false)}
          />
          <div
            className="absolute bottom-0 left-0 right-0 bg-white rounded-t-2xl p-6 max-h-[80vh] overflow-y-auto"
            style={{ background: "var(--color-bg)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold">Filters</h2>
              <button
                onClick={() => setMobileFilterOpen(false)}
                className="cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>
            <FilterSidebar
              roasters={roasters}
              roastLevels={roastLevels}
              processes={processes}
              filters={filters}
              toggleArrayFilter={toggleArrayFilter}
              setFilters={setFilters}
              clearAll={clearAll}
              hasActiveFilters={hasActiveFilters}
              resultCount={filtered.length}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ label, onRemove }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full"
      style={{
        background: "var(--color-tag-bg)",
        color: "var(--color-tag-text)",
      }}
    >
      {label}
      <button
        onClick={onRemove}
        className="cursor-pointer hover:opacity-70"
        aria-label={`Remove ${label} filter`}
      >
        <X size={12} />
      </button>
    </span>
  );
}
