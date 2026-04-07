import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router-dom";
import {
  Coffee, Check, Star, ChevronDown, ChevronUp,
  ExternalLink, PenLine, ArrowRight, Trash2, Plus,
} from "lucide-react";
import { useTastingNotes } from "../hooks/useTastingNotes";
import { pricePer250g } from "../../utils/formatPrice";
import { trackClick } from "../api";
import TastingNoteForm from "./TastingNoteForm";
import TastingNoteDisplay from "./TastingNoteDisplay";

const SHELF_META = {
  currently_drinking: { label: "Currently Drinking", icon: Coffee, color: "#C8553D" },
  drank: { label: "Drank", icon: Check, color: "#6B5B4F" },
  want_to_try: { label: "Want to Try", icon: Star, color: "#E8C07A" },
};

const SHELF_ORDER = ["currently_drinking", "drank", "want_to_try"];

export default function ShelfIsland({
  shelfKey, entries, productMap, onMove, onRemove, onNoteAdded, onAddCoffee,
}) {
  const [showAll, setShowAll] = useState(false);

  const visible = showAll ? entries : entries.slice(0, 4);

  return (
    <div>
      <div className="p-4">
        {entries.length === 0 ? (
          <p className="text-sm py-3 text-center" style={{ color: "var(--color-text-secondary)" }}>
            No coffees here yet. Tap <strong>+</strong> above to add some.
          </p>
        ) : (
          <div className="space-y-3">
            {visible.map((entry) => {
              const coffee = productMap.get(entry.product_id);
              if (!coffee) return null;
              return (
                <ShelfCard
                  key={entry.id}
                  coffee={coffee}
                  entry={entry}
                  currentShelf={shelfKey}
                  onMove={onMove}
                  onRemove={() => onRemove(entry.id)}
                  onNoteAdded={onNoteAdded}
                />
              );
            })}
            {!showAll && entries.length > 4 && (
              <button
                onClick={() => setShowAll(true)}
                className="w-full py-2 rounded-lg text-xs font-medium cursor-pointer hover:bg-black/5"
                style={{ color: "var(--color-accent)" }}
              >
                Show all {entries.length} coffees
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── ShelfCard (per-coffee expandable) ────────────────────────────────────────

function ShelfCard({ coffee, entry, currentShelf, onMove, onRemove, onNoteAdded }) {
  const [showForm, setShowForm] = useState(false);
  const [editingNote, setEditingNote] = useState(null);
  const { notes, fetchNotes, createNote, updateNote, deleteNote } = useTastingNotes();
  const price250 = pricePer250g(coffee.price_per_gram);

  // Always fetch notes on mount
  useEffect(() => {
    fetchNotes(coffee.product_id);
  }, [coffee.product_id, fetchNotes]);

  const handleSaveNote = useCallback(async (noteData) => {
    await createNote(noteData);
    setShowForm(false);
    fetchNotes(coffee.product_id);
    onNoteAdded();
  }, [createNote, fetchNotes, coffee.product_id, onNoteAdded]);

  const handleUpdateNote = useCallback(async (noteData) => {
    await updateNote(editingNote.id, noteData);
    setEditingNote(null);
    fetchNotes(coffee.product_id);
  }, [updateNote, editingNote, fetchNotes, coffee.product_id]);

  const handleDeleteNote = useCallback(async (noteId) => {
    await deleteNote(noteId);
    fetchNotes(coffee.product_id);
    onNoteAdded();
  }, [deleteNote, fetchNotes, coffee.product_id, onNoteAdded]);

  const nextShelf = SHELF_ORDER[(SHELF_ORDER.indexOf(currentShelf) + 1) % SHELF_ORDER.length];

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
      {/* Always expanded — two-column layout */}
      <div className="flex flex-col md:flex-row">
            {/* ── Left: Coffee image + details ──────────────────── */}
            <div className="md:w-[200px] md:shrink-0 md:border-r p-3" style={{ borderColor: "var(--color-border)" }}>
              {/* Large image */}
              {coffee.image_url ? (
                <img
                  src={coffee.image_url}
                  alt=""
                  className="w-full aspect-square rounded-lg object-cover mb-3"
                  loading="lazy"
                />
              ) : (
                <div
                  className="w-full aspect-square rounded-lg flex items-center justify-center mb-3"
                  style={{ background: "var(--color-tag-bg)" }}
                >
                  <Coffee size={32} style={{ color: "var(--color-border)" }} />
                </div>
              )}

              {/* Details */}
              <p className="text-sm font-semibold" style={{ fontFamily: "var(--font-serif)" }}>
                {coffee.coffee_name}
              </p>
              <Link
                to={`/roaster/${coffee.roaster_slug}`}
                className="text-[11px] mt-0.5 hover:underline block"
                style={{ color: "var(--color-text-secondary)" }}
              >
                {coffee.roaster_name}
              </Link>

              {/* Chips */}
              <div className="flex flex-wrap gap-1 mt-2">
                {coffee.roast_level && coffee.roast_level !== "Unknown" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                    style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}>
                    {coffee.roast_level}
                  </span>
                )}
                {coffee.process && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                    style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}>
                    {coffee.process}
                  </span>
                )}
                {price250 && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full"
                    style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}>
                    ₹{price250}/250g
                  </span>
                )}
              </div>

              {/* Quick actions */}
              <div className="flex flex-col gap-1 mt-3 text-[11px]">
                <button onClick={() => onMove(coffee.product_id, nextShelf)}
                  className="flex items-center gap-1 cursor-pointer hover:underline"
                  style={{ color: "var(--color-text-secondary)" }}>
                  <ArrowRight size={9} /> Move to {SHELF_META[nextShelf].label}
                </button>
                <button onClick={() => { trackClick(coffee.product_id, coffee.roaster_slug, "shelf"); window.open(coffee.product_url, "_blank"); }}
                  className="flex items-center gap-1 cursor-pointer hover:underline"
                  style={{ color: "var(--color-text-secondary)" }}>
                  <ExternalLink size={9} /> Buy from roaster
                </button>
                <button onClick={onRemove}
                  className="flex items-center gap-1 cursor-pointer hover:underline text-red-400">
                  <Trash2 size={9} /> Remove
                </button>
              </div>
            </div>

            {/* ── Right: Tasting notes journal ──────────────────── */}
            <div className="flex-1 min-w-0 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2"
                style={{ color: "var(--color-text-secondary)" }}>
                Tasting Journal
                {notes.length > 0 && (
                  <span className="font-normal ml-1">({notes.length} {notes.length === 1 ? "entry" : "entries"})</span>
                )}
              </p>

              {notes.length > 0 ? (
                <div className="space-y-2 mb-3">
                  {notes.map((note) => (
                    editingNote?.id === note.id ? (
                      <TastingNoteForm key={note.id} productId={coffee.product_id}
                        initial={note} onSave={handleUpdateNote} onCancel={() => setEditingNote(null)} />
                    ) : (
                      <TastingNoteDisplay key={note.id} note={note}
                        onEdit={() => setEditingNote(note)} onDelete={() => handleDeleteNote(note.id)} />
                    )
                  ))}
                </div>
              ) : (
                <p className="text-sm italic py-4" style={{ color: "var(--color-text-secondary)" }}>
                  No notes yet. How does this coffee taste to you?
                </p>
              )}

              {showForm ? (
                <TastingNoteForm productId={coffee.product_id}
                  onSave={handleSaveNote} onCancel={() => setShowForm(false)} />
              ) : (
                <button onClick={() => setShowForm(true)}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-lg border text-xs font-medium cursor-pointer hover:bg-black/5"
                  style={{ borderColor: "var(--color-border)", color: "var(--color-accent)" }}>
                  <PenLine size={12} />
                  {notes.length > 0 ? "Add another entry" : "Write a tasting note"}
                </button>
              )}
            </div>
          </div>
    </div>
  );
}
