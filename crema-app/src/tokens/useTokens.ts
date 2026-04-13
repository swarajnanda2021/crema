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

export const NAVBAR_HEIGHT = tokens.size["navbar.height"];

export const cardShadow = shadow("card");
export const cardShadowHover = shadow("card.hover");

export const SHELF_LABELS = tokens.shelf;

export type ShelfKey = "currently_drinking" | "drank" | "want_to_try";
