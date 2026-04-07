import { useState } from "react";
import { MapPin, Calendar, Coffee, Settings, Award, PenLine } from "lucide-react";
import ProfileEditForm from "./ProfileEditForm";

const PREF_LABELS = { light: "Light Roast", medium: "Medium Roast", dark: "Dark Roast" };
const STYLE_LABELS = { espresso: "Espresso", filter: "Filter", both: "Espresso & Filter" };

export default function ProfileCard({ user, drankCount }) {
  const [editing, setEditing] = useState(false);

  const initials = (user.display_name || user.username || "?")
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  return (
    <>
      <div className="rounded-xl overflow-hidden relative" style={{ border: "1px solid var(--color-border)" }}>
        {/* ── Full-bleed avatar background ─────────────────────── */}
        <div className="relative h-[280px] lg:h-[320px]">
          {user.avatar_url ? (
            <img
              src={user.avatar_url}
              alt=""
              className="w-full h-full object-cover"
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #D4C5B8, #E8DDD3)" }}
            >
              <span
                className="text-5xl font-bold"
                style={{ color: "var(--color-text-secondary)", opacity: 0.4 }}
              >
                {initials}
              </span>
            </div>
          )}

          {/* Edit button — top right corner */}
          <button
            onClick={() => setEditing(true)}
            className="absolute top-3 right-3 p-2 rounded-full cursor-pointer backdrop-blur-sm"
            style={{ background: "rgba(255,255,255,0.7)" }}
            title="Edit Profile"
          >
            <PenLine size={14} style={{ color: "var(--color-text-primary)" }} />
          </button>
        </div>

        {/* ── Cream semi-opaque bio overlay ────────────────────── */}
        <div
          className="p-4"
          style={{ background: "rgba(250, 247, 242, 0.95)" }}
        >
          {/* Name + username */}
          <h2 className="font-bold text-lg" style={{ fontFamily: "var(--font-serif)" }}>
            {user.display_name}
          </h2>
          <p className="text-xs" style={{ color: "var(--color-text-secondary)" }}>
            @{user.username}
          </p>

          {/* Location */}
          {user.location && (
            <p className="flex items-center gap-1 text-xs mt-2" style={{ color: "var(--color-text-secondary)" }}>
              <MapPin size={11} /> {user.location}
            </p>
          )}

          {/* Bio */}
          {user.bio && (
            <p className="text-sm mt-2 leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
              {user.bio}
            </p>
          )}

          {/* Preference + style pills */}
          {(user.coffee_preference || user.brewing_style) && (
            <div className="flex flex-wrap gap-1.5 mt-3">
              {user.coffee_preference && (
                <span className="text-[10px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                  style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}>
                  <Coffee size={9} /> {PREF_LABELS[user.coffee_preference]}
                </span>
              )}
              {user.brewing_style && (
                <span className="text-[10px] px-2 py-0.5 rounded-full inline-flex items-center gap-1"
                  style={{ background: "var(--color-tag-bg)", color: "var(--color-tag-text)" }}>
                  <Settings size={9} /> {STYLE_LABELS[user.brewing_style]}
                </span>
              )}
            </div>
          )}

          {/* Stats */}
          <div className="flex items-center gap-3 mt-3 text-xs" style={{ color: "var(--color-text-secondary)" }}>
            <span className="inline-flex items-center gap-1">
              <Award size={11} style={{ color: "var(--color-accent)" }} />
              <strong>{drankCount}</strong> tried
            </span>
            <span className="inline-flex items-center gap-1">
              <Calendar size={11} />
              Since {new Date(user.created_at).getFullYear()}
            </span>
          </div>
        </div>
      </div>

      {editing && (
        <ProfileEditForm user={user} onClose={() => setEditing(false)} />
      )}
    </>
  );
}
