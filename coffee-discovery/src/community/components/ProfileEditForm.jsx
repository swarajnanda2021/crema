import { useState } from "react";
import { X } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import ImageCropModal from "./ImageCropModal";

const PREFS = [
  { key: "light", label: "Light" },
  { key: "medium", label: "Medium" },
  { key: "dark", label: "Dark" },
];

const STYLES = [
  { key: "espresso", label: "Espresso" },
  { key: "filter", label: "Filter" },
  { key: "both", label: "Both" },
];

export default function ProfileEditForm({ user, onClose }) {
  const { updateProfile } = useAuth();
  const [form, setForm] = useState({
    display_name: user.display_name || "",
    bio: user.bio || "",
    avatar_url: user.avatar_url || "",
    location: user.location || "",
    coffee_preference: user.coffee_preference || null,
    brewing_style: user.brewing_style || null,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [cropSrc, setCropSrc] = useState(null); // image data URL for cropper

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      await updateProfile(form);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div
        className="relative w-full max-w-md rounded-xl p-6 max-h-[85vh] overflow-y-auto"
        style={{ background: "var(--color-bg)" }}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-serif)" }}>
            Edit Profile
          </h2>
          <button onClick={onClose} className="cursor-pointer"><X size={20} /></button>
        </div>

        <form onSubmit={handleSave} className="space-y-4">
          <Field label="Display Name">
            <input
              value={form.display_name}
              onChange={(e) => set("display_name", e.target.value)}
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--color-border)" }}
            />
          </Field>

          <Field label="Profile Photo">
            <div className="flex gap-3 items-center">
              {form.avatar_url ? (
                <img src={form.avatar_url} alt="" className="w-16 h-16 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-16 h-16 rounded-full flex items-center justify-center text-xs shrink-0"
                  style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}>
                  No photo
                </div>
              )}
              <div className="flex-1">
                <label
                  className="inline-block px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer"
                  style={{ background: "var(--color-accent)", color: "white" }}
                >
                  Choose photo
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => setCropSrc(reader.result);
                      reader.readAsDataURL(file);
                    }}
                  />
                </label>
                <p className="text-[10px] mt-1" style={{ color: "var(--color-text-secondary)" }}>
                  Pinch or scroll to zoom, drag to reposition
                </p>
              </div>
            </div>
          </Field>

          {/* Image crop modal */}
          {cropSrc && (
            <ImageCropModal
              imageSrc={cropSrc}
              onCrop={async (blob) => {
                // Upload the cropped blob
                const formData = new FormData();
                formData.append("file", blob, "avatar.jpg");
                try {
                  const token = localStorage.getItem("coffee_session_token");
                  const res = await fetch(
                    `http://${window.location.hostname}:8000/api/upload/avatar`,
                    {
                      method: "POST",
                      headers: token ? { Authorization: `Bearer ${token}` } : {},
                      body: formData,
                    }
                  );
                  if (res.ok) {
                    const data = await res.json();
                    set("avatar_url", data.avatar_url);
                  }
                } catch {
                  // Upload failed
                }
                setCropSrc(null);
              }}
              onClose={() => setCropSrc(null)}
            />
          )}

          <Field label="Location">
            <input
              value={form.location}
              onChange={(e) => set("location", e.target.value)}
              placeholder="e.g. Goa, India"
              className="w-full rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--color-border)" }}
            />
          </Field>

          <Field label="Bio">
            <textarea
              value={form.bio}
              onChange={(e) => set("bio", e.target.value)}
              maxLength={280}
              rows={3}
              placeholder="A few words about your coffee journey..."
              className="w-full rounded-lg border px-3 py-2 text-sm resize-none"
              style={{ borderColor: "var(--color-border)" }}
            />
            <p className="text-[10px] text-right" style={{ color: "var(--color-text-secondary)" }}>
              {form.bio.length}/280
            </p>
          </Field>

          <Field label="Coffee Preference">
            <div className="flex gap-1.5">
              {PREFS.map((p) => (
                <PillBtn
                  key={p.key}
                  label={p.label}
                  active={form.coffee_preference === p.key}
                  onClick={() => set("coffee_preference", form.coffee_preference === p.key ? null : p.key)}
                />
              ))}
            </div>
          </Field>

          <Field label="Brewing Style">
            <div className="flex gap-1.5">
              {STYLES.map((s) => (
                <PillBtn
                  key={s.key}
                  label={s.label}
                  active={form.brewing_style === s.key}
                  onClick={() => set("brewing_style", form.brewing_style === s.key ? null : s.key)}
                />
              ))}
            </div>
          </Field>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            type="submit"
            disabled={saving}
            className="w-full py-2.5 rounded-lg text-white font-semibold text-sm cursor-pointer"
            style={{ background: "var(--color-accent)" }}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="text-[10px] font-semibold uppercase tracking-wider block mb-1"
        style={{ color: "var(--color-text-secondary)" }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function PillBtn({ label, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="px-3 py-1.5 rounded-full text-xs cursor-pointer transition-colors"
      style={{
        background: active ? "var(--color-accent)" : "var(--color-tag-bg)",
        color: active ? "white" : "var(--color-tag-text)",
        fontWeight: active ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}
