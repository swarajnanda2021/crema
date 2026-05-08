/**
 * FabPill — the Crema-pink rounded pill the app uses for every
 * floating action button (Figma 864:3286 spec).
 *
 * Geometry is LITERAL to the Figma node — every value below is the
 * exact pixel that node 864:3286's metadata reports, not a
 * token-ladder approximation. Per CLAUDE.md "Hard rule — Figma is
 * literal": when a Figma node specifies a value, that value wins
 * over the spacing/radius ladder, even if it's off-ladder.
 *
 *   • Frame: 119 × 33
 *   • borderRadius: 30.269 (Figma's value — anything ≥ 16.5
 *     produces a perfect pill at this height, but earlier passes
 *     using `t.radius.full` (9999) rendered with sharp vertical
 *     edges in some environments. The literal Figma value is the
 *     spec.)
 *   • paddingTop / paddingBottom: 8 (Plus icon top at y=8, frame
 *     bottom at y=33 with icon h=17 → 33-8-17=8 below)
 *   • paddingLeft: 9 (Plus icon left at x=9 from frame)
 *   • paddingRight: 12 (text right edge at 28.79+78=106.79;
 *     119-106.79 ≈ 12)
 *   • gap: 3 (text left at x=28.79; Plus right at 9+17=26;
 *     28.79-26 ≈ 2.79)
 *
 * Sizing: 17-px lucide icon + `body.semibold` 14-pt label. With
 * the paddings above, the pill comes out to exactly 119×33.
 *
 * Colour: bg `accent` (Crema #D798DA, identical in both modes);
 * icon and label both use `text.on-light` (Espresso #351101 in
 * both modes) so contrast holds against the constant pink.
 *
 * Used by:
 *   • ConditionalCreatePostFab (root layout) — home feed only
 *   • profile.tsx — registered via `useFloatingFab` when on the
 *     personal Posts tab and not editing
 *   • Roaster page — registered via `useFloatingFab` when isOwner
 *     + activeTab=posts + !isEditing
 *   • ArticlesPanel — registered via `useFloatingFab` for Refresh
 *
 * Position is supplied by the caller via `style` — typically
 * `{ position: "absolute", bottom: 28, right: 28 }`. The provider
 * (`FloatingFabProvider` at root layout) anchors registered FAB
 * content to the viewport-stable relative wrapper so neither this
 * pill nor the registered ones jitter during the chrome-scroll
 * height animation. (See §2.40.16 for the diagnosis.)
 */

import { Text } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { t, makeStyles } from "../../tokens/useTokens";
import HapticPressable from "./HapticPressable";

interface FabPillProps {
  /** Leading icon — typically a 17-px lucide glyph or an
   *  ActivityIndicator while the action is in flight. */
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  /** Renders at 0.5 opacity and short-circuits the press. */
  disabled?: boolean;
  /** Caller-supplied positioning + any margin tweaks (typically
   *  `{ position: "absolute", bottom: 28, right: 28 }`). */
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}

export default function FabPill({
  icon,
  label,
  onPress,
  disabled,
  style,
  accessibilityLabel,
}: FabPillProps) {
  const s = useStyles();
  return (
    <HapticPressable
      haptic={disabled ? "none" : "tap"}
      onPress={disabled ? () => {} : onPress}
      style={[s.pill, disabled && s.pillDisabled, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
    >
      {icon}
      <Text style={s.label}>{label}</Text>
    </HapticPressable>
  );
}

const useStyles = makeStyles((t) => ({
  // Numeric values below are LITERAL to Figma 864:3286 — see the
  // file header. They intentionally bypass the spacing/radius
  // ladder where the ladder doesn't match the Figma value (9, 3,
  // 30.269 are off-ladder; 8 and 12 happen to match `sm` and `md`
  // but are written as numbers here for consistency with the rest
  // of the literal block). CLAUDE.md "Hard rule — Figma is
  // literal" sanctions this exception.
  pill: {
    flexDirection: "row",
    alignItems: "center",
    paddingTop: 8,
    paddingBottom: 8,
    paddingLeft: 9,
    paddingRight: 12,
    gap: 3,
    borderRadius: 30.269,
    backgroundColor: t.color.accent,
  } as any,
  pillDisabled: { opacity: 0.5 } as any,
  label: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.on-light"],
    letterSpacing: -0.2,
  } as any,
}));
