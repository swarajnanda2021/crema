/**
 * Design token provider — reads from design-tokens.json.
 *
 * This is the ONLY file that maps raw token values to platform-specific styles.
 * On iOS/Swift, you'd replace this with a Swift equivalent reading the same JSON.
 *
 * Usage:
 *   import { t, font, shadow } from "../tokens/useTokens";
 *   <View style={{ backgroundColor: t.color.bg }}>
 *   <Text style={font("body.semibold", "font.md")}>Hello</Text>
 */

import tokens from "./design-tokens.json";

// Re-export the raw tokens for direct access
export const t = tokens;

// ── Convenience helpers ─────────────────────────────────────────────────────

/** Build a font style from token keys. */
export function font(
  family: keyof typeof tokens.font,
  size?: keyof typeof tokens.size,
): { fontFamily: string; fontSize?: number } {
  const result: any = { fontFamily: tokens.font[family] };
  if (size) result.fontSize = tokens.size[size];
  return result;
}

/** Build a shadow style from token key. */
export function shadow(key: keyof typeof tokens.shadow) {
  const s = tokens.shadow[key];
  return {
    shadowColor: s.color,
    shadowOffset: { width: s.offset[0], height: s.offset[1] },
    shadowOpacity: s.opacity,
    shadowRadius: s.radius,
    elevation: s.elevation,
  };
}

/** Get a shelf config by key. */
export function shelfConfig(key: string) {
  return (tokens.shelf as any)[key] || { label: key, color: "#A09580" };
}

/** Shorthand for spacing values. */
export function sp(key: keyof typeof tokens.spacing): number {
  return tokens.spacing[key];
}

/** Shorthand for radius values. */
export function rad(key: keyof typeof tokens.radius): number {
  return tokens.radius[key];
}

/** Shorthand for size values. */
export function sz(key: keyof typeof tokens.size): number {
  return tokens.size[key];
}

// ── Backward compatibility (drop-in for old colors.ts imports) ──────────────

export const colors = {
  bg: tokens.color.bg,
  cardFront: tokens.color["card.front"],
  cardBack: tokens.color["card.back"],
  cardInfo: tokens.color["card.info"],
  textPrimary: tokens.color["text.primary"],
  textSecondary: tokens.color["text.secondary"],
  textOnDark: tokens.color["text.on-dark"],
  textMuted: tokens.color["text.muted"],
  accent: tokens.color["accent.cta"],
  accentHover: tokens.color["accent.cta.hover"],
  like: tokens.color.accent,
  purple: tokens.color.accent,
  gold: tokens.color["accent.gold"],
  navbarBg: tokens.color["navbar.bg"],
  tagBg: tokens.color["tag.bg"],
  tagText: tokens.color["tag.text"],
  border: tokens.color.border,
  borderLight: tokens.color["border.light"],
  divider: tokens.color.divider,
  unavailable: tokens.color.unavailable,
  accentSoft: tokens.color["accent.soft"],
  shadowColor: tokens.color.shadow,
};

export const fonts = {
  displayRegular: tokens.font.display,
  bodyRegular: tokens.font["body.regular"],
  bodyMedium: tokens.font["body.medium"],
  bodySemiBold: tokens.font["body.semibold"],
  bodyBold: tokens.font["body.bold"],
};

export const NAVBAR_HEIGHT = tokens.size["navbar.height"];

export const cardShadow = shadow("card");
export const cardShadowHover = shadow("card.hover");

export const SHELF_LABELS = tokens.shelf;

export type ShelfKey = "currently_drinking" | "drank" | "want_to_try";
