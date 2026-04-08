/**
 * CoffeeLabel — Scalable typographic coffee label card.
 * Semi-transparent kraft paper overlay. Fills its parent container.
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
    if (!coffee_name) return 18;
    return coffee_name.length > 28 ? 14 : 18;
  }, [coffee_name]);

  const rows: [string, string][] = [
    ["ORIGIN", origin || "\u2014"],
    ["ROAST", roastClean || "\u2014"],
    ["PROCESS", process ? (varietal ? `${process} (${varietal})` : process) : "\u2014"],
    ["TASTING", tasting_notes || "\u2014"],
  ];

  return (
    /* Outer wrapper fills parent, has checkerboard border padding */
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

      {/* Inner card — fills remaining space after padding */}
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
  // Fills its parent — parent controls the size
  outerWrap: {
    flex: 1,
    padding: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  innerCard: {
    flex: 1,
    backgroundColor: "rgba(236, 229, 211, 0.88)",
    borderWidth: 1.5,
    borderColor: "#2a2a2a",
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
    position: "relative",
  },
  insetBorder: {
    position: "absolute",
    top: 3, left: 3, right: 3, bottom: 3,
    borderWidth: 0.5,
    borderColor: "rgba(42,42,42,0.4)",
  },
  titleArea: {
    minHeight: 40,
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
    fontSize: 8,
    letterSpacing: 1.2,
    color: "#2a2a2a",
    marginTop: 3,
  },
  table: {
    flex: 1,
    marginTop: 8,
    marginHorizontal: 2,
  },
  row: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderColor: "#2a2a2a",
    paddingVertical: 2.5,
  },
  rowLast: {
    borderBottomWidth: 1,
    borderColor: "#2a2a2a",
  },
  cellLabel: {
    fontFamily: MONO,
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "#2a2a2a",
    width: 52,
  },
  cellValue: {
    fontFamily: MONO,
    fontSize: 8,
    color: "#2a2a2a",
    flex: 1,
  },
  footer: {
    paddingTop: 5,
    paddingHorizontal: 2,
  },
  footerText: {
    fontFamily: MONO,
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.3,
    color: "#2a2a2a",
  },
});
