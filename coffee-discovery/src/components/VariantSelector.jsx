import { formatPrice, formatWeight } from "../utils/formatPrice";

export default function VariantSelector({ variants, selected, onSelect }) {
  if (!variants || variants.length <= 1) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {variants.map((v, i) => {
        const isSelected =
          selected && v.weight_grams === selected.weight_grams && v.grind === selected.grind;
        return (
          <button
            key={i}
            onClick={() => onSelect(v)}
            className={`px-3 py-2 rounded-lg border text-sm transition-colors cursor-pointer ${
              isSelected
                ? "font-semibold"
                : "hover:border-[var(--color-accent)]"
            }`}
            style={{
              borderColor: isSelected
                ? "var(--color-accent)"
                : "var(--color-border)",
              background: isSelected ? "var(--color-tag-bg)" : "white",
            }}
          >
            <span className="font-medium">
              {formatWeight(v.weight_grams)}
            </span>
            {v.grind && (
              <span className="text-xs ml-1 opacity-60">({v.grind})</span>
            )}
            <span className="ml-2">{formatPrice(v.price_inr)}</span>
            {!v.available && (
              <span className="ml-1 text-xs opacity-50">(sold out)</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
