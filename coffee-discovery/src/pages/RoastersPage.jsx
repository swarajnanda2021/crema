import { Link } from "react-router-dom";
import { useRoasterProfiles } from "../hooks/useRoasterProfiles";
import { useCoffeeData } from "../hooks/useCoffeeData";
import { MapPin, Star, Calendar, ExternalLink } from "lucide-react";
import { useState, useMemo } from "react";

export default function RoastersPage() {
  const { profiles, loading } = useRoasterProfiles();
  const { roasters } = useCoffeeData();
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState("");

  // Merge profile data with coffee counts from product data
  const enriched = useMemo(() => {
    const coffeeCountMap = new Map(roasters.map((r) => [r.slug, r.coffeeCount]));

    return profiles
      .map((p) => ({
        ...p,
        coffeeCount: coffeeCountMap.get(p.roaster_slug) || 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [profiles, roasters]);

  const states = useMemo(
    () => [...new Set(enriched.map((r) => r.state).filter(Boolean))].sort(),
    [enriched]
  );

  const filtered = useMemo(() => {
    let result = enriched;
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          (r.city || "").toLowerCase().includes(q) ||
          (r.state || "").toLowerCase().includes(q)
      );
    }
    if (stateFilter) {
      result = result.filter((r) => r.state === stateFilter);
    }
    return result;
  }, [enriched, search, stateFilter]);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-4 py-20 text-center">
        <p style={{ color: "var(--color-text-secondary)" }}>Loading roasters...</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-6">
      <h1
        className="text-3xl font-bold mb-2"
        style={{ fontFamily: "var(--font-serif)" }}
      >
        Indian Coffee Roasters
      </h1>
      <p className="mb-6" style={{ color: "var(--color-text-secondary)" }}>
        {enriched.length} verified specialty roasters across {states.length} states
      </p>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search roasters..."
          className="rounded-lg px-3 py-2 text-sm border flex-1 min-w-[200px]"
          style={{ borderColor: "var(--color-border)" }}
        />
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="rounded-lg px-3 py-2 text-sm border bg-white"
          style={{ borderColor: "var(--color-border)" }}
        >
          <option value="">All States</option>
          {states.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Roaster grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((r) => (
          <RoasterCard key={r.roaster_slug} roaster={r} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16">
          <p className="text-xl mb-2">No roasters match your search.</p>
        </div>
      )}
    </div>
  );
}

function RoasterCard({ roaster }) {
  const r = roaster;

  return (
    <Link
      to={`/roaster/${r.roaster_slug}`}
      className="block rounded-xl p-4 transition-shadow hover:shadow-md"
      style={{
        background: "var(--color-card-front)",
        border: "1px solid var(--color-border)",
      }}
    >
      <div className="flex items-start gap-3">
        {/* Logo */}
        {r.logo_url ? (
          <div
            className="w-12 h-12 rounded-lg overflow-hidden border shrink-0"
            style={{ borderColor: "var(--color-border)" }}
          >
            <img
              src={r.logo_url}
              alt=""
              className="w-full h-full object-contain p-1"
              loading="lazy"
            />
          </div>
        ) : (
          <div
            className="w-12 h-12 rounded-lg flex items-center justify-center text-lg font-bold shrink-0"
            style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}
          >
            {r.name.charAt(0)}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-sm leading-snug truncate">
            {r.name}
          </h3>
          <p className="text-xs mt-0.5 flex items-center gap-1" style={{ color: "var(--color-text-secondary)" }}>
            <MapPin size={10} />
            {r.city}, {r.state}
          </p>
        </div>
      </div>

      {/* Meta */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-3 text-xs" style={{ color: "var(--color-text-secondary)" }}>
        {r.rating && (
          <span className="inline-flex items-center gap-0.5">
            <Star size={10} fill="currentColor" /> {r.rating}
          </span>
        )}
        {r.founding_year && (
          <span className="inline-flex items-center gap-0.5">
            <Calendar size={10} /> {r.founding_year}
          </span>
        )}
        {r.coffeeCount > 0 && (
          <span>{r.coffeeCount} coffee{r.coffeeCount !== 1 ? "s" : ""}</span>
        )}
        <span className="px-1.5 py-0.5 rounded text-[10px]" style={{ background: "var(--color-tag-bg)" }}>
          {r.platform}
        </span>
      </div>

      {/* Specialties */}
      {r.specialties && r.specialties.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {r.specialties.slice(0, 3).map((s) => (
            <span
              key={s}
              className="text-[10px] px-1.5 py-0.5 rounded-full"
              style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}
            >
              {s.replace(/-/g, " ")}
            </span>
          ))}
        </div>
      )}
    </Link>
  );
}
