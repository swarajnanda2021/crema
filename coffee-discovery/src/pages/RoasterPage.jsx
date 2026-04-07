import { useParams, Link } from "react-router-dom";
import { useCoffeeData } from "../hooks/useCoffeeData";
import { useRoasterProfiles } from "../hooks/useRoasterProfiles";
import {
  ArrowLeft, ExternalLink, MapPin, Calendar, Star,
  Instagram, Twitter, Facebook, Youtube, Linkedin,
  Leaf, Award, Globe,
} from "lucide-react";
import CardGrid from "../components/CardGrid";
import { useMemo } from "react";

const SOCIAL_ICONS = {
  instagram: Instagram,
  twitter: Twitter,
  facebook: Facebook,
  youtube: Youtube,
  linkedin: Linkedin,
};

export default function RoasterPage() {
  const { roasterSlug } = useParams();
  const { products, roasters, loading } = useCoffeeData();
  const { getProfile } = useRoasterProfiles();

  const roaster = roasters.find((r) => r.slug === roasterSlug);
  const profile = getProfile(roasterSlug, roaster?.website, roaster?.name);
  const coffees = useMemo(
    () => products.filter((p) => p.roaster_slug === roasterSlug),
    [products, roasterSlug]
  );

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20 text-center">
        <p style={{ color: "var(--color-text-secondary)" }}>Loading...</p>
      </div>
    );
  }

  if (!roaster) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-20 text-center">
        <p className="text-5xl mb-4">☕</p>
        <p className="text-xl font-semibold mb-2">Roaster not found</p>
        <Link to="/browse" className="hover:underline" style={{ color: "var(--color-accent)" }}>
          Back to browsing
        </Link>
      </div>
    );
  }

  const logoUrl = profile?.logo_url;
  const tagline = profile?.tagline;
  const about = profile?.about_blurb;
  const year = profile?.founding_year;
  const regions = profile?.sourcing_regions;
  const specialties = profile?.specialties;
  const socials = profile?.social_links;
  const rating = profile?.rating || roaster?.rating;
  const ratingCount = profile?.rating_count || roaster?.ratingCount;

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-8 py-6">
      <Link
        to="/browse"
        className="inline-flex items-center gap-1 text-sm mb-6 hover:underline"
        style={{ color: "var(--color-text-secondary)" }}
      >
        <ArrowLeft size={16} />
        All coffees
      </Link>

      {/* ── Profile Header ───────────────────────────────────────── */}
      <div
        className="rounded-2xl p-6 md:p-8 mb-8"
        style={{ background: "var(--color-card-front)", border: "1px solid var(--color-border)" }}
      >
        <div className="flex flex-col md:flex-row gap-6 items-start">
          {/* Logo */}
          {logoUrl && (
            <div className="shrink-0 w-20 h-20 md:w-24 md:h-24 rounded-xl overflow-hidden border" style={{ borderColor: "var(--color-border)" }}>
              <img
                src={logoUrl}
                alt={`${roaster.name} logo`}
                className="w-full h-full object-contain p-2"
              />
            </div>
          )}

          {/* Info */}
          <div className="flex-1 min-w-0">
            <h1
              className="text-2xl md:text-3xl font-bold"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              {roaster.name}
            </h1>

            {tagline && (
              <p className="mt-1 text-sm italic" style={{ color: "var(--color-text-secondary)" }}>
                {tagline}
              </p>
            )}

            {/* Meta row */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-sm" style={{ color: "var(--color-text-secondary)" }}>
              <span className="inline-flex items-center gap-1">
                <MapPin size={14} />
                {roaster.city}, {roaster.state}
              </span>
              {year && (
                <span className="inline-flex items-center gap-1">
                  <Calendar size={14} />
                  Est. {year}
                </span>
              )}
              {rating && (
                <span className="inline-flex items-center gap-1">
                  <Star size={14} fill="currentColor" />
                  {rating}{ratingCount ? ` (${ratingCount})` : ""}
                </span>
              )}
              <span>{coffees.length} coffee{coffees.length !== 1 ? "s" : ""}</span>
            </div>

            {/* Website + social links */}
            <div className="flex flex-wrap items-center gap-3 mt-4">
              <a
                href={roaster.website}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors"
                style={{ background: "var(--color-accent)", color: "white" }}
              >
                <Globe size={14} />
                Visit Website
              </a>

              {socials && Object.entries(socials).map(([platform, url]) => {
                const Icon = SOCIAL_ICONS[platform];
                if (!Icon) return null;
                return (
                  <a
                    key={platform}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-2 rounded-lg transition-colors hover:bg-black/5"
                    title={platform}
                  >
                    <Icon size={18} style={{ color: "var(--color-text-secondary)" }} />
                  </a>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── About blurb ──────────────────────────────────────── */}
        {about && (
          <div className="mt-6 pt-5 border-t" style={{ borderColor: "var(--color-border)" }}>
            <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
              {about}
            </p>
          </div>
        )}

        {/* ── Sourcing regions + specialties ────────────────────── */}
        {(regions || specialties) && (
          <div className="flex flex-wrap gap-4 mt-5 pt-5 border-t" style={{ borderColor: "var(--color-border)" }}>
            {regions && regions.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-secondary)" }}>
                  Sourcing Regions
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {regions.map((r) => (
                    <span
                      key={r}
                      className="text-xs px-2.5 py-1 rounded-full inline-flex items-center gap-1"
                      style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}
                    >
                      <MapPin size={10} />
                      {r}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {specialties && specialties.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--color-text-secondary)" }}>
                  Specialties
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {specialties.map((s) => (
                    <span
                      key={s}
                      className="text-xs px-2.5 py-1 rounded-full inline-flex items-center gap-1"
                      style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}
                    >
                      <Award size={10} />
                      {s.replace(/-/g, " ")}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Coffee Grid ──────────────────────────────────────────── */}
      {coffees.length > 0 ? (
        <>
          <h2
            className="text-xl font-semibold mb-4"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            Coffees from {roaster.name}
          </h2>
          <CardGrid coffees={coffees} />
        </>
      ) : (
        <div className="text-center py-12">
          <p style={{ color: "var(--color-text-secondary)" }}>
            No coffees currently available from this roaster.
          </p>
        </div>
      )}
    </div>
  );
}
