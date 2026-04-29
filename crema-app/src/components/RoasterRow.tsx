/**
 * RoasterRow — the canonical roaster list item, shared across the
 * consumer Discover ROASTERS tab and the admin Catalog Ops ROASTERS
 * sub-tab. Faithfully ports the Figma row design at node 40:2769:
 * image-left + name (Inter, large) + sub-line (Inter, body) + outline
 * circular arrow button right + hairline divider underneath. Press
 * state tints the row with the Crema pink (`t.color.flash`) so the
 * hover affordance stays consistent with the marketplace's flash
 * highlight language.
 *
 * Sizes scale via `useBreakpoint`: wide screens get the literal Figma
 * dimensions (167×76 image, 60 px arrow); mobile scales image and
 * arrow down so the row still breathes on a 390 px viewport without
 * crushing the name into 3-line wrap.
 *
 * Admin callers can pass `pillLabel="Draft"` to surface the lifecycle
 * state as a top-left pill over the image — same geometry the old
 * portrait `RoasterCard` used so no visual vocabulary is lost in the
 * row migration.
 */

import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { ArrowRight, Coffee } from "lucide-react-native";

import { t } from "../tokens/useTokens";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { resolveUploadUrl } from "../api/client";
import { tap as hapticTap } from "../utils/haptics";

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
  const imageW = isMobile ? 100 : 167;
  const imageH = 76;
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
      <View style={[s.imageWrap, { width: imageW, height: imageH }]}>
        {imageUrl ? (
          <Image
            source={{ uri: resolveUploadUrl(imageUrl) || imageUrl }}
            style={StyleSheet.absoluteFillObject as any}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View style={[StyleSheet.absoluteFillObject as any, s.imageFallback]}>
            <Coffee size={t.size["icon.xl"]} color={t.color["text.muted"]} strokeWidth={1.5} />
          </View>
        )}
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

const s = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
    // Tight horizontal padding (xs = 4) so the image hugs the left
    // edge and the arrow hugs the right — gives the name + sub +
    // count their full share of a 360-px viewport.
    paddingHorizontal: t.spacing.xs,
    paddingVertical: t.spacing.md,
    backgroundColor: "transparent",
    position: "relative",
    cursor: "pointer" as any,
  } as any,
  rowActive: {
    backgroundColor: t.color.flash,
  } as any,
  imageWrap: {
    borderRadius: t.radius.xs,
    overflow: "hidden",
    backgroundColor: t.color["card.info"],
    position: "relative",
    flexShrink: 0,
  } as any,
  imageFallback: {
    alignItems: "center",
    justifyContent: "center",
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
    color: t.color["text.on-dark"],
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
    // Inset matches the row's `paddingHorizontal` so the hairline
    // starts/ends flush with the image / arrow.
    left: t.spacing.xs,
    right: t.spacing.xs,
    bottom: 0,
    height: 1,
    backgroundColor: t.color.divider,
  } as any,
});
