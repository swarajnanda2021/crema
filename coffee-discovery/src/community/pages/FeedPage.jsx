import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { MapPin, Coffee, ExternalLink, ShoppingCart } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useCoffeeData } from "../../hooks/useCoffeeData";
import { useRecommendations } from "../hooks/useRecommendations";
import { useShelves } from "../hooks/useShelves";
import { apiFetch, trackClick } from "../api";
import TastingNoteDisplay from "../components/TastingNoteDisplay";
import RecommendationPanel from "../components/RecommendationPanel";
import { pricePer250g } from "../../utils/formatPrice";

export default function FeedPage() {
  const { user, backendAvailable } = useAuth();
  const { productMap } = useCoffeeData();
  const { recommendations, fetchRecommendations } = useRecommendations();
  const { addToShelf } = useShelves();
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user) fetchRecommendations("community", null, 10);
  }, [user, fetchRecommendations]);

  useEffect(() => {
    (async () => {
      try {
        const data = await apiFetch("/feed/timeline");
        setTimeline(data.timeline || []);
      } catch {
        setTimeline([]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (!backendAvailable || !user) {
    return <Navigate to="/auth" replace />;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <p style={{ color: "var(--color-text-secondary)" }}>Loading feed...</p>
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-6">
      <div className="lg:flex lg:gap-6">
        {/* LEFT: spacer matching My Shelf's profile column */}
        <div className="hidden lg:block lg:w-[240px] lg:shrink-0" />

        {/* CENTER: Temporal feed */}
        <main className="flex-1 min-w-0 space-y-4">
          {timeline.length === 0 ? (
            <p className="text-center py-16" style={{ color: "var(--color-text-secondary)" }}>
              No tasting notes yet. Be the first to write one!
            </p>
          ) : (
            timeline.map((item) => (
              <FeedCard key={item.note.id} item={item} productMap={productMap} />
            ))
          )}
        </main>

        {/* RIGHT: Recommendations — independently scrollable */}
        <aside className="hidden lg:block lg:w-[280px] lg:shrink-0">
          <div className="lg:sticky lg:top-[72px] lg:h-[calc(100vh-88px)]">
            <RecommendationPanel
              recommendations={recommendations}
              onAddToShelf={addToShelf}
              count={10}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

function FeedCard({ item, productMap }) {
  const { user: author, product_id, note } = item;
  const coffee = productMap.get(product_id);
  const price250 = coffee ? pricePer250g(coffee.price_per_gram) : null;

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: "var(--color-card-front)", border: "1px solid var(--color-border)" }}
    >
      {/* User header */}
      <div className="flex items-center gap-2.5 px-4 pt-3 pb-2">
        <Link to={`/user/${author.username}`}>
          {author.avatar_url ? (
            <img src={author.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
          ) : (
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold"
              style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}>
              {(author.display_name || "?")[0]}
            </div>
          )}
        </Link>
        <div className="flex-1 min-w-0">
          <Link to={`/user/${author.username}`} className="text-sm font-semibold hover:underline">
            {author.display_name}
          </Link>
          {author.location && (
            <p className="text-[10px]" style={{ color: "var(--color-text-secondary)" }}>
              <MapPin size={8} className="inline mr-0.5" />{author.location}
            </p>
          )}
        </div>
      </div>

      {/* Coffee context — two-column: image left, note right */}
      {coffee && (
        <div className="flex flex-col sm:flex-row">
          {/* Left: coffee card */}
          <div className="sm:w-[160px] sm:shrink-0 sm:border-r px-4 pb-3 sm:pb-4" style={{ borderColor: "var(--color-border)" }}>
            <Link to={`/coffee/${coffee.product_id}`}>
              {coffee.image_url ? (
                <img src={coffee.image_url} alt="" className="w-full aspect-square rounded-lg object-cover mb-2" loading="lazy" />
              ) : (
                <div className="w-full aspect-square rounded-lg flex items-center justify-center mb-2" style={{ background: "var(--color-tag-bg)" }}>
                  <Coffee size={20} style={{ color: "var(--color-border)" }} />
                </div>
              )}
            </Link>
            <Link to={`/coffee/${coffee.product_id}`}>
              <p className="text-xs font-semibold leading-tight" style={{ fontFamily: "var(--font-serif)" }}>
                {coffee.coffee_name}
              </p>
            </Link>
            <p className="text-[10px] mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
              {coffee.roaster_name}
            </p>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {coffee.roast_level && coffee.roast_level !== "Unknown" && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}>
                  {coffee.roast_level}
                </span>
              )}
              {coffee.process && (
                <span className="text-[9px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}>
                  {coffee.process}
                </span>
              )}
            </div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => { trackClick(coffee.product_id, coffee.roaster_slug, "card_front"); window.open(coffee.product_url, "_blank"); }}
                className="flex items-center gap-1 text-[10px] cursor-pointer hover:underline"
                style={{ color: "var(--color-accent)" }}>
                <ShoppingCart size={9} /> Buy
              </button>
            </div>
          </div>

          {/* Right: tasting note */}
          <div className="flex-1 min-w-0 px-4 pb-4 sm:pt-0 pt-0">
            <TastingNoteDisplay note={note} />
          </div>
        </div>
      )}

      {/* If no coffee found, just show the note */}
      {!coffee && (
        <div className="px-4 pb-4">
          <TastingNoteDisplay note={note} />
        </div>
      )}
    </div>
  );
}
