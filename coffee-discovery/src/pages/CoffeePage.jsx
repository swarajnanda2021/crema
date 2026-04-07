import { useParams, Link } from "react-router-dom";
import { useCoffeeData } from "../hooks/useCoffeeData";
// no local state needed — price is derived
import {
  ArrowLeft,
  Coffee,
  MapPin,
  Mountain,
  Leaf,
  Settings,
  ExternalLink,
} from "lucide-react";
// Likes replaced by shelf system
import ShareButton from "../components/ShareButton";
// VariantSelector removed — quantities handled in cart (future)
import CoffeeCard from "../components/CoffeeCard";
import { pricePer250g } from "../utils/formatPrice";

export default function CoffeePage() {
  const { productId } = useParams();
  const { products, productMap } = useCoffeeData();
  const coffee = productMap.get(productId);

  if (!coffee) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20 text-center">
        <p className="text-5xl mb-4">☕</p>
        <p className="text-xl font-semibold mb-2">Coffee not found</p>
        <Link to="/browse" className="hover:underline" style={{ color: "var(--color-accent)" }}>
          Back to browsing
        </Link>
      </div>
    );
  }

  const price250 = pricePer250g(coffee.price_per_gram);

  // More from same roaster
  const moreCoffees = products
    .filter(
      (p) =>
        p.roaster_slug === coffee.roaster_slug &&
        p.product_id !== coffee.product_id
    )
    .slice(0, 6);

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-8 py-6">
      {/* Back link */}
      <Link
        to="/browse"
        className="inline-flex items-center gap-1 text-sm mb-6 hover:underline"
        style={{ color: "var(--color-text-secondary)" }}
      >
        <ArrowLeft size={16} />
        Back to browse
      </Link>

      <div className="flex flex-col md:flex-row gap-8">
        {/* Image */}
        <div className="md:w-[400px] shrink-0">
          <div className="rounded-2xl overflow-hidden img-placeholder aspect-square">
            {coffee.image_url ? (
              <img
                src={coffee.image_url}
                alt={coffee.coffee_name}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <Coffee size={64} style={{ color: "var(--color-border)" }} />
              </div>
            )}
          </div>
        </div>

        {/* Details */}
        <div className="flex-1">
          <h1
            className="text-3xl font-bold mb-1"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {coffee.coffee_name}
          </h1>
          <Link
            to={`/roaster/${coffee.roaster_slug}`}
            className="text-base hover:underline"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {coffee.roaster_name}
          </Link>

          {/* Chips */}
          <div className="flex gap-2 mt-3 flex-wrap">
            {coffee.roast_level && coffee.roast_level !== "Unknown" && (
              <span
                className="text-xs px-2.5 py-1 rounded-full"
                style={{
                  background: "var(--color-tag-bg)",
                  color: "var(--color-tag-text)",
                }}
              >
                {coffee.roast_level}
              </span>
            )}
            {coffee.process && (
              <span
                className="text-xs px-2.5 py-1 rounded-full"
                style={{
                  background: "var(--color-tag-bg)",
                  color: "var(--color-tag-text)",
                }}
              >
                {coffee.process}
              </span>
            )}
          </div>

          {/* Meta rows */}
          <div className="mt-6 space-y-3">
            {coffee.tasting_notes && (
              <Row icon={<Coffee size={18} />} label="Tasting Notes" value={coffee.tasting_notes} />
            )}
            {coffee.origin && (
              <Row icon={<MapPin size={18} />} label="Origin" value={coffee.origin} />
            )}
            {coffee.altitude_masl && (
              <Row
                icon={<Mountain size={18} />}
                label="Altitude"
                value={`${coffee.altitude_masl.toLocaleString()} m.a.s.l.`}
              />
            )}
            {coffee.varietal && (
              <Row icon={<Leaf size={18} />} label="Varietal" value={coffee.varietal} />
            )}
            {coffee.grind_options && coffee.grind_options.length > 0 && (
              <Row
                icon={<Settings size={18} />}
                label="Grinds Available"
                value={coffee.grind_options.join(", ")}
              />
            )}
          </div>

          {/* Price — standardized per 250g */}
          <div className="mt-6">
            <span className="text-3xl font-bold">
              {price250 != null ? `₹${price250.toLocaleString("en-IN")}` : "—"}
            </span>
            <span
              className="text-lg ml-2"
              style={{ color: "var(--color-text-secondary)" }}
            >
              / 250g
            </span>
          </div>

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-3 mt-6">
            <ShareButton
              coffee={coffee}
              showLabel
              className="px-4 py-2.5 rounded-lg border"
              style={{ borderColor: "var(--color-border)" }}
            />
            <a
              href={coffee.product_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg text-white text-sm font-semibold transition-colors"
              style={{ background: "var(--color-accent)" }}
            >
              Buy from {coffee.roaster_name.split(" ")[0]}
              <ExternalLink size={14} />
            </a>
          </div>

          {/* Description */}
          {coffee.description_raw && (
            <div className="mt-8 pt-6 border-t" style={{ borderColor: "var(--color-border)" }}>
              <h2 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-secondary)" }}>
                About This Coffee
              </h2>
              <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: "var(--color-text-secondary)" }}>
                {coffee.description_raw}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* More from roaster */}
      {moreCoffees.length > 0 && (
        <div className="mt-12 pt-8 border-t" style={{ borderColor: "var(--color-border)" }}>
          <h2 className="text-xl font-semibold mb-4" style={{ fontFamily: "var(--font-serif)" }}>
            More from {coffee.roaster_name}
          </h2>
          <div className="flex gap-5 overflow-x-auto pb-4">
            {moreCoffees.map((c) => (
              <div key={c.product_id} className="shrink-0 w-[300px]">
                <CoffeeCard coffee={c} />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ icon, label, value }) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
        {icon}
      </span>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "var(--color-text-secondary)" }}>
          {label}
        </p>
        <p className="text-sm">{value}</p>
      </div>
    </div>
  );
}
