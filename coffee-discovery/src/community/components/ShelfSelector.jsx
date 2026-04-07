import { useState } from "react";
import { BookOpen, Check, Coffee, Star, X } from "lucide-react";
import { useAuth } from "../hooks/useAuth";

const SHELVES = [
  { key: "currently_drinking", label: "Currently Drinking", icon: Coffee },
  { key: "drank", label: "Drank", icon: Check },
  { key: "want_to_try", label: "Want to Try", icon: Star },
];

export default function ShelfSelector({ productId, currentShelf, onAdd, onRemove }) {
  const { user, backendAvailable } = useAuth();
  const [open, setOpen] = useState(false);

  if (!backendAvailable || !user) return null;

  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium cursor-pointer transition-colors"
        style={{
          borderColor: currentShelf ? "var(--color-accent)" : "rgba(255,255,255,0.2)",
          color: currentShelf ? "var(--color-accent)" : "rgba(255,255,255,0.7)",
          background: currentShelf ? "rgba(200,85,61,0.1)" : "transparent",
        }}
      >
        <BookOpen size={14} />
        {currentShelf
          ? SHELVES.find((s) => s.key === currentShelf.shelf)?.label || "On Shelf"
          : "Add to Shelf"}
      </button>

      {open && (
        <div
          className="absolute bottom-full mb-2 left-0 right-0 rounded-xl shadow-lg border p-1.5 z-50"
          style={{
            background: "var(--color-card-front)",
            borderColor: "var(--color-border)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {SHELVES.map(({ key, label, icon: Icon }) => {
            const isActive = currentShelf?.shelf === key;
            return (
              <button
                key={key}
                onClick={() => {
                  onAdd(productId, key);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer hover:bg-black/5"
                style={{
                  color: isActive ? "var(--color-accent)" : "var(--color-text-primary)",
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                <Icon size={14} />
                {label}
                {isActive && <Check size={12} className="ml-auto" />}
              </button>
            );
          })}

          {currentShelf && (
            <>
              <div className="border-t my-1" style={{ borderColor: "var(--color-border)" }} />
              <button
                onClick={() => {
                  onRemove(currentShelf.entry.id);
                  setOpen(false);
                }}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm cursor-pointer hover:bg-red-50 text-red-500"
              >
                <X size={14} />
                Remove from Shelf
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
