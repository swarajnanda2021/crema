/**
 * TastingNoteCard — a CoffeeCard variant for posts, showing four review bars
 * (Acidity, Body, Sweetness, Aftertaste) with crema pink progress fills,
 * plus coffee name, roaster, roast/process, and cart icon.
 *
 * Figma reference: node 306:4145 (281×371 base)
 * All dimensions scale responsively via `scale = width / BASE_W`.
 */

import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import * as Linking from "expo-linking";
import { t } from "../tokens/useTokens";
import { CartIcon } from "./icons/FigmaIcons";

const BASE_W = 281;
const BASE_H = 371;
const PAD_L = 27;
const TRACK_W = 232;

const REVIEW_FIELDS = ["Acidity", "Body", "Sweetness", "Aftertaste"] as const;

interface TastingNoteCardProps {
  coffee_name: string;
  roaster_name: string;
  roast_level?: string;
  process?: string;
  acidity: number;
  body: number;
  sweetness: number;
  aftertaste: number;
  product_url?: string;
  width?: number;
  height?: number;
}

function ReviewRow({
  label,
  score,
  trackWidth,
  s,
}: {
  label: string;
  score: number;
  trackWidth: number;
  s: number; // scale factor
}) {
  const fillW = (score / 5) * trackWidth;
  const dotSz = 5.2 * s;
  return (
    <View style={{ marginBottom: 13.7 * s }}>
      <View style={[styles.labelRow, { width: trackWidth }]}>
        <Text style={[styles.label, { fontSize: 14.648 * s }]}>{label}</Text>
        <Text style={[styles.score, { fontSize: 14.648 * s }]}>
          {String(score).padStart(2, "0")}
        </Text>
      </View>
      <View
        style={[
          styles.track,
          { width: trackWidth, height: 2.2 * s, borderRadius: 13 * s },
        ]}
      >
        <View
          style={[
            styles.trackFill,
            {
              width: fillW,
              height: 2.2 * s,
              borderTopLeftRadius: 7.4 * s,
              borderBottomLeftRadius: 7.4 * s,
            },
          ]}
        />
        <View
          style={[
            styles.trackDot,
            {
              width: dotSz,
              height: dotSz,
              borderRadius: dotSz / 2,
              left: Math.max(0, fillW - dotSz / 2),
              top: (2.2 * s - dotSz) / 2,
            },
          ]}
        />
      </View>
    </View>
  );
}

export default function TastingNoteCard({
  coffee_name,
  roaster_name,
  roast_level,
  process,
  acidity,
  body,
  sweetness,
  aftertaste,
  product_url,
  width = BASE_W,
  height = BASE_H,
}: TastingNoteCardProps) {
  const s = width / BASE_W;
  const trackW = TRACK_W * s;
  const scores = [acidity, body, sweetness, aftertaste];

  const lining =
    Platform.OS === "web"
      ? ({ fontFeatureSettings: "'lnum', 'pnum'" } as any)
      : {};

  const metaParts = [
    process ? `${process} Process` : null,
    roast_level ? `${roast_level} Roast` : null,
  ].filter(Boolean);
  const metaLine = metaParts.join(" • ");

  return (
    <View
      style={[
        styles.card,
        {
          width,
          height,
          borderRadius: 9.825 * s,
          paddingLeft: PAD_L * s,
          paddingRight: 22 * s,
          paddingTop: 26 * s,
          paddingBottom: 12 * s,
        },
      ]}
    >
      {/* "Tasting Notes" header */}
      <Text
        style={[styles.sectionLabel, { fontSize: 12 * s, marginBottom: 17 * s }]}
      >
        Tasting Notes
      </Text>

      {/* Four review rows */}
      {REVIEW_FIELDS.map((field, i) => (
        <ReviewRow
          key={field}
          label={field}
          score={scores[i]}
          trackWidth={trackW}
          s={s}
        />
      ))}

      {/* Spacer pushes coffee info to bottom */}
      <View style={{ flex: 1 }} />

      {/* Coffee name */}
      <Text
        style={[
          styles.coffeeName,
          lining,
          { fontSize: 24.4 * s, lineHeight: 31 * s },
        ]}
        numberOfLines={2}
      >
        {coffee_name}
      </Text>

      {/* By roaster */}
      <Text
        style={[styles.roasterText, lining, { fontSize: 12.079 * s, marginTop: 4 * s }]}
        numberOfLines={1}
      >
        By {roaster_name}
      </Text>

      {/* Process • Roast + Cart icon */}
      <View style={[styles.bottomRow, { marginTop: 4 * s }]}>
        {metaLine ? (
          <Text
            style={[styles.metaText, lining, { fontSize: 11.274 * s }]}
            numberOfLines={2}
          >
            {metaLine}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {product_url ? (
          <Pressable onPress={() => Linking.openURL(product_url)}>
            <CartIcon size={Math.round(44.36 * s)} />
          </Pressable>
        ) : (
          <CartIcon size={Math.round(44.36 * s)} />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "#EFE9DB",
    overflow: "hidden",
    justifyContent: "flex-start",
  } as any,

  sectionLabel: {
    fontFamily: t.font["body.medium"],
    color: "#A09580",
  },

  labelRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  } as any,

  label: {
    fontFamily: t.font["body.medium"],
    color: "#351101",
  },

  score: {
    fontFamily: t.font["body.medium"],
    color: "#351101",
    textAlign: "right",
  } as any,

  track: {
    backgroundColor: "rgba(215,209,196,0.4)",
    position: "relative",
  } as any,

  trackFill: {
    backgroundColor: "#D798DA",
    position: "absolute",
    left: 0,
    top: 0,
  } as any,

  trackDot: {
    backgroundColor: "#D798DA",
    position: "absolute",
  } as any,

  coffeeName: {
    fontFamily: t.font.display,
    color: "#351101",
  },

  roasterText: {
    fontFamily: t.font["body.regular"],
    color: "#684F44",
  },

  bottomRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  } as any,

  metaText: {
    fontFamily: t.font["body.regular"],
    color: "#684F44",
    flex: 1,
    marginRight: 8,
  },
});
