import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useState } from "react";

export default function FilterSidebar({
  roasters,
  roastLevels,
  processes,
  filters,
  toggleArrayFilter,
  setFilters,
  clearAll,
  hasActiveFilters,
  resultCount,
}) {
  return (
    <div className="space-y-5">
      {/* Result count + clear */}
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">
          {resultCount} coffee{resultCount !== 1 ? "s" : ""}
        </p>
        {hasActiveFilters && (
          <button
            onClick={clearAll}
            className="text-xs font-medium cursor-pointer hover:underline"
            style={{ color: "var(--color-accent)" }}
          >
            Clear all
          </button>
        )}
      </div>

      {/* Sort */}
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider block mb-1"
          style={{ color: "var(--color-text-secondary)" }}>
          Sort By
        </label>
        <select
          value={filters.sortBy}
          onChange={(e) =>
            setFilters((f) => ({ ...f, sortBy: e.target.value }))
          }
          className="w-full rounded-lg border px-3 py-2 text-sm bg-white"
          style={{ borderColor: "var(--color-border)" }}
        >
          <option value="newest">Newest First</option>
          <option value="ppg-asc">Price (250g): Low to High</option>
          <option value="ppg-desc">Price (250g): High to Low</option>
          <option value="roaster-az">Roaster: A-Z</option>
          <option value="name-az">Name: A-Z</option>
        </select>
      </div>

      {/* Roaster */}
      <FilterSection title="Roaster" defaultOpen>
        {roasters.map((r) => (
          <CheckboxItem
            key={r.slug}
            label={`${r.name} (${r.coffeeCount})`}
            checked={filters.roasters.includes(r.slug)}
            onChange={() => toggleArrayFilter("roasters", r.slug)}
          />
        ))}
      </FilterSection>

      {/* Roast Level */}
      <FilterSection title="Roast Level" defaultOpen>
        {roastLevels.map((level) => (
          <CheckboxItem
            key={level}
            label={level}
            checked={filters.roastLevels.includes(level)}
            onChange={() => toggleArrayFilter("roastLevels", level)}
          />
        ))}
      </FilterSection>

      {/* Process */}
      <FilterSection title="Process">
        {processes.map((p) => (
          <CheckboxItem
            key={p}
            label={p}
            checked={filters.processes.includes(p)}
            onChange={() => toggleArrayFilter("processes", p)}
          />
        ))}
      </FilterSection>

      {/* Sold-out items are always hidden — no toggle needed */}
    </div>
  );
}

function FilterSection({ title, children, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center justify-between w-full text-xs font-semibold uppercase tracking-wider cursor-pointer py-1"
        style={{ color: "var(--color-text-secondary)" }}
      >
        {title}
        {open ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
      {open && (
        <div className="mt-1 space-y-1 max-h-48 overflow-y-auto pr-1">
          {children}
        </div>
      )}
    </div>
  );
}

function CheckboxItem({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm cursor-pointer py-0.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="accent-[var(--color-accent)] shrink-0"
      />
      <span className="truncate">{label}</span>
    </label>
  );
}
