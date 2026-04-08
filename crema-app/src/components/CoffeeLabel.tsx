/**
 * CoffeeLabel — Scalable typographic coffee label card.
 * Semi-transparent kraft paper overlay. Fills its parent container.
 *
 * Layout:
 *   Coffee Name (title)
 *   Origin (subtitle)
 *   ─────────────────
 *   ROAST     Medium
 *   PROCESS   Washed (Catuai)
 *   ALTITUDE  1,340 m.a.s.l.
 *   COST      ₹938 / 250g
 *   TASTING   Citrus, Chocolate,
 *             Nut, Cacao...
 *   ─────────────────
 *   Roaster Name
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
  altitude_masl: number | null;
  price_inr: number;
  weight_grams: number;
  roaster_name: string;
}

function formatINR(n: number): string {
  if (!n || isNaN(n)) return "\u2014";
  return "\u20B9" + n.toLocaleString("en-IN");
}

export default function CoffeeLabel({
  coffee_name, roast_level, tasting_notes, origin, process, varietal,
  altitude_masl, price_inr, weight_grams, roaster_name,
}: CoffeeLabelProps) {
  const roastClean = roast_level && roast_level !== "Unknown" ? roast_level : null;

  const nameFontSize = useMemo(() => {
    if (!coffee_name) return 18;
    return coffee_name.length > 28 ? 14 : 18;
  }, [coffee_name]);

  const processDisplay = process
    ? (varietal ? `${process} (${varietal})` : process)
    : "\u2014";

  const costDisplay = price_inr
    ? `${formatINR(price_inr)} / ${weight_grams}g`
    : "\u2014";

  return (
    <View style={s.outerWrap}>
      {/* Checkerboard border */}
      {Platform.OS === "web" && (
        <View
          style={[
            StyleSheet.absoluteFillObject,
            {
              borderRadius: 3,
              opacity: 0.8,
              backgroundImage: "repeating-conic-gradient(rgba(42,42,42,0.9) 0% 25%, rgba(236,229,211,0.75) 0% 50%)",
              backgroundSize: "10px 10px",
            } as any,
          ]}
        />
      )}
      {Platform.OS !== "web" && (
        <View style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(42,42,42,0.8)", borderRadius: 3 }]} />
      )}

      <View style={s.innerCard}>
        <View style={s.insetBorder} />

        {/* Title: Coffee Name */}
        <Text style={[s.coffeeName, { fontSize: nameFontSize }]} numberOfLines={2}>
          {coffee_name}
        </Text>

        {/* Subtitle: Origin */}
        <Text style={s.originSubtitle} numberOfLines={2}>
          {origin ? origin.toUpperCase() : "\u2014"}
        </Text>

        {/* Info table: ROAST, PROCESS, ALTITUDE, COST — single line each */}
        <View style={s.table}>
          <Row label="ROAST" value={roastClean || "\u2014"} />
          <Row label="PROCESS" value={processDisplay} />
          <Row label="ALTITUDE" value={altitude_masl ? `${altitude_masl.toLocaleString()} m.a.s.l.` : "\u2014"} />
          <Row label="COST" value={costDisplay} />

          {/* TASTING — gets remaining space, 2-3 lines */}
          <View style={[s.row, s.rowLast, { flex: 1 }]}>
            <Text style={s.cellLabel}>TASTING</Text>
            <Text style={s.cellValueWrap} numberOfLines={3}>
              {tasting_notes || "\u2014"}
            </Text>
          </View>
        </View>

        {/* Footer: Roaster name — larger */}
        <View style={s.footer}>
          <Text style={s.footerText} numberOfLines={1}>{roaster_name}</Text>
        </View>
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={s.row}>
      <Text style={s.cellLabel}>{label}</Text>
      <Text style={s.cellValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const MONO = Platform.select({
  web: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
  default: "monospace",
});

const s = StyleSheet.create({
  outerWrap: {
    flex: 1,
    padding: 6,
    borderRadius: 3,
    overflow: "hidden",
  },
  innerCard: {
    flex: 1,
    backgroundColor: "#ece5d3",
    borderWidth: 1.5,
    borderColor: "#2a2a2a",
    borderRadius: 2,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 6,
    position: "relative",
  },
  insetBorder: {
    position: "absolute",
    top: 3, left: 3, right: 3, bottom: 3,
    borderWidth: 0.5,
    borderColor: "rgba(42,42,42,0.4)",
  },

  // Title
  coffeeName: {
    fontFamily: Platform.select({ web: "Georgia, serif", default: "serif" }),
    fontWeight: "700",
    letterSpacing: -0.5,
    color: "#2a2a2a",
  },

  // Subtitle — origin
  originSubtitle: {
    fontFamily: MONO,
    fontSize: 8,
    letterSpacing: 1.2,
    color: "#2a2a2a",
    marginTop: 2,
    marginBottom: 6,
  },

  // Table
  table: {
    flex: 1,
    marginHorizontal: 2,
  },
  row: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderColor: "#2a2a2a",
    paddingVertical: 2,
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
    width: 55,
  },
  cellValue: {
    fontFamily: MONO,
    fontSize: 8,
    color: "#2a2a2a",
    flex: 1,
  },
  // Tasting value — wraps to 2-3 lines
  cellValueWrap: {
    fontFamily: MONO,
    fontSize: 8,
    color: "#2a2a2a",
    flex: 1,
    lineHeight: 12,
  },

  // Footer — roaster name, larger
  footer: {
    paddingTop: 4,
    paddingHorizontal: 2,
  },
  footerText: {
    fontFamily: MONO,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.3,
    color: "#2a2a2a",
  },
});
