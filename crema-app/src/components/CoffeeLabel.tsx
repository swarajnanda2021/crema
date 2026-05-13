/**
 * CoffeeLabel — Info section for product card.
 * All values from Figma node 8:1615 at exact px sizes.
 */
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { useRouter } from "expo-router";
// CoffeeLabel sits inside CoffeeCard, which intentionally pins to the
// light-mode token snapshot (product cards keep their cream-on-white
// identity in night mode). We mirror that by reading `tLight` here so
// the price + tasting-note text stays Deep Brown on cream regardless
// of the active theme.
import { tLight as t } from "../tokens/useTokens";

// Canela lining + proportional numerals. On web we set the OpenType
// features directly; on native iOS/Android the equivalent is the
// RN `fontVariant` style prop (prior to this the native path had no
// override at all — prices rendered with the font's default numeral
// set, which for Canela is old-style and reads wrong alongside
// price labels).
const canelaNumeral = Platform.OS === "web"
  ? ({ fontFeatureSettings: "'lnum', 'pnum'" } as any)
  : ({ fontVariant: ["lining-nums", "proportional-nums"] } as any);

interface CoffeeLabelProps {
  coffee_name: string;
  roast_level: string;
  tasting_notes: string | null;
  flavor_notes: string[] | string | null;
  process: string | null;
  varietal: string | null;
  altitude_masl: number | null;
  price_inr: number;
  weight_grams: number;
  roaster_name: string;
  roaster_slug: string | null;
  bean_type: string | null;
}

function formatINR(n: number): string {
  if (!n || isNaN(n)) return "\u2014";
  return "\u20B9" + n.toLocaleString("en-IN");
}

function CoffeeLabel({
  coffee_name, roast_level, tasting_notes, flavor_notes, process,
  roaster_name, roaster_slug, bean_type,
}: CoffeeLabelProps) {
  const router = useRouter();
  const roastClean = roast_level && roast_level !== "Unknown" ? roast_level : null;
  const processClean = process || null;

  // Display name is the roaster's own product name \u2014 Newton, Nikola,
  // "Gangecool Estate Washed", etc. This used to fall back to an
  // estate string extracted from `origin`, which produced misleading
  // titles ("Ratnagiri Estate" appeared on every Nada bean since
  // they all source from Ratnagiri). The estate stays visible in the
  // detail rows on the full /coffee/[id] page; the card title sticks
  // to the roaster's wording as authored.
  const displayName = coffee_name;

  const roastProcessLine = [
    processClean ? `${processClean} Process` : null,
    roastClean ? `${roastClean} Roast` : null,
  ].filter(Boolean).join(" \u2022 ");

  const fnArr = Array.isArray(flavor_notes) ? flavor_notes
    : (typeof flavor_notes === "string" && flavor_notes
      ? (flavor_notes.startsWith("[") ? JSON.parse(flavor_notes) : flavor_notes.split(",").map((s: string) => s.trim()))
      : []);
  const tastingDisplay = fnArr.length > 0
    ? fnArr.slice(0, 3).join(", ")
    : tasting_notes || null;

  return (
    <View style={s.container}>
      {/* Display name — estate or coffee name — Canela Text 22.722px */}
      <Text style={s.coffeeName} numberOfLines={2}>
        {displayName}
      </Text>

      {/* Roaster — "By " plain + tappable name */}
      <View style={s.roasterRow}>
        <Text style={s.roasterLabel}>By </Text>
        <Pressable
          onPress={roaster_slug ? () => router.push(`/roaster/${roaster_slug}` as any) : undefined}
          disabled={!roaster_slug}
          style={s.roasterLinkPressable}
        >
          <Text style={s.roasterLabel} numberOfLines={1}>{roaster_name}</Text>
        </Pressable>
      </View>

      {/* Divider */}
      <View style={s.divider} />

      {/* Bean type — Arabica / Robusta / Blend */}
      {bean_type ? (
        <>
          <Text style={s.beanTypeText} numberOfLines={1}>{bean_type}</Text>
          <View style={s.divider} />
        </>
      ) : null}

      {/* Process • Roast */}
      {roastProcessLine ? (
        <>
          <Text style={s.detailText} numberOfLines={1}>{roastProcessLine}</Text>
          <View style={s.divider} />
        </>
      ) : null}

      {/* Tasting keywords */}
      {tastingDisplay ? (
        <>
          <Text style={s.tastingText} numberOfLines={1}>{tastingDisplay}</Text>
          <View style={s.divider} />
        </>
      ) : null}
    </View>
  );
}

/** Standalone price component for the bottom row */
export function CoffeeLabelPrice({ price_inr, weight_grams }: { price_inr: number; weight_grams: number }) {
  return (
    <View style={s.priceRow}>
      <Text style={s.priceText}>{formatINR(price_inr)}</Text>
      <Text style={s.weightText}> / {weight_grams} g</Text>
    </View>
  );
}

export default CoffeeLabel;

const s = StyleSheet.create({
  container: {
    flex: 1,
  },

  // Canela Text Regular, 22.722px, #351101
  coffeeName: {
    fontFamily: t.font.display,
    fontSize: 22.7,
    color: t.color["text.primary"],
    lineHeight: 27,
    ...canelaNumeral,
  },

  // Roaster row — "By " plain + tappable name
  roasterRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
    overflow: "hidden",
  },
  roasterLabel: {
    fontFamily: t.font["body.regular"],
    fontSize: 10.9,
    color: t.color["text.secondary"],
  },
  roasterLinkPressable: {
    flexShrink: 1,
    overflow: "hidden",
  },

  // 1px line, #C7BAA5
  divider: {
    height: 1,
    backgroundColor: t.color.divider,
    marginTop: 7,
    marginBottom: 7,
  },

  // Bean type — Inter Regular 10.165px, #684F44
  beanTypeText: {
    fontFamily: t.font["body.regular"],
    fontSize: 10.2,
    color: t.color["text.secondary"],
  },

  // Inter Regular, 10.165px, #684F44
  detailText: {
    fontFamily: t.font["body.regular"],
    fontSize: 10.2,
    color: t.color["text.secondary"],
    ...canelaNumeral,
  },

  // Inter Regular, 10.165px, #684F44
  tastingText: {
    fontFamily: t.font["body.regular"],
    fontSize: 10.2,
    color: t.color["text.secondary"],
    lineHeight: 14.5,
    ...canelaNumeral,
  },

  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
  },

  // Canela Text Regular, 18.152px, #351101
  priceText: {
    fontFamily: t.font.display,
    fontSize: 18.2,
    color: t.color["text.primary"],
    ...canelaNumeral,
  },

  // Inter Regular, 10.165px, #351101
  weightText: {
    fontFamily: t.font["body.regular"],
    fontSize: 10.2,
    color: t.color["text.primary"],
    ...canelaNumeral,
  },
});
