/**
 * CoffeeLabel — Info section for product card.
 * All values from Figma node 8:1615 at exact px sizes.
 */
import { View, Text, StyleSheet, Platform } from "react-native";
import { colors, fonts } from "../theme/colors";

const canelaNumeral = Platform.OS === "web"
  ? { fontFeatureSettings: "'lnum', 'pnum'" } as any
  : {};

interface CoffeeLabelProps {
  coffee_name: string;
  roast_level: string;
  tasting_notes: string | null;
  origin: string | null;
  process: string | null;
  varietal: string | null;
  altitude_masl: number | null;
  price_inr: number;
  weight_grams: number;
  roaster_name: string;
}

function formatINR(n: number): string {
  if (!n || isNaN(n)) return "\u2014";
  return "\u20B9" + n.toLocaleString("en-IN");
}

function CoffeeLabel({
  coffee_name, roast_level, tasting_notes, process,
  roaster_name,
}: CoffeeLabelProps) {
  const roastClean = roast_level && roast_level !== "Unknown" ? roast_level : null;
  const processClean = process || null;

  const roastProcessLine = [
    roastClean ? `${roastClean} Roast` : null,
    processClean ? `${processClean} Process` : null,
  ].filter(Boolean).join(" \u2022 ");

  return (
    <View style={s.container}>
      {/* Coffee name — Canela Text 22.722px */}
      <Text style={s.coffeeName} numberOfLines={2}>
        {coffee_name}
      </Text>

      {/* Roaster — Inter Regular 10.891px */}
      <Text style={s.roasterName} numberOfLines={1}>
        By {roaster_name}
      </Text>

      {/* Divider */}
      <View style={s.divider} />

      {/* Roast + Process — Inter Regular 10.165px */}
      {roastProcessLine ? (
        <>
          <Text style={s.detailText} numberOfLines={1}>{roastProcessLine}</Text>
          <View style={s.divider} />
        </>
      ) : null}

      {/* Tasting notes — Inter Regular 10.165px, lineHeight 14.521px */}
      {tasting_notes ? (
        <>
          <Text style={s.tastingText} numberOfLines={2}>{tasting_notes}</Text>
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

  // Inter Regular, 10.891px, #684F44
  roasterName: {
    fontFamily: fonts.bodyRegular,
    fontSize: 10.9,
    color: "#684F44",
    marginTop: 4,
  },

  // 1px line, #C7BAA5
  divider: {
    height: 1,
    backgroundColor: "#C7BAA5",
    marginTop: 7,
    marginBottom: 7,
  },

  // Inter Regular, 10.165px, #684F44
  detailText: {
    fontFamily: fonts.bodyRegular,
    fontSize: 10.2,
    color: "#684F44",
    ...canelaNumeral,
  },

  // Inter Regular, 10.165px, #684F44, lineHeight 14.521px
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
