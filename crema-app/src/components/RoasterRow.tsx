/**
 * RoasterRow — the canonical roaster list item, shared across the
 * consumer Discover ROASTERS tab and the admin Catalog Ops ROASTERS
 * sub-tab. Square `RoasterLogo` thumb on the left (canonical roaster
 * identity treatment), name + sub-lines centered, outline circular
 * arrow button on the right, hairline divider underneath. Press
 * state tints the row with the Crema pink (`t.color.flash`).
 *
 * Sizes scale via `useBreakpoint`: thumb is 96 on mobile, 110 on
 * wide; arrow scales down on mobile so the 390 px viewport doesn't
 * crush the name into 3-line wrap.
 *
 * Admin callers can pass `pillLabel="Draft"` to surface the lifecycle
 * state as a top-left pill over the thumb.
 */

import { View, Text, Pressable, StyleSheet } from "react-native";
import { ArrowRight } from "lucide-react-native";

import { t, makeStyles } from "../tokens/useTokens";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { tap as hapticTap } from "../utils/haptics";
import RoasterLogo from "./primitives/RoasterLogo";

export default function RoasterRow({
  imageUrl,
  name,
  city,
  state,
  productsCount,
  pillLabel,
  showDivider = true,
  onPress,
}: {
  imageUrl?: string | null;
  name: string;
  city?: string | null;
  state?: string | null;
  productsCount?: number;
  pillLabel?: string;
  showDivider?: boolean;
  onPress: () => void;
}) {
  const { isMobile } = useBreakpoint();
  const s = useStyles();
  // Square thumbs sitewide (canonical roaster identity treatment).
  // Slightly larger than the previous 100×76 / 167×76 rectangles so
  // the logo has room to breathe inside the rounded square.
  const thumbSize = isMobile ? 96 : 110;
  const arrowSize = isMobile ? 44 : 60;
  const arrowIconSize = isMobile ? 16 : 22;

  // Two separate sub-lines so the catalog count gets its own row under
  // the location — easier to scan than the original "City, State | N
  // coffees" mash-up, and gives long roaster names more breathing room.
  const cityState = [city, state].filter(Boolean).join(", ");
  const coffeesLine =
    productsCount && productsCount > 0
      ? `${productsCount} ${productsCount === 1 ? "Speciality Coffee" : "Speciality Coffees"}`
      : null;

  return (
    <Pressable
      onPress={() => {
        hapticTap();
        onPress();
      }}
      style={({ pressed }) => [s.row, pressed && s.rowActive]}
      accessibilityLabel={`Open ${name}`}
    >
      <View style={{ position: "relative" }}>
        <RoasterLogo url={imageUrl} size={thumbSize} fallbackInitial={name} />
        {pillLabel ? (
          <View style={s.pill}>
            <Text style={s.pillText}>{pillLabel}</Text>
          </View>
        ) : null}
      </View>

      <View style={s.info}>
        <Text style={s.name} numberOfLines={1}>
          {name}
        </Text>
        {cityState ? (
          <Text style={s.sub} numberOfLines={1}>
            {cityState}
          </Text>
        ) : null}
        {coffeesLine ? (
          <Text style={s.subCount} numberOfLines={1}>
            {coffeesLine}
          </Text>
        ) : null}
      </View>

      <View
        style={[
          s.arrowBtn,
          { width: arrowSize, height: arrowSize, borderRadius: arrowSize / 2 },
        ]}
      >
        <ArrowRight
          size={arrowIconSize}
          color={t.color["text.primary"]}
          strokeWidth={1.5}
        />
      </View>

      {showDivider ? <View style={s.divider} /> : null}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    width: "100%" as any,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
    // Match the BEANS grid's `GRID_PAD = 16` so BEANS / ROASTERS read
    // as one consistent inset across the Discover sub-tabs (was xs = 4
    // before — too tight, broke parity with the bean grid).
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    backgroundColor: "transparent",
    position: "relative",
    cursor: "pointer" as any,
  } as any,
  rowActive: {
    backgroundColor: t.color.flash,
  } as any,
  pill: {
    position: "absolute",
    top: t.spacing.xs,
    left: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: 2,
    borderRadius: t.radius.full,
    backgroundColor: t.color["accent.cta"],
  } as any,
  pillText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.on-cta"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  info: {
    flex: 1,
    minWidth: 0,
    gap: t.spacing["2xs"],
  } as any,
  // Title is `font.xl` (18) — ~25% larger than the `font.md` (14)
  // sub-line, per the user's spec. Gives the long roaster names a fair
  // chance on a 360-px row without pushing the arrow off the edge.
  name: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xl"],
    color: t.color["text.primary"],
    lineHeight: t.lineHeight.relaxed,
  } as any,
  sub: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.secondary"],
    lineHeight: t.lineHeight.relaxed,
  } as any,
  // Catalog count sits on its own line under city/state — easier to
  // scan than the original "City | N coffees" mash-up. Same body size
  // and color as the location line to keep the meta block visually
  // unified.
  subCount: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.secondary"],
    lineHeight: t.lineHeight.relaxed,
  } as any,
  arrowBtn: {
    borderWidth: 1.5,
    borderColor: t.color["text.primary"],
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
    flexShrink: 0,
  } as any,
  divider: {
    position: "absolute",
    // Spans the full row width so the visible delineation between
    // rows matches the outer edge of the Onboard hero card on the
    // admin Catalog Ops Roasters surface (and reads as a single
    // continuous list on the consumer Discover ROASTERS tab).
    // Earlier inset was `t.spacing.lg` on each side which made
    // rows look narrower than the bordered hero card stacked above.
    left: 0,
    right: 0,
    bottom: 0,
    height: 1,
    backgroundColor: t.color.divider,
  } as any,
}));
