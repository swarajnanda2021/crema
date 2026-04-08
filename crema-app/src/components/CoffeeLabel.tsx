/**
 * CoffeeLabel — A typographic specialty coffee label card
 * Inspired by physical roaster labels (Nāda Roastery style).
 *
 * Checkerboard border, kraft-paper background, serif title,
 * monospace info table, roaster footer. Fixed 300×340 dimensions.
 * No images — entirely typographic.
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

/** Format price with Indian locale comma separators */
function formatINR(n: number): string {
  if (!n || isNaN(n)) return "—";
  return n.toLocaleString("en-IN");
}

export default function CoffeeLabel({
  coffee_name,
  roast_level,
  tasting_notes,
  origin,
  process,
  varietal,
  price_inr,
  weight_grams,
  roaster_name,
}: CoffeeLabelProps) {
  const roastClean = roast_level && roast_level !== "Unknown" ? roast_level : null;
  const subtitle = [roastClean, process].filter(Boolean).join(" \u00B7 ");

  // Decide font size: if name is long, shrink
  const nameFontSize = useMemo(() => {
    if (!coffee_name) return 32;
    return coffee_name.length > 30 ? 26 : 32;
  }, [coffee_name]);

  const rows: [string, string][] = [
    ["ORIGIN", origin || "—"],
    ["ROAST", roastClean || "—"],
    ["PROCESS", process ? (varietal ? `${process} (${varietal})` : process) : "—"],
    ["TASTING", tasting_notes || "—"],
    ["PRICE", price_inr ? `\u20B9${formatINR(price_inr)} / ${weight_grams}g` : "—"],
  ];

  return (
    <View style={s.outerWrap}>
      {/* Checkerboard background — web only via CSS gradient */}
      {Platform.OS === "web" && (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            {
              borderRadius: 4,
              // @ts-ignore — web-only CSS property
              backgroundImage: "repeating-conic-gradient(#2a2a2a 0% 25%, #e8e0d0 0% 50%)",
              backgroundSize: "14px 14px",
            } as any,
          ]}
        />
      )}
      {/* Fallback checkerboard for native: solid dark border */}
      {Platform.OS !== "web" && (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: "#2a2a2a", borderRadius: 4 }]} />
      )}

      {/* Inner card */}
      <View style={s.innerCard}>
        {/* Inset decorative border */}
        <View style={s.insetBorder} />

        {/* Title area */}
        <View style={s.titleArea}>
          <Text
            style={[s.coffeeName, { fontSize: nameFontSize }]}
            numberOfLines={2}
          >
            {coffee_name}
          </Text>
          {subtitle ? (
            <Text style={s.subtitle}>{subtitle.toUpperCase()}</Text>
          ) : null}
        </View>

        {/* Info table */}
        <View style={s.table}>
          {rows.map(([label, value], i) => (
            <View
              key={label}
              style={[
                s.row,
                i === 0 && s.rowFirst,
                i === rows.length - 1 && s.rowLast,
              ]}
            >
              <Text style={s.cellLabel}>{label}</Text>
              <Text style={s.cellValue} numberOfLines={2}>{value}</Text>
            </View>
          ))}
        </View>

        {/* Footer — pushed to bottom */}
        <View style={s.footer}>
          <Text style={s.footerText}>Roaster: {roaster_name}</Text>
        </View>
      </View>
    </View>
  );
}

const MONO = Platform.select({
  web: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace",
  default: "monospace",
});

const s = StyleSheet.create({
  outerWrap: {
    width: 320,  // 300 + 2*10 padding
    height: 360, // 340 + 2*10 padding
    padding: 10,
    borderRadius: 4,
    overflow: "hidden",
  },
  innerCard: {
    width: 300,
    height: 340,
    backgroundColor: "#ece5d3",
    borderWidth: 2.5,
    borderColor: "#2a2a2a",
    borderRadius: 2,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 18,
    position: "relative",
  },
  insetBorder: {
    position: "absolute",
    top: 5,
    left: 5,
    right: 5,
    bottom: 5,
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },

  // Title
  titleArea: {
    minHeight: 80,
    justifyContent: "center",
  },
  coffeeName: {
    fontFamily: Platform.select({ web: "Georgia, serif", default: "serif" }),
    fontWeight: "700",
    letterSpacing: -1,
    color: "#2a2a2a",
    // 2-line clamp via numberOfLines={2} prop
  },
  subtitle: {
    fontFamily: MONO,
    fontSize: 12,
    letterSpacing: 2,
    color: "#2a2a2a",
    marginTop: 6,
  },

  // Table
  table: {
    flex: 1,
    marginTop: 16,
    marginHorizontal: 6,
  },
  row: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderColor: "#2a2a2a",
    paddingVertical: 5,
  },
  rowFirst: {},
  rowLast: {
    borderBottomWidth: 1,
    borderColor: "#2a2a2a",
  },
  cellLabel: {
    fontFamily: MONO,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    color: "#2a2a2a",
    width: 90,
  },
  cellValue: {
    fontFamily: MONO,
    fontSize: 12,
    color: "#2a2a2a",
    flex: 1,
  },

  // Footer — pushed to bottom by table's flex: 1
  footer: {
    paddingTop: 10,
    paddingHorizontal: 6,
  },
  footerText: {
    fontFamily: MONO,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
    color: "#2a2a2a",
  },
});
