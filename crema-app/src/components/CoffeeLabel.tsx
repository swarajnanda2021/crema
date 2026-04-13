/**
 * CoffeeLabel — Info section for product card.
 * All values from Figma node 8:1615 at exact px sizes.
 */
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { useRouter } from "expo-router";
import { fonts } from "../tokens/useTokens";

const canelaNumeral = Platform.OS === "web"
  ? { fontFeatureSettings: "'lnum', 'pnum'" } as any
  : {};

interface CoffeeLabelProps {
  coffee_name: string;
  roast_level: string;
  tasting_notes: string | null;
  flavor_notes: string[] | null;
  origin: string | null;
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

const BAD_ESTATE_PREFIX = /^(and|our|both|this|single|the|sourced|grown|washed|from|at|a|all)\b/i;
function extractEstate(origin: string | null): string | null {
  if (!origin) return null;
  const t = origin.trim();
  if (!/\s+Estates?$/i.test(t)) return null;
  if (BAD_ESTATE_PREFIX.test(t)) return null;
  if (t.split(/\s+/).length > 5) return null;
  return t;
}

function CoffeeLabel({
  coffee_name, roast_level, tasting_notes, flavor_notes, process,
  roaster_name, roaster_slug, bean_type, origin,
}: CoffeeLabelProps) {
  const router = useRouter();
  const roastClean = roast_level && roast_level !== "Unknown" ? roast_level : null;
  const processClean = process || null;

  const estate = extractEstate(origin);
  const displayName = estate || coffee_name;

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
    fontFamily: fonts.displayRegular,
    fontSize: 22.7,
    color: "#351101",
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
    fontFamily: fonts.bodyRegular,
    fontSize: 10.9,
    color: "#684F44",
  },
  roasterLinkPressable: {
    flexShrink: 1,
    overflow: "hidden",
  },

  // 1px line, #C7BAA5
  divider: {
    height: 1,
    backgroundColor: "#C7BAA5",
    marginTop: 7,
    marginBottom: 7,
  },

  // Bean type — Inter Regular 10.165px, #684F44
  beanTypeText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 10.2,
    color: "#684F44",
  },

  // Inter Regular, 10.165px, #684F44
  detailText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 10.2,
    color: "#684F44",
    ...canelaNumeral,
  },

  // Inter Regular, 10.165px, #684F44
  tastingText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 10.2,
    color: "#684F44",
    lineHeight: 14.5,
    ...canelaNumeral,
  },

  priceRow: {
    flexDirection: "row",
    alignItems: "baseline",
  },

  // Canela Text Regular, 18.152px, #351101
  priceText: {
    fontFamily: fonts.displayRegular,
    fontSize: 18.2,
    color: "#351101",
    ...canelaNumeral,
  },

  // Inter Regular, 10.165px, #351101
  weightText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 10.2,
    color: "#351101",
    ...canelaNumeral,
  },
});
