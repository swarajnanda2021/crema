/**
 * CoffeeLabel — Compact typographic coffee label card.
 * Semi-transparent kraft paper so the product image shows through.
 */
import { View, Text, StyleSheet, Platform } from "react-native";
import { useMemo } from "react";

interface CoffeeLabelProps {
  coffee_name: string;
  roast_level: string;
  tasting_notes: string | null;
  origin: string | null;
  process: string | null;
  varietal: string | null;
  price_inr: number;
  weight_grams: number;
  roaster_name: string;
}

function formatINR(n: number): string {
  if (!n || isNaN(n)) return "\u2014";
  return n.toLocaleString("en-IN");
}

export default function CoffeeLabel({
  coffee_name, roast_level, tasting_notes, origin, process, varietal,
  price_inr, weight_grams, roaster_name,
}: CoffeeLabelProps) {
  const roastClean = roast_level && roast_level !== "Unknown" ? roast_level : null;
  const subtitle = [roastClean, process].filter(Boolean).join(" \u00B7 ");

  const nameFontSize = useMemo(() => {
    if (!coffee_name) return 22;
    return coffee_name.length > 28 ? 17 : 22;
  }, [coffee_name]);

  const rows: [string, string][] = [
    ["ORIGIN", origin || "\u2014"],
    ["ROAST", roastClean || "\u2014"],
    ["PROCESS", process ? (varietal ? `${process} (${varietal})` : process) : "\u2014"],
    ["TASTING", tasting_notes || "\u2014"],
  ];

  return (
    <View style={s.outerWrap}>
      {/* Checkerboard — web only */}
      {Platform.OS === "web" && (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            {
              borderRadius: 3,
              backgroundImage: "repeating-conic-gradient(#2a2a2a 0% 25%, rgba(236,229,211,0.85) 0% 50%)",
              backgroundSize: "10px 10px",
            } as any,
          ]}
        />
      )}
      {Platform.OS !== "web" && (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: "#2a2a2a", borderRadius: 3 }]} />
      )}

      {/* Inner card — semi-transparent so image bleeds through edges */}
      <View style={s.innerCard}>
        <View style={s.insetBorder} />

        {/* Title */}
        <View style={s.titleArea}>
          <Text style={[s.coffeeName, { fontSize: nameFontSize }]} numberOfLines={2}>
            {coffee_name}
          </Text>
          {subtitle ? <Text style={s.subtitle}>{subtitle.toUpperCase()}</Text> : null}
        </View>

        {/* Info table */}
        <View style={s.table}>
          {rows.map(([label, value], i) => (
            <View key={label} style={[s.row, i === rows.length - 1 && s.rowLast]}>
              <Text style={s.cellLabel}>{label}</Text>
              <Text style={s.cellValue} numberOfLines={1}>{value}</Text>
            </View>
          ))}
        </View>

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerText} numberOfLines={1}>{roaster_name}</Text>
        </View>
      </View>
    </View>
  );
}

const MONO = Platform.select({
  web: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  default: "monospace",
});

const s = StyleSheet.create({
  outerWrap: {
    width: 220,
    height: 260,
    padding: 7,
    borderRadius: 3,
    overflow: "hidden",
  },
  innerCard: {
    width: 206,
    height: 246,
    backgroundColor: "rgba(236, 229, 211, 0.88)",
    borderWidth: 2,
    borderColor: "#2a2a2a",
    borderRadius: 2,
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    position: "relative",
  },
  insetBorder: {
    position: "absolute",
    top: 4, left: 4, right: 4, bottom: 4,
    borderWidth: 1,
    borderColor: "rgba(42,42,42,0.5)",
  },
  titleArea: {
    minHeight: 50,
    justifyContent: "center",
  },
  coffeeName: {
    fontFamily: Platform.select({ web: "Georgia, serif", default: "serif" }),
    fontWeight: "700",
    letterSpacing: -0.5,
    color: "#2a2a2a",
  },
  subtitle: {
    fontFamily: MONO,
    fontSize: 9,
    letterSpacing: 1.5,
    color: "#2a2a2a",
    marginTop: 4,
  },
  table: {
    flex: 1,
    marginTop: 10,
    marginHorizontal: 3,
  },
  row: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderColor: "#2a2a2a",
    paddingVertical: 3,
  },
  rowLast: {
    borderBottomWidth: 1,
    borderColor: "#2a2a2a",
  },
  cellLabel: {
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    color: "#2a2a2a",
    width: 60,
  },
  cellValue: {
    fontFamily: MONO,
    fontSize: 9,
    color: "#2a2a2a",
    flex: 1,
  },
  footer: {
    paddingTop: 6,
    paddingHorizontal: 3,
  },
  footerText: {
    fontFamily: MONO,
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.3,
    color: "#2a2a2a",
  },
});
