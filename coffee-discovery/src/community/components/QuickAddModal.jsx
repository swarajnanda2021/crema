import { useState, useMemo } from "react";
import { X, Search, Plus, Check, Coffee } from "lucide-react";
import { useCoffeeData } from "../../hooks/useCoffeeData";
import { searchCoffees } from "../../utils/searchCoffees";

const SHELF_LABELS = {
  currently_drinking: "Currently Drinking",
  drank: "Drank",
  want_to_try: "Want to Try",
};

export default function QuickAddModal({ shelfKey, onAdd, onClose }) {
  const { products } = useCoffeeData();
  const [query, setQuery] = useState("");
  const [added, setAdded] = useState(new Set());

  const results = useMemo(() => {
    if (!query.trim()) return products.slice(0, 12);
    return searchCoffees(products, query).slice(0, 15);
  }, [products, query]);

  const handleAdd = async (productId) => {
    await onAdd(productId, shelfKey);
    setAdded((prev) => new Set(prev).add(productId));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        className="relative w-full max-w-lg rounded-xl overflow-hidden max-h-[80vh] flex flex-col"
        style={{ background: "var(--color-bg)" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b" style={{ borderColor: "var(--color-border)" }}>
          <Search size={16} style={{ color: "var(--color-text-secondary)" }} />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search coffees to add to ${SHELF_LABELS[shelfKey]}...`}
            className="flex-1 text-sm outline-none bg-transparent"
          />
          <button onClick={onClose} className="cursor-pointer shrink-0"><X size={18} /></button>
        </div>

        {/* Results */}
        <div className="overflow-y-auto flex-1 p-2">
          {results.length === 0 ? (
            <p className="text-center py-8 text-sm" style={{ color: "var(--color-text-secondary)" }}>
              No coffees found
            </p>
          ) : (
            results.map((coffee) => {
              const isAdded = added.has(coffee.product_id);
              return (
                <div
                  key={coffee.product_id}
                  className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-black/5"
                >
                  {coffee.image_url ? (
                    <img src={coffee.image_url} alt="" className="w-10 h-10 rounded-lg object-cover shrink-0" loading="lazy" />
                  ) : (
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: "var(--color-tag-bg)" }}>
                      <Coffee size={14} style={{ color: "var(--color-border)" }} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{coffee.coffee_name}</p>
                    <p className="text-xs truncate" style={{ color: "var(--color-text-secondary)" }}>
                      {coffee.roaster_name}
                    </p>
                  </div>
                  <button
                    onClick={() => !isAdded && handleAdd(coffee.product_id)}
                    disabled={isAdded}
                    className="shrink-0 p-1.5 rounded-lg cursor-pointer transition-colors"
                    style={{
                      background: isAdded ? "var(--color-tag-bg)" : "var(--color-accent)",
                      color: isAdded ? "var(--color-tag-text)" : "white",
                    }}
                  >
                    {isAdded ? <Check size={14} /> : <Plus size={14} />}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
