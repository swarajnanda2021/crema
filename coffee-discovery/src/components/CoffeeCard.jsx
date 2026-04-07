import { useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { Coffee, MapPin, Mountain, Leaf, Settings, ShoppingCart, Users } from "lucide-react";
import ShareButton from "./ShareButton";
import IndiaMap from "./IndiaMap";
import ShelfSelector from "../community/components/ShelfSelector";
import PopularityModal from "../community/components/PopularityModal";
import { useShelves } from "../community/hooks/useShelves";
import { resolveOriginCoords } from "../data/coffeeRegions";
import { pricePer250g } from "../utils/formatPrice";
import { trackClick } from "../community/api";

export default function CoffeeCard({ coffee, userCount }) {
  const [flipped, setFlipped] = useState(false);
  const [showPopularity, setShowPopularity] = useState(false);
  const { getShelfForProduct, addToShelf, removeFromShelf } = useShelves();
  const handleFlip = () => setFlipped((f) => !f);
  const originCoords = resolveOriginCoords(coffee.origin, coffee.coffee_name);

  const price250 = pricePer250g(coffee.price_per_gram);

  return (
    <div
      className="card-container cursor-pointer w-full max-w-[300px]"
      style={{ height: 360 }}
      onClick={handleFlip}
    >
      <div
        className={`card-inner ${flipped ? "flipped" : ""} ${
          flipped ? "card-shadow-flipped" : "card-shadow hover:card-shadow-hover"
        } transition-shadow`}
      >
        {/* ── Front Face ──────────────────────────────── */}
        <div
          className="card-front flex flex-col"
          style={{ background: "var(--color-card-front)" }}
        >
          {/* Image */}
          <div className="relative h-[180px] overflow-hidden img-placeholder">
            {coffee.image_url ? (
              <img
                src={coffee.image_url}
                alt={coffee.coffee_name}
                loading="lazy"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Coffee size={48} style={{ color: "var(--color-border)" }} />
              </div>
            )}

            {/* Popularity badge — clickable */}
            {userCount > 0 && (
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowPopularity(true); }}
                onMouseDown={(e) => e.stopPropagation()}
                className="absolute top-2 left-2 z-20 flex items-center gap-1.5 px-2.5 py-1.5 rounded-full cursor-pointer shadow-md hover:shadow-lg transition-shadow"
                style={{ background: "var(--color-accent)", color: "white" }}
              >
                <Users size={14} />
                <span className="text-xs font-bold">{userCount}</span>
              </button>
            )}
          </div>

          {/* Content */}
          <div className="flex-1 p-4 flex flex-col justify-between">
            <div>
              <h3
                className="text-lg font-semibold leading-snug line-clamp-2"
                style={{ fontFamily: "var(--font-serif)" }}
                title={coffee.coffee_name}
              >
                {coffee.coffee_name}
              </h3>
              <Link
                to={`/roaster/${coffee.roaster_slug}`}
                onClick={(e) => e.stopPropagation()}
                className="text-sm mt-0.5 hover:underline block truncate"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {coffee.roaster_name}
              </Link>
            </div>

            {/* Chips: Roast · Process · MASL */}
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {coffee.roast_level && coffee.roast_level !== "Unknown" && (
                <Chip>
                  {coffee.roast_level}
                </Chip>
              )}
              {coffee.process && (
                <Chip>
                  {coffee.process}
                </Chip>
              )}
              {coffee.altitude_masl && (
                <Chip>
                  {coffee.altitude_masl.toLocaleString()}m
                </Chip>
              )}
            </div>

            {/* Price row: per-250g price + cart button */}
            <div className="mt-2 flex items-center justify-between">
              <span className="text-xl font-bold">
                {price250 != null
                  ? `₹${price250.toLocaleString("en-IN")}`
                  : "—"}
                <span className="text-sm font-normal ml-1" style={{ opacity: 0.6 }}>
                  / 250g
                </span>
              </span>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  trackClick(coffee.product_id, coffee.roaster_slug, "card_front");
                  window.open(coffee.product_url, "_blank");
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-sm font-medium transition-colors cursor-pointer"
                style={{ background: "var(--color-accent)" }}
                title={`Buy from ${coffee.roaster_name}`}
              >
                <ShoppingCart size={14} />
                Buy
              </button>
            </div>
          </div>
        </div>

        {/* ── Back Face ───────────────────────────────── */}
        <div
          className="card-back"
          style={{ background: "#1A0F0A", color: "var(--color-text-on-dark)" }}
        >
          {/* Layer 1: India map */}
          <IndiaMap
            originLat={originCoords?.lat}
            originLng={originCoords?.lng}
            roasterLat={coffee.roaster_lat}
            roasterLng={coffee.roaster_lng}
          />

          {/* Layer 2: Gradient overlay for text readability */}
          <div className="absolute inset-0 map-text-overlay" style={{ zIndex: 1 }} />

          {/* Layer 3: Content */}
          <div className="relative z-10 flex flex-col p-5 justify-between h-full">
            <div className="space-y-4 overflow-y-auto flex-1">
              <MetaRow
                icon={<Coffee size={16} />}
                label="Tasting Notes"
                value={coffee.tasting_notes || "Not listed"}
                muted={!coffee.tasting_notes}
              />
              <MetaRow
                icon={<MapPin size={16} />}
                label="Origin"
                value={coffee.origin || "Not listed"}
                muted={!coffee.origin}
              />
              {coffee.altitude_masl && (
                <MetaRow
                  icon={<Mountain size={16} />}
                  label="Altitude"
                  value={`${coffee.altitude_masl.toLocaleString()} m.a.s.l.`}
                />
              )}
              {coffee.varietal && (
                <MetaRow
                  icon={<Leaf size={16} />}
                  label="Varietal"
                  value={coffee.varietal}
                />
              )}
              {coffee.process && (
                <MetaRow
                  icon={<Settings size={16} />}
                  label="Process"
                  value={coffee.process}
                />
              )}
              {coffee.grind_options && coffee.grind_options.length > 0 && (
                <MetaRow
                  icon={<Settings size={16} />}
                  label="Grinds"
                  value={coffee.grind_options.join(", ")}
                />
              )}
            </div>

            {/* Shelf selector (community) */}
            <div className="mt-3">
              <ShelfSelector
                productId={coffee.product_id}
                currentShelf={getShelfForProduct(coffee.product_id)}
                onAdd={addToShelf}
                onRemove={removeFromShelf}
              />
            </div>

            <div className="flex items-center justify-between mt-4 pt-3 border-t border-white/10">
              <ShareButton
                coffee={coffee}
                showLabel
                className="text-white/80 hover:text-white"
              />
            </div>
            <p className="text-center text-xs text-white/40 mt-2">
              Tap to flip back
            </p>
          </div>
        </div>
      </div>

      {/* Popularity modal — portaled to body to escape card's perspective/transform CSS */}
      {showPopularity && createPortal(
        <PopularityModal
          productId={coffee.product_id}
          coffeeName={coffee.coffee_name}
          onClose={() => setShowPopularity(false)}
        />,
        document.body
      )}
    </div>
  );
}

function Chip({ children }) {
  return (
    <span
      className="text-xs px-2 py-0.5 rounded-full"
      style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}
    >
      {children}
    </span>
  );
}

function MetaRow({ icon, label, value, muted = false }) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 opacity-60">{icon}</span>
      <div>
        <p className="text-[11px] uppercase tracking-wider opacity-50 font-semibold">
          {label}
        </p>
        <p className={`text-sm ${muted ? "opacity-40 italic" : ""}`}>{value}</p>
      </div>
    </div>
  );
}
