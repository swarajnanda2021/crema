import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { MapPin, Calendar, Coffee, Check, Star, Award, Settings, Plus } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useRecommendations } from "../hooks/useRecommendations";
import { useShelves } from "../hooks/useShelves";
import { useCoffeeData } from "../../hooks/useCoffeeData";
import { useTastingNotes } from "../hooks/useTastingNotes";
import { apiFetch } from "../api";
import TastingNoteDisplay from "../components/TastingNoteDisplay";
import RecommendationPanel from "../components/RecommendationPanel";
import { pricePer250g } from "../../utils/formatPrice";
import { trackClick } from "../api";
import { ExternalLink, ChevronDown, ChevronUp } from "lucide-react";

const PREF_LABELS = { light: "Light Roast", medium: "Medium Roast", dark: "Dark Roast" };
const STYLE_LABELS = { espresso: "Espresso", filter: "Filter", both: "Espresso & Filter" };
const SHELF_META = {
  currently_drinking: { label: "Drinking", icon: Coffee, color: "#C8553D" },
  drank: { label: "Drank", icon: Check, color: "#6B5B4F" },
  want_to_try: { label: "Want to Try", icon: Star, color: "#E8C07A" },
};

export default function UserProfilePage() {
  const { username } = useParams();
  const { user: me } = useAuth();
  const { productMap } = useCoffeeData();
  const { recommendations, fetchRecommendations } = useRecommendations();
  const { addToShelf } = useShelves();
  const [profile, setProfile] = useState(null);
  const [shelves, setShelves] = useState(null);
  const [allNotes, setAllNotes] = useState([]);
  const [activeShelf, setActiveShelf] = useState("currently_drinking");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const feedData = await apiFetch("/feed");
        const item = (feedData.feed || []).find((f) => f.user.username === username);
        if (item) {
          setProfile(item.user);
          setShelves(item.shelves);
          setAllNotes(item.recent_notes || []);
        }
        // Fetch recommendations based on this user's shelf
        fetchRecommendations("user", username);
      } catch {
      } finally {
        setLoading(false);
      }
    })();
  }, [username, fetchRecommendations]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <p style={{ color: "var(--color-text-secondary)" }}>Loading...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="max-w-lg mx-auto px-4 py-20 text-center">
        <p className="text-xl font-semibold mb-2">User not found</p>
        <Link to="/" className="hover:underline" style={{ color: "var(--color-accent)" }}>Back to feed</Link>
      </div>
    );
  }

  const drankCount = (shelves?.drank || []).length;
  const initials = (profile.display_name || "?").split(" ").map((w) => w[0]).join("").toUpperCase().slice(0, 2);
  const isMe = me && me.username === username;

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-6">
      <div className="lg:flex lg:gap-6">

        {/* LEFT: Profile card (sticky) */}
        <aside className="lg:w-[240px] lg:shrink-0 mb-6 lg:mb-0">
          <div className="lg:sticky lg:top-[72px]">
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
              {/* Avatar */}
              <div className="relative h-[240px] lg:h-[280px]">
                {profile.avatar_url ? (
                  <img src={profile.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg, #D4C5B8, #E8DDD3)" }}>
                    <span className="text-4xl font-bold" style={{ color: "var(--color-text-secondary)", opacity: 0.4 }}>
                      {initials}
                    </span>
                  </div>
                )}
              </div>
              {/* Bio */}
              <div className="p-4" style={{ background: "rgba(250, 247, 242, 0.95)" }}>
                <h2 className="font-bold text-lg" style={{ fontFamily: "var(--font-serif)" }}>
                  {profile.display_name}
                </h2>
                <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>@{profile.username}</p>
                {profile.location && (
                  <p className="flex items-center gap-1 text-xs mt-1.5" style={{ color: "var(--color-text-secondary)" }}>
                    <MapPin size={11} /> {profile.location}
                  </p>
                )}
                {profile.bio && (
                  <p className="text-sm mt-2 leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
                    {profile.bio}
                  </p>
                )}
                {(profile.coffee_preference || profile.brewing_style) && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {profile.coffee_preference && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                        style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}>
                        <Coffee size={9} /> {PREF_LABELS[profile.coffee_preference]}
                      </span>
                    )}
                    {profile.brewing_style && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                        style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}>
                        <Settings size={9} /> {STYLE_LABELS[profile.brewing_style]}
                      </span>
                    )}
                  </div>
                )}
                <div className="flex items-center gap-3 mt-3 text-xs" style={{ color: "var(--color-text-secondary)" }}>
                  <span className="inline-flex items-center gap-1">
                    <Award size={11} style={{ color: "var(--color-accent)" }} /> <strong>{drankCount}</strong> tried
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <Calendar size={11} /> Since {new Date(profile.created_at || Date.now()).getFullYear()}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </aside>

        {/* CENTER: Shelf + Notes */}
        <main className="flex-1 min-w-0">
          {/* Shelf tabs */}
          {shelves && (
            <div className="rounded-xl overflow-hidden mb-6"
              style={{ background: "var(--color-card-front)", border: "1px solid var(--color-border)" }}>
              <div className="grid grid-cols-3">
                {["currently_drinking", "drank", "want_to_try"].map((key, i) => {
                  const meta = SHELF_META[key];
                  const Icon = meta.icon;
                  const count = (shelves[key] || []).length;
                  const isActive = activeShelf === key;
                  return (
                    <button key={key} onClick={() => setActiveShelf(key)}
                      className="flex items-center justify-center gap-1.5 px-2 py-2 cursor-pointer transition-all"
                      style={{
                        background: isActive ? "var(--color-card-front)" : "var(--color-tag-bg)",
                        borderBottom: isActive ? `2px solid ${meta.color}` : "2px solid var(--color-border)",
                        borderRight: i < 2 ? "1px solid var(--color-border)" : "none",
                      }}>
                      <Icon size={13} style={{ color: isActive ? meta.color : "var(--color-text-secondary)" }} />
                      <span className="text-xs font-semibold" style={{ color: isActive ? meta.color : "var(--color-text-primary)" }}>{meta.label}</span>
                      <span className="text-xs font-bold" style={{ color: isActive ? meta.color : "var(--color-text-secondary)" }}>{count}</span>
                    </button>
                  );
                })}
              </div>

              {/* Shelf entries (read-only for other users) */}
              <div className="p-4">
                {(shelves[activeShelf] || []).length === 0 ? (
                  <p className="text-sm py-3 text-center" style={{ color: "var(--color-text-secondary)" }}>Nothing here yet.</p>
                ) : (
                  <div className="space-y-2">
                    {(shelves[activeShelf] || []).map((entry) => {
                      const coffee = productMap.get(entry.product_id);
                      if (!coffee) return null;
                      return (
                        <ReadOnlyShelfCard key={entry.id} coffee={coffee} entry={entry} notes={allNotes} productMap={productMap} />
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </main>

        {/* RIGHT: Recommendations based on this user's shelf */}
        <aside className="hidden lg:block lg:w-[280px] lg:shrink-0">
          <div className="lg:sticky lg:top-[72px]">
            <RecommendationPanel
              recommendations={recommendations}
              onAddToShelf={addToShelf}
            />
          </div>
        </aside>
      </div>
    </div>
  );
}

/**
 * Read-only shelf card — shows coffee + their tasting notes (not editable).
 */
function ReadOnlyShelfCard({ coffee, entry, notes }) {
  const price250 = pricePer250g(coffee.price_per_gram);
  const productNotes = notes.filter((n) => n.product_id === coffee.product_id);

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
      <div className="flex flex-col md:flex-row">
        {/* Left: image + details */}
        <div className="md:w-[180px] md:shrink-0 md:border-r p-3" style={{ borderColor: "var(--color-border)" }}>
          {coffee.image_url ? (
            <img src={coffee.image_url} alt="" className="w-full aspect-square rounded-lg object-cover mb-2" loading="lazy" />
          ) : (
            <div className="w-full aspect-square rounded-lg flex items-center justify-center mb-2" style={{ background: "var(--color-tag-bg)" }}>
              <Coffee size={24} style={{ color: "var(--color-border)" }} />
            </div>
          )}
          <p className="text-sm font-semibold" style={{ fontFamily: "var(--font-serif)" }}>{coffee.coffee_name}</p>
          <p className="text-[11px] mt-0.5" style={{ color: "var(--color-text-secondary)" }}>{coffee.roaster_name}</p>
          <div className="flex flex-wrap gap-1 mt-2">
            {coffee.roast_level && coffee.roast_level !== "Unknown" && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}>{coffee.roast_level}</span>
            )}
            {coffee.process && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}>{coffee.process}</span>
            )}
            {price250 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}>₹{price250}/250g</span>
            )}
          </div>
          <button onClick={() => { trackClick(coffee.product_id, coffee.roaster_slug, "partner_shelf"); window.open(coffee.product_url, "_blank"); }}
            className="flex items-center gap-1 text-[11px] mt-2 cursor-pointer hover:underline" style={{ color: "var(--color-accent)" }}>
            <ExternalLink size={10} /> Buy from roaster
          </button>
        </div>

        {/* Right: their notes (read-only) */}
        <div className="flex-1 min-w-0 p-3">
          {productNotes.length > 0 ? (
            <div className="space-y-2">
              {productNotes.map((note) => (
                <TastingNoteDisplay key={note.id} note={note} />
              ))}
            </div>
          ) : (
            <p className="text-sm italic py-3" style={{ color: "var(--color-text-secondary)" }}>
              No tasting notes yet.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
