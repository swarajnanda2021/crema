import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { X, Coffee, Check, Star, MapPin } from "lucide-react";
import { apiFetch } from "../api";
import TastingNoteDisplay from "./TastingNoteDisplay";

const SHELF_LABELS = {
  currently_drinking: { label: "Drinking", icon: Coffee, color: "#C8553D" },
  drank: { label: "Drank", icon: Check, color: "#6B5B4F" },
  want_to_try: { label: "Want to Try", icon: Star, color: "#E8C07A" },
};

export default function PopularityModal({ productId, coffeeName, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`/products/${productId}/users`);
        setData(res);
      } catch {
        setData({ users: [] });
      } finally {
        setLoading(false);
      }
    })();
  }, [productId]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative w-full max-w-xl rounded-xl shadow-2xl"
        style={{ background: "var(--color-bg)", height: "70vh", maxHeight: "600px", display: "flex", flexDirection: "column" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--color-border)", flexShrink: 0 }}>
          <h2 className="text-base font-semibold truncate" style={{ fontFamily: "var(--font-serif)" }}>
            {coffeeName}
          </h2>
          <button onClick={onClose} className="cursor-pointer shrink-0 ml-3"><X size={20} /></button>
        </div>

        {/* User list — full-size scrollable */}
        <div className="px-5 py-4" style={{ overflowY: "auto", flex: "1 1 0", minHeight: 0, WebkitOverflowScrolling: "touch" }}>
          {loading ? (
            <p className="text-center py-8 text-sm" style={{ color: "var(--color-text-secondary)" }}>Loading...</p>
          ) : data.users.length === 0 ? (
            <p className="text-center py-8 text-sm" style={{ color: "var(--color-text-secondary)" }}>Nobody has this on their shelf yet.</p>
          ) : (
            <div className="space-y-4">
              {data.users.map((u) => {
                const shelfMeta = SHELF_LABELS[u.shelf];
                const ShelfIcon = shelfMeta?.icon || Coffee;
                return (
                  <div key={u.username}>
                    {/* User row */}
                    <div className="flex items-center gap-2.5 mb-2">
                      <Link to={`/user/${u.username}`} onClick={onClose}>
                        {u.avatar_url ? (
                          <img src={u.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover" />
                        ) : (
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                            style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}>
                            {(u.display_name || "?")[0]}
                          </div>
                        )}
                      </Link>
                      <div className="flex-1 min-w-0">
                        <Link to={`/user/${u.username}`} onClick={onClose} className="text-sm font-semibold hover:underline">
                          {u.display_name}
                        </Link>
                        <div className="flex items-center gap-2 text-[10px]" style={{ color: "var(--color-text-secondary)" }}>
                          {u.location && <span><MapPin size={8} className="inline mr-0.5" />{u.location}</span>}
                          <span className="flex items-center gap-0.5" style={{ color: shelfMeta?.color }}>
                            <ShelfIcon size={9} /> {shelfMeta?.label}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Their notes for this coffee */}
                    {u.notes.length > 0 && (
                      <div className="ml-10 space-y-2">
                        {u.notes.map((note) => (
                          <TastingNoteDisplay key={note.id} note={note} />
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
