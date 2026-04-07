/**
 * Crema design tokens — mirrors the CSS custom properties from index.css
 * Used for inline styles where NativeWind className isn't sufficient.
 */
export const colors = {
  bg: "#FAF7F2",
  cardFront: "#FFFFFF",
  cardBack: "#2C1810",
  textPrimary: "#1A1A1A",
  textSecondary: "#6B5B4F",
  textOnDark: "#F5F0EB",
  accent: "#C8553D",
  accentHover: "#A94432",
  like: "#E63946",
  tagBg: "#EDE8E1",
  tagText: "#5D4E42",
  border: "#E0D8CF",
  unavailable: "#B0A89F",
} as const;

export const fonts = {
  serif: "PlayfairDisplay",
  sans: "Inter",
} as const;

/** Shelf label metadata */
export const SHELF_LABELS = {
  currently_drinking: { label: "Drinking", color: "#C8553D" },
  drank: { label: "Drank", color: "#6B5B4F" },
  want_to_try: { label: "Want to Try", color: "#E8C07A" },
} as const;

export type ShelfKey = keyof typeof SHELF_LABELS;
