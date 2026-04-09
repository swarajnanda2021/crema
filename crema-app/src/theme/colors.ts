/**
 * Crema Design System — Redesigned palette from Figma
 * Deep brown + cream + purple accent
 */

export const colors = {
  // Core palette
  bg: "#FAF8F0",
  cardFront: "#FFFFFF",
  cardBack: "#2C1810",
  cardInfo: "#EFE9DB",

  // Text hierarchy
  textPrimary: "#351101",
  textSecondary: "#684F44",
  textOnDark: "#FAF8F0",
  textMuted: "#A09580",

  // Accents
  accent: "#C8553D",
  accentHover: "#A94432",
  accentSoft: "rgba(200, 85, 61, 0.08)",
  like: "#D798DA",
  gold: "#E8C07A",
  purple: "#D798DA",

  // Navbar
  navbarBg: "#351101",

  // Surfaces
  tagBg: "#EFE9DB",
  tagText: "#5D4E42",
  border: "#D7D1C4",
  borderLight: "#EDE8E1",
  divider: "#C7BAA5",
  unavailable: "#B0A89F",

  // Shadows
  shadowColor: "#351101",
} as const;

export const fonts = {
  // Display — Canela Text for coffee names & prices
  displayRegular: "CanelaText_Regular",
  displaySemiBold: "CanelaText_Regular",  // only one weight available
  displayBold: "CanelaText_Regular",

  // Body — Inter for all UI text
  bodyRegular: "Inter_400Regular",
  bodyMedium: "Inter_500Medium",
  bodySemiBold: "Inter_600SemiBold",
  bodyBold: "Inter_700Bold",
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
