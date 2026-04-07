import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Coffee, Check, Star, Plus } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useShelves } from "../hooks/useShelves";
import { useRecommendations } from "../hooks/useRecommendations";
import { useCoffeeData } from "../../hooks/useCoffeeData";
import ProfileCard from "../components/ProfileCard";
import ShelfIsland from "../components/ShelfIsland";
import QuickAddModal from "../components/QuickAddModal";
import RecommendationPanel from "../components/RecommendationPanel";

const SHELVES = [
  { key: "currently_drinking", label: "Drinking", icon: Coffee, color: "#C8553D" },
  { key: "drank", label: "Drank", icon: Check, color: "#6B5B4F" },
  { key: "want_to_try", label: "Want to Try", icon: Star, color: "#E8C07A" },
];

export default function MyShelfPage() {
  const { user, backendAvailable } = useAuth();
  const { shelves, fetchShelves, addToShelf, removeFromShelf } = useShelves();
  const { productMap } = useCoffeeData();
  const { recommendations, fetchRecommendations } = useRecommendations();
  const [activeShelf, setActiveShelf] = useState("currently_drinking"); // default to Drinking
  const [quickAddShelf, setQuickAddShelf] = useState(null);

  useEffect(() => {
    if (user) {
      fetchShelves();
      fetchRecommendations("self");
    }
  }, [user, fetchShelves, fetchRecommendations]);

  if (!backendAvailable || !user) {
    return <Navigate to="/auth" replace />;
  }

  const drankCount = (shelves.drank || []).length;

  const handleToggleShelf = (key) => {
    setActiveShelf(key); // always switch, never collapse — one tab always active
  };

  return (
    <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-6">
      <div className="lg:flex lg:gap-6">

        {/* LEFT: Profile */}
        <aside className="lg:w-[240px] lg:shrink-0 mb-6 lg:mb-0">
          <div className="lg:sticky lg:top-[72px]">
            <ProfileCard user={user} drankCount={drankCount} />
          </div>
        </aside>

        {/* CENTER: Shelf Cards + Expansion Panel — all inside one card */}
        <main className="flex-1 min-w-0">
          <div
            className="rounded-xl overflow-hidden"
            style={{ background: "var(--color-card-front)", border: "1px solid var(--color-border)" }}
          >
            {/* ── Three square shelf tabs ──────────────────────── */}
            <div className="grid grid-cols-3">
              {SHELVES.map(({ key, label, icon: Icon, color }, i) => {
                const count = (shelves[key] || []).length;
                const isActive = activeShelf === key;
                return (
                  <button
                    key={key}
                    onClick={() => handleToggleShelf(key)}
                    className="flex items-center justify-center gap-1.5 px-2 py-2 cursor-pointer transition-all"
                    style={{
                      background: isActive ? "var(--color-card-front)" : "var(--color-tag-bg)",
                      borderBottom: isActive ? `2px solid ${color}` : "2px solid var(--color-border)",
                      borderRight: i < 2 ? "1px solid var(--color-border)" : "none",
                    }}
                  >
                    <Icon size={13} style={{ color: isActive ? color : "var(--color-text-secondary)" }} />
                    <span className="text-xs font-semibold" style={{ color: isActive ? color : "var(--color-text-primary)" }}>
                      {label}
                    </span>
                    <span className="text-xs font-bold" style={{ color: isActive ? color : "var(--color-text-secondary)" }}>
                      {count}
                    </span>
                    <button
                      onClick={(e) => { e.stopPropagation(); setQuickAddShelf(key); }}
                      className="w-4 h-4 rounded-full flex items-center justify-center cursor-pointer"
                      style={{ background: `${color}20`, color }}
                      title="Add coffee"
                    >
                      <Plus size={9} />
                    </button>
                  </button>
                );
              })}
            </div>

            {/* ── Expansion panel (always shown, defaults to Drinking) ── */}
            {activeShelf && (
              <ShelfIsland
                shelfKey={activeShelf}
                entries={shelves[activeShelf] || []}
                productMap={productMap}
                onMove={(productId, shelf) => addToShelf(productId, shelf)}
                onRemove={removeFromShelf}
                onNoteAdded={fetchShelves}
                onAddCoffee={() => setQuickAddShelf(activeShelf)}
              />
            )}
          </div>
        </main>

        {/* RIGHT: Recommendations */}
        <aside className="hidden lg:block lg:w-[280px] lg:shrink-0">
          <div className="lg:sticky lg:top-[72px]">
            <RecommendationPanel
              recommendations={recommendations}
              onAddToShelf={addToShelf}
            />
          </div>
        </aside>
      </div>

      {/* Mobile recommendations */}
      <div className="lg:hidden mt-6">
        <RecommendationPanel
          recommendations={recommendations}
          onAddToShelf={addToShelf}
          horizontal
        />
      </div>

      {/* Quick Add Modal */}
      {quickAddShelf && (
        <QuickAddModal
          shelfKey={quickAddShelf}
          onAdd={addToShelf}
          onClose={() => setQuickAddShelf(null)}
        />
      )}
    </div>
  );
}
