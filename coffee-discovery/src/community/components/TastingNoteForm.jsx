import { useState, useEffect } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { apiFetch } from "../api";

const SLIDER_LABELS = {
  acidity: ["Flat", "Soft", "Balanced", "Crisp", "Bright"],
  body: ["Tea-like", "Light", "Medium", "Full", "Syrupy"],
  sweetness: ["Absent", "Faint", "Moderate", "Pronounced", "Intense"],
  aftertaste: ["Clean", "Brief", "Moderate", "Lasting", "Lingering"],
};

export default function TastingNoteForm({ productId, onSave, onCancel, initial }) {
  const [form, setForm] = useState({
    comment: initial?.comment || "",
    brew_method: initial?.brew_method || null,
    drink_style: initial?.drink_style || null,
    milk_type: initial?.milk_type || null,
    // Advanced
    acidity: initial?.acidity || null,
    body: initial?.body || null,
    sweetness: initial?.sweetness || null,
    aftertaste: initial?.aftertaste || null,
    flavor_tags: initial?.flavor_tags || [],
    dose_grams: initial?.dose_grams || "",
    yield_grams: initial?.yield_grams || "",
    water_ml: initial?.water_ml || "",
    extraction_time_secs: initial?.extraction_time_secs || "",
    water_temp_celsius: initial?.water_temp_celsius || "",
    grind_size: initial?.grind_size || null,
    brew_ratio: initial?.brew_ratio || "",
  });
  const [dict, setDict] = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(!!initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    apiFetch("/dictionary/all").then(setDict).catch(() => {});
  }, []);

  const set = (key, val) => setForm((f) => ({ ...f, [key]: val }));

  const toggleTag = (tag) => {
    setForm((f) => {
      const tags = f.flavor_tags.includes(tag)
        ? f.flavor_tags.filter((t) => t !== tag)
        : f.flavor_tags.length < 8
        ? [...f.flavor_tags, tag]
        : f.flavor_tags;
      return { ...f, flavor_tags: tags };
    });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await onSave({
        product_id: productId,
        ...form,
        flavor_tags: form.flavor_tags.length > 0 ? form.flavor_tags : null,
        dose_grams: form.dose_grams ? Number(form.dose_grams) : null,
        yield_grams: form.yield_grams ? Number(form.yield_grams) : null,
        water_ml: form.water_ml ? Number(form.water_ml) : null,
        extraction_time_secs: form.extraction_time_secs ? Number(form.extraction_time_secs) : null,
        water_temp_celsius: form.water_temp_celsius ? Number(form.water_temp_celsius) : null,
        brew_ratio: form.brew_ratio || null,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!dict) return <p className="text-sm py-4" style={{ color: "var(--color-text-secondary)" }}>Loading...</p>;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* ══════════════════════════════════════════════════════
          LIGHT MODE — always visible
          ══════════════════════════════════════════════════════ */}

      {/* Comment — the story, always first */}
      <div>
        <textarea
          value={form.comment}
          onChange={(e) => set("comment", e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="What are you drinking? How does it taste? Write freely..."
          className="w-full rounded-lg border px-3 py-2.5 text-sm resize-none"
          style={{ borderColor: "var(--color-border)" }}
          autoFocus
        />
        <p className="text-[10px] text-right mt-0.5" style={{ color: "var(--color-text-secondary)" }}>
          {form.comment.length}/500
        </p>
      </div>

      {/* Drink style — how are you having it */}
      <Section label="Having it as">
        <PillGrid
          items={dict.drink_styles}
          selected={form.drink_style}
          onSelect={(key) => set("drink_style", form.drink_style === key ? null : key)}
        />
      </Section>

      {/* Brew method */}
      <Section label="Brewed with">
        <PillGrid
          items={dict.brew_methods}
          selected={form.brew_method}
          onSelect={(key) => set("brew_method", form.brew_method === key ? null : key)}
        />
      </Section>

      {/* Milk */}
      <Section label="Milk">
        <PillGrid
          items={dict.milk_types}
          selected={form.milk_type}
          onSelect={(key) => set("milk_type", form.milk_type === key ? null : key)}
        />
      </Section>

      {/* ══════════════════════════════════════════════════════
          ADVANCED MODE — collapsed by default
          ══════════════════════════════════════════════════════ */}

      <button
        type="button"
        onClick={() => setShowAdvanced((s) => !s)}
        className="flex items-center gap-1.5 text-xs font-medium cursor-pointer w-full justify-center py-2 rounded-lg hover:bg-black/5"
        style={{ color: "var(--color-accent)" }}
      >
        {showAdvanced ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {showAdvanced ? "Hide brew details & tasting" : "Add brew details & tasting"}
      </button>

      {showAdvanced && (
        <div className="space-y-4 pt-2 border-t" style={{ borderColor: "var(--color-border)" }}>
          {/* Recipe parameters */}
          <Section label="Recipe">
            <div className="grid grid-cols-3 gap-2">
              <NumInput label="Dose" unit="g" value={form.dose_grams} onChange={(v) => set("dose_grams", v)} placeholder="18" />
              <NumInput label="Yield" unit="g" value={form.yield_grams} onChange={(v) => set("yield_grams", v)} placeholder="36" />
              <NumInput label="Water" unit="ml" value={form.water_ml} onChange={(v) => set("water_ml", v)} placeholder="250" />
              <NumInput label="Time" unit="s" value={form.extraction_time_secs} onChange={(v) => set("extraction_time_secs", v)} placeholder="28" />
              <NumInput label="Temp" unit="°C" value={form.water_temp_celsius} onChange={(v) => set("water_temp_celsius", v)} placeholder="93" />
              <div>
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--color-text-secondary)" }}>Ratio</p>
                <input
                  value={form.brew_ratio}
                  onChange={(e) => set("brew_ratio", e.target.value)}
                  placeholder="1:2"
                  className="w-full rounded-lg border px-2 py-1.5 text-sm"
                  style={{ borderColor: "var(--color-border)" }}
                />
              </div>
            </div>
          </Section>

          {/* Grind */}
          <Section label="Grind Size">
            <PillGrid
              items={dict.grind_sizes}
              selected={form.grind_size}
              onSelect={(key) => set("grind_size", form.grind_size === key ? null : key)}
            />
          </Section>

          {/* Tasting sliders */}
          <Section label="Tasting">
            {Object.entries(SLIDER_LABELS).map(([attr, labels]) => (
              <div key={attr} className="mb-2.5">
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--color-text-secondary)" }}>{attr}</p>
                <div className="flex gap-0.5">
                  {labels.map((label, i) => {
                    const val = i + 1;
                    const active = form[attr] === val;
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() => set(attr, active ? null : val)}
                        className="flex-1 py-1.5 rounded text-[10px] text-center cursor-pointer transition-colors"
                        style={{
                          background: active ? "var(--color-accent)" : "var(--color-tag-bg)",
                          color: active ? "white" : "var(--color-tag-text)",
                          fontWeight: active ? 600 : 400,
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </Section>

          {/* Flavor tags */}
          <Section label={`Flavor Tags (${form.flavor_tags.length}/8)`}>
            {Object.entries(dict.flavors).map(([category, value]) => {
              const tags = [];
              if (Array.isArray(value)) tags.push(...value);
              else Object.values(value).forEach((sub) => { if (Array.isArray(sub)) tags.push(...sub); });
              return (
                <div key={category} className="mb-2">
                  <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--color-text-secondary)" }}>{category}</p>
                  <div className="flex flex-wrap gap-1">
                    {tags.map((tag) => {
                      const active = form.flavor_tags.includes(tag);
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => toggleTag(tag)}
                          className="px-2 py-0.5 rounded-full text-[10px] cursor-pointer transition-colors"
                          style={{
                            background: active ? "var(--color-accent)" : "var(--color-tag-bg)",
                            color: active ? "white" : "var(--color-tag-text)",
                          }}
                        >
                          {tag}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </Section>
        </div>
      )}

      {/* ── Submit ─────────────────────────────────────────── */}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex-1 py-2 rounded-lg text-white font-semibold text-sm cursor-pointer"
          style={{ background: "var(--color-accent)" }}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border text-sm cursor-pointer"
            style={{ borderColor: "var(--color-border)" }}
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function Section({ label, children }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1.5" style={{ color: "var(--color-text-secondary)" }}>
        {label}
      </p>
      {children}
    </div>
  );
}

function PillGrid({ items, selected, onSelect }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => {
        const active = selected === item.key;
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onSelect(item.key)}
            className="px-2.5 py-1 rounded-full text-xs cursor-pointer transition-colors"
            style={{
              background: active ? "var(--color-accent)" : "var(--color-tag-bg)",
              color: active ? "white" : "var(--color-tag-text)",
              fontWeight: active ? 600 : 400,
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function NumInput({ label, unit, value, onChange, placeholder }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--color-text-secondary)" }}>{label}</p>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded-lg border px-2 py-1.5 text-sm"
          style={{ borderColor: "var(--color-border)" }}
        />
        <span className="text-[10px] shrink-0" style={{ color: "var(--color-text-secondary)" }}>{unit}</span>
      </div>
    </div>
  );
}
