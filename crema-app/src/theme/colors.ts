/**
 * Crema Design System — "Artisan Roastery" aesthetic
 * Premium specialty coffee brand feel with warm earth tones.
 */

export const colors = {
  // Core palette
  bg: "#FAF7F2",
  cardFront: "#FFFFFF",
  cardBack: "#2C1810",

  // Text hierarchy
  textPrimary: "#1A1A1A",
  textSecondary: "#6B5B4F",
  textOnDark: "#F5F0EB",
  textMuted: "#9B8F85",

  // Accents
  accent: "#C8553D",
  accentHover: "#A94432",
  accentSoft: "rgba(200, 85, 61, 0.08)",
  like: "#E63946",
  gold: "#E8C07A",

  // Surfaces
  tagBg: "#EDE8E1",
  tagText: "#5D4E42",
  border: "#E0D8CF",
  borderLight: "#EDE8E1",
  unavailable: "#B0A89F",

  // Shadows
  shadowColor: "#2C1810",
} as const;

export const fonts = {
  // Display — Playfair Display for headings, coffee names
  displayRegular: "PlayfairDisplay_400Regular",
  displaySemiBold: "PlayfairDisplay_600SemiBold",
  displayBold: "PlayfairDisplay_700Bold",

  // Body — DM Sans for UI text, labels, buttons
  bodyRegular: "DMSans_400Regular",
  bodyMedium: "DMSans_500Medium",
  bodySemiBold: "DMSans_600SemiBold",
  bodyBold: "DMSans_700Bold",
} as const;

/** Card shadow preset */
export const cardShadow = {
  shadowColor: colors.shadowColor,
  shadowOffset: { width: 0, height: 4 },
  shadowOpacity: 0.06,
  shadowRadius: 16,
  elevation: 3,
} as const;

/** Elevated card shadow */
export const cardShadowHover = {
  shadowColor: colors.shadowColor,
  shadowOffset: { width: 0, height: 8 },
  shadowOpacity: 0.12,
  shadowRadius: 24,
  elevation: 6,
} as const;

/** Shelf label metadata */
export const SHELF_LABELS = {
  currently_drinking: { label: "Drinking", color: "#C8553D" },
  drank: { label: "Drank", color: "#6B5B4F" },
  want_to_try: { label: "Want to Try", color: "#E8C07A" },
} as const;

export type ShelfKey = keyof typeof SHELF_LABELS;
