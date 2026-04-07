import { useState } from "react";
import { PenLine, Trash2, ChevronDown, ChevronUp } from "lucide-react";

const ATTR_LABELS = {
  acidity: ["", "Flat", "Soft", "Balanced", "Crisp", "Bright"],
  body: ["", "Tea-like", "Light", "Medium", "Full", "Syrupy"],
  sweetness: ["", "Absent", "Faint", "Moderate", "Pronounced", "Intense"],
  aftertaste: ["", "Clean", "Brief", "Moderate", "Lasting", "Lingering"],
};

const BREW_LABELS = {
  pour_over: "Pour Over", south_indian_filter: "South Indian Filter",
  french_press: "French Press", aeropress: "AeroPress", espresso: "Espresso",
  moka_pot: "Moka Pot", cold_brew: "Cold Brew", chemex: "Chemex",
  clever_dripper: "Clever Dripper", turkish: "Turkish", siphon: "Siphon",
  instant: "Instant",
};

const DRINK_LABELS = {
  black: "Black", americano: "Americano", cortado: "Cortado",
  macchiato: "Macchiato", flat_white: "Flat White", cappuccino: "Cappuccino",
  latte: "Latte", mocha: "Mocha", iced: "Iced",
  cold_brew_neat: "Cold Brew", filter_black: "Filter",
  south_indian_filter_coffee: "SI Filter Coffee",
  affogato: "Affogato", lungo: "Lungo", ristretto: "Ristretto",
};

const MILK_LABELS = {
  none: "Black", whole: "Whole Milk", toned: "Toned", skim: "Skim",
  oat: "Oat", almond: "Almond", soy: "Soy", coconut: "Coconut",
};

const GRIND_LABELS = {
  extra_fine: "Extra Fine", fine: "Fine", medium_fine: "Medium-Fine",
  medium: "Medium", medium_coarse: "Medium-Coarse", coarse: "Coarse",
};

function formatDate(iso) {
  const d = new Date(iso);
  const day = d.getDate();
  const suffix = day === 1 || day === 21 || day === 31 ? "st"
    : day === 2 || day === 22 ? "nd"
    : day === 3 || day === 23 ? "rd" : "th";
  const month = d.toLocaleDateString("en-US", { month: "long" });
  return `${day}${suffix} ${month}, ${d.getFullYear()}`;
}

export default function TastingNoteDisplay({ note, onEdit, onDelete }) {
  const [showDetails, setShowDetails] = useState(false);

  const hasSliders = note.acidity || note.body || note.sweetness || note.aftertaste;
  const hasTags = note.flavor_tags && note.flavor_tags.length > 0;
  const hasRecipe = note.dose_grams || note.yield_grams || note.water_ml ||
    note.extraction_time_secs || note.water_temp_celsius || note.grind_size || note.brew_ratio;
  const hasAdvanced = hasSliders || hasTags || hasRecipe;

  // Drink summary line: "Cortado · Oat Milk · Espresso"
  const drinkLine = [
    note.drink_style && DRINK_LABELS[note.drink_style],
    note.milk_type && note.milk_type !== "none" && MILK_LABELS[note.milk_type],
    note.brew_method && BREW_LABELS[note.brew_method],
  ].filter(Boolean).join(" · ");

  return (
    <div className="rounded-xl p-4" style={{ background: "var(--color-tag-bg)" }}>
      {/* ── Date + actions ─────────────────────────────────── */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs italic" style={{ color: "var(--color-text-secondary)" }}>
          {formatDate(note.created_at)}
        </span>
        {(onEdit || onDelete) && (
          <div className="flex items-center gap-2">
            {onEdit && (
              <button onClick={onEdit} className="cursor-pointer hover:opacity-70" title="Edit">
                <PenLine size={12} style={{ color: "var(--color-text-secondary)" }} />
              </button>
            )}
            {onDelete && (
              <button onClick={onDelete} className="cursor-pointer hover:opacity-70" title="Delete">
                <Trash2 size={12} className="text-red-400" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* ── Comment (the story — always first) ─────────────── */}
      {note.comment && (
        <p className="text-sm leading-relaxed mb-3">
          {note.comment}
        </p>
      )}

      {/* ── Drink line (compact summary) ───────────────────── */}
      {drinkLine && (
        <p className="text-xs font-medium mb-2" style={{ color: "var(--color-accent)" }}>
          {drinkLine}
        </p>
      )}

      {/* ── Flavor tags (visible by default — they're the highlight) */}
      {hasTags && (
        <div className="flex flex-wrap gap-1 mb-2">
          {note.flavor_tags.map((tag) => (
            <span
              key={tag}
              className="px-2 py-0.5 rounded-full text-[11px]"
              style={{ background: "var(--color-card-front)", color: "var(--color-tag-text)" }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* ── Advanced details (collapsible) ─────────────────── */}
      {hasAdvanced && (
        <>
          <button
            onClick={() => setShowDetails((s) => !s)}
            className="flex items-center gap-1 text-[11px] cursor-pointer mt-1"
            style={{ color: "var(--color-text-secondary)" }}
          >
            {showDetails ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            {showDetails ? "Hide details" : "Show brew details"}
          </button>

          {showDetails && (
            <div className="mt-2 pt-2 border-t" style={{ borderColor: "var(--color-border)" }}>
              {/* Recipe params */}
              {hasRecipe && (
                <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs mb-2" style={{ color: "var(--color-text-secondary)" }}>
                  {note.dose_grams && <span>{note.dose_grams}g in</span>}
                  {note.yield_grams && <span>{note.yield_grams}g out</span>}
                  {note.water_ml && <span>{note.water_ml}ml water</span>}
                  {note.brew_ratio && <span>Ratio {note.brew_ratio}</span>}
                  {note.extraction_time_secs && <span>{note.extraction_time_secs}s</span>}
                  {note.water_temp_celsius && <span>{note.water_temp_celsius}°C</span>}
                  {note.grind_size && <span>{GRIND_LABELS[note.grind_size]}</span>}
                </div>
              )}

              {/* Physical attributes */}
              {hasSliders && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {["acidity", "body", "sweetness", "aftertaste"].map((attr) => {
                    const val = note[attr];
                    if (!val) return null;
                    return (
                      <div key={attr} className="flex justify-between">
                        <span className="capitalize" style={{ color: "var(--color-text-secondary)" }}>{attr}</span>
                        <span className="font-medium">{ATTR_LABELS[attr][val]}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
