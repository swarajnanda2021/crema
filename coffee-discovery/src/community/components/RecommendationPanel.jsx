import { useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Coffee, MapPin, Mountain, ShoppingCart, Settings, Share2, Plus } from "lucide-react";
import { pricePer250g } from "../../utils/formatPrice";
import { trackClick } from "../api";
import IndiaMap from "../../components/IndiaMap";
import { resolveOriginCoords } from "../../data/coffeeRegions";
import { useShelves } from "../hooks/useShelves";

export default function RecommendationPanel({ recommendations, onAddToShelf, horizontal, count = 3 }) {
  if (!recommendations || recommendations.length === 0) return null;

  return (
    <div className="flex flex-col h-full">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider mb-2 shrink-0"
        style={{ color: "var(--color-text-secondary)" }}>
        <Sparkles size={12} /> You might like
      </h3>

      <div className={horizontal
        ? "flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory"
        : "flex-1 overflow-y-auto space-y-3 pr-1"
      }>
        {recommendations.slice(0, count).map((coffee) => (
          <MiniCard
            key={coffee.product_id}
            coffee={coffee}
            className={horizontal ? "min-w-[220px] shrink-0 snap-start" : ""}
          />
        ))}
      </div>

      {/* Ad placeholder */}
      <div
        className="rounded-lg p-4 mt-3 text-center border-2 border-dashed shrink-0"
        style={{ borderColor: "var(--color-border)", color: "var(--color-text-secondary)" }}
      >
        <p className="text-[10px]">Ad space</p>
      </div>
    </div>
  );
}

function MiniCard({ coffee, className = "" }) {
  const [flipped, setFlipped] = useState(false);
  const { getShelfForProduct, addToShelf, removeFromShelf } = useShelves();
  const price250 = pricePer250g(coffee.price_per_gram);
  const originCoords = resolveOriginCoords(coffee.origin, coffee.coffee_name);
  const isNovel = coffee._novel;

  return (
    <div
      className={`card-container cursor-pointer w-full ${className}`}
      style={{ height: 200 }}
      onClick={() => setFlipped((f) => !f)}
    >
      <div className={`card-inner ${flipped ? "flipped" : ""} ${flipped ? "card-shadow-flipped" : "card-shadow hover:card-shadow-hover"} transition-shadow`}>

        {/* ── Front ──────────────────────────────────── */}
        <div className="card-front flex flex-row" style={{ background: "var(--color-card-front)" }}>
          {/* Left: image */}
          <div className="w-[100px] shrink-0 overflow-hidden img-placeholder">
            {coffee.image_url ? (
              <img src={coffee.image_url} alt="" loading="lazy" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Coffee size={20} style={{ color: "var(--color-border)" }} />
              </div>
            )}
          </div>

          {/* Right: details */}
          <div className="flex-1 min-w-0 p-2.5 flex flex-col justify-between">
            <div>
              {isNovel && (
                <span className="text-[8px] font-semibold px-1 py-0.5 rounded-full mb-1 inline-block"
                  style={{ background: "var(--color-accent)", color: "white" }}>
                  New to you
                </span>
              )}
              <h3 className="text-[11px] font-semibold leading-tight line-clamp-2" style={{ fontFamily: "var(--font-serif)" }}>
                {coffee.coffee_name}
              </h3>
              <Link
                to={`/roaster/${coffee.roaster_slug}`}
                onClick={(e) => e.stopPropagation()}
                className="text-[10px] hover:underline block truncate mt-0.5"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {coffee.roaster_name}
              </Link>
              <div className="flex flex-wrap gap-0.5 mt-1">
                {coffee.roast_level && coffee.roast_level !== "Unknown" && <Chip>{coffee.roast_level}</Chip>}
                {coffee.process && <Chip>{coffee.process}</Chip>}
              </div>
            </div>

            {/* Price + actions */}
            <div className="flex items-center justify-between mt-1">
              <span className="text-xs font-bold">
                {price250 != null ? `₹${price250}` : "—"}
                <span className="text-[8px] font-normal" style={{ color: "var(--color-text-secondary)" }}>/250g</span>
              </span>
              <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <button
                  onClick={() => addToShelf(coffee.product_id, "want_to_try")}
                  className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer"
                  style={{ background: "var(--color-tag-bg)", color: "var(--color-accent)" }}
                  title="Add to shelf"
                >
                  <Plus size={10} />
                </button>
                <button
                  onClick={() => { trackClick(coffee.product_id, coffee.roaster_slug, "card_front"); window.open(coffee.product_url, "_blank"); }}
                  className="w-5 h-5 rounded-full flex items-center justify-center cursor-pointer"
                  style={{ background: "var(--color-accent)", color: "white" }}
                  title="Buy"
                >
                  <ShoppingCart size={10} />
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Back ────────────────────────────────────── */}
        <div className="card-back" style={{ background: "#1A0F0A", color: "var(--color-text-on-dark)" }}>
          <IndiaMap
            originLat={originCoords?.lat} originLng={originCoords?.lng}
            roasterLat={coffee.roaster_lat} roasterLng={coffee.roaster_lng}
          />
          <div className="absolute inset-0 map-text-overlay" style={{ zIndex: 1 }} />
          <div className="relative z-10 flex flex-col p-2.5 justify-between h-full">
            <div className="space-y-2 overflow-y-auto flex-1">
              {coffee.tasting_notes && (
                <MetaRow icon={<Coffee size={10} />} label="Tasting Notes" value={coffee.tasting_notes} />
              )}
              {coffee.origin && (
                <MetaRow icon={<MapPin size={10} />} label="Origin" value={coffee.origin} />
              )}
              {coffee.altitude_masl && (
                <MetaRow icon={<Mountain size={10} />} label="Altitude" value={`${coffee.altitude_masl.toLocaleString()} m.a.s.l.`} />
              )}
              {coffee.process && (
                <MetaRow icon={<Settings size={10} />} label="Process" value={coffee.process} />
              )}
            </div>
            <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-white/10" onClick={(e) => e.stopPropagation()}>
              <button className="text-white/60 hover:text-white cursor-pointer"><Share2 size={12} /></button>
              <button
                onClick={() => addToShelf(coffee.product_id, "want_to_try")}
                className="text-white/60 hover:text-white cursor-pointer"
              >
                <Plus size={12} />
              </button>
            </div>
            <p className="text-center text-[8px] text-white/30 mt-0.5">Tap to flip</p>
          </div>
        </div>
      </div>
    </div>
  );
}

function MetaRow({ icon, label, value }) {
  return (
    <div className="flex items-start gap-1">
      <span className="mt-0.5 opacity-60">{icon}</span>
      <div>
        <p className="text-[8px] uppercase tracking-wider opacity-50 font-semibold">{label}</p>
        <p className="text-[10px] leading-snug">{value}</p>
      </div>
    </div>
  );
}

function Chip({ children }) {
  return (
    <span className="text-[8px] px-1 py-0.5 rounded-full"
      style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}>
      {children}
    </span>
  );
}
