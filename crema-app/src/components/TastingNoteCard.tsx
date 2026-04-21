/**
 * TastingNoteCard — a CoffeeCard variant for posts, showing four review bars
 * (Acidity, Body, Sweetness, Aftertaste) with crema pink progress fills,
 * plus coffee name, roaster, roast/process, and cart icon.
 *
 * Two layouts:
 *   - Portrait (default, Figma 306:4145 — 281×371 base): bars stacked
 *     vertically above the coffee info block. Used on wide web + in
 *     any column-oriented surface (feed card thumbnails on web).
 *   - Landscape (`landscape` prop, mirrors CoffeeCard landscape
 *     370×251 on mobile — same left-image / right-info split): bars
 *     occupy the left half, coffee info occupies the right half.
 *     Used for the mobile feed-post gallery so the tasting-note card
 *     matches the design language of the landscape CoffeeCard rows
 *     rendered one tab over (on the café / roaster page).
 *
 * All dimensions scale responsively via `scale = width / BASE`.
 */

import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { openExternal } from "../utils/openExternal";
import { t } from "../tokens/useTokens";
import { CartIcon } from "./icons/FigmaIcons";

const BASE_W = 281;
const BASE_H = 371;
const PAD_L = 27;
const TRACK_W = 232;

// Landscape base: matches CoffeeCard's landscape variant on mobile
// (Figma 66:6267 + 66:6268 — 370×251 frame with a ~180/190 split).
const LS_BASE_W = 370;
const LS_BASE_H = 251;
const LS_LEFT_W = 186;  // bars column
const LS_RIGHT_W = 184; // info column
const LS_PAD = 16;

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
  /** Render the landscape variant (mobile feed posts). Ignored when
   *  `width` is already smaller than 200 — portrait fits thumbnails
   *  better at that density. */
  landscape?: boolean;
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
  landscape,
}: TastingNoteCardProps) {
  const scores = [acidity, body, sweetness, aftertaste];

  if (landscape) {
    return (
      <LandscapeCard
        coffeeName={coffee_name}
        roasterName={roaster_name}
        roastLevel={roast_level}
        process={process}
        scores={scores}
        productUrl={product_url}
        width={width}
        height={height}
      />
    );
  }

  const s = width / BASE_W;
  const trackW = TRACK_W * s;

  // Canela lining + proportional numerals — OpenType feature string
  // on web, RN fontVariant prop on native.
  const lining =
    Platform.OS === "web"
      ? ({ fontFeatureSettings: "'lnum', 'pnum'" } as any)
      : ({ fontVariant: ["lining-nums", "proportional-nums"] } as any);

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
          <Pressable onPress={() => openExternal(product_url)}>
            <CartIcon size={Math.round(44.36 * s)} />
          </Pressable>
        ) : (
          <CartIcon size={Math.round(44.36 * s)} />
        )}
      </View>
    </View>
  );
}

/** Landscape variant (mobile, §postmodal-redo). Side-by-side layout
 *  matching the CoffeeCard landscape on the same breakpoint: bars on
 *  the left, coffee info on the right, cart pinned bottom-right. */
function LandscapeCard({
  coffeeName, roasterName, roastLevel, process: proc, scores,
  productUrl, width, height,
}: {
  coffeeName: string;
  roasterName: string;
  roastLevel?: string;
  process?: string;
  scores: number[];
  productUrl?: string;
  width: number;
  height: number;
}) {
  // Single uniform scale tied to the landscape base so typography +
  // track widths shrink together when the card lands in a narrow
  // column (e.g. a 340-wide feed card).
  const s = width / LS_BASE_W;
  // Split widths: 50/50 minus an 8 px gap for visual separation.
  const gap = 8 * s;
  const leftW = (width - gap) * (LS_LEFT_W / (LS_LEFT_W + LS_RIGHT_W));
  const rightW = (width - gap) * (LS_RIGHT_W / (LS_LEFT_W + LS_RIGHT_W));
  const padX = LS_PAD * s;
  const padY = 14 * s;
  const trackW = leftW - padX * 2;
  const rowGap = 8 * s;

  const lining =
    Platform.OS === "web"
      ? ({ fontFeatureSettings: "'lnum', 'pnum'" } as any)
      : ({ fontVariant: ["lining-nums", "proportional-nums"] } as any);

  const metaParts = [
    proc ? `${proc} Process` : null,
    roastLevel ? `${roastLevel} Roast` : null,
  ].filter(Boolean);
  const metaLine = metaParts.join(" • ");

  return (
    <View style={[styles.cardLs, { width, height, borderRadius: 10 * s }]}>
      {/* LEFT: tasting-note bars */}
      <View style={{ width: leftW, height, paddingHorizontal: padX, paddingVertical: padY }}>
        <Text style={[styles.sectionLabel, { fontSize: 11 * s, marginBottom: 10 * s }]}>
          Tasting Notes
        </Text>
        {REVIEW_FIELDS.map((field, i) => {
          const score = scores[i];
          const fillW = (score / 5) * trackW;
          const dotSz = 5.2 * s;
          return (
            <View key={field} style={{ marginBottom: rowGap }}>
              <View style={[styles.labelRow, { width: trackW, marginBottom: 3 * s }]}>
                <Text style={[styles.label, { fontSize: 11.5 * s }]}>{field}</Text>
                <Text style={[styles.score, { fontSize: 11.5 * s }]}>
                  {String(score).padStart(2, "0")}
                </Text>
              </View>
              <View style={[styles.track, { width: trackW, height: 2.2 * s, borderRadius: 13 * s }]}>
                <View style={[styles.trackFill, {
                  width: fillW,
                  height: 2.2 * s,
                  borderTopLeftRadius: 7.4 * s,
                  borderBottomLeftRadius: 7.4 * s,
                }]} />
                <View style={[styles.trackDot, {
                  width: dotSz, height: dotSz, borderRadius: dotSz / 2,
                  left: Math.max(0, fillW - dotSz / 2),
                  top: (2.2 * s - dotSz) / 2,
                }]} />
              </View>
            </View>
          );
        })}
      </View>

      {/* Vertical divider between columns — thin cream rule, same
         weight as the hoursRow divider pattern used elsewhere. */}
      <View style={[styles.lsDivider, { width: 1, height: height - padY * 2, top: padY }]} />

      {/* RIGHT: coffee info */}
      <View style={{ width: rightW, height, paddingHorizontal: padX, paddingVertical: padY, justifyContent: "space-between" }}>
        <View>
          <Text
            style={[styles.coffeeName, lining, { fontSize: 19 * s, lineHeight: 23 * s }]}
            numberOfLines={2}
          >
            {coffeeName}
          </Text>
          <Text
            style={[styles.roasterText, lining, { fontSize: 11 * s, marginTop: 4 * s }]}
            numberOfLines={1}
          >
            By {roasterName}
          </Text>
        </View>

        {metaLine ? (
          <Text
            style={[styles.metaText, lining, { fontSize: 10.5 * s, marginBottom: 6 * s, flex: 0, marginRight: 0 }]}
            numberOfLines={2}
          >
            {metaLine}
          </Text>
        ) : null}

        <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
          {productUrl ? (
            <Pressable onPress={() => openExternal(productUrl)} hitSlop={6}>
              <CartIcon size={Math.round(36 * s)} />
            </Pressable>
          ) : (
            <CartIcon size={Math.round(36 * s)} />
          )}
        </View>
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
  cardLs: {
    backgroundColor: "#EFE9DB",
    flexDirection: "row",
    overflow: "hidden",
    position: "relative",
  } as any,
  lsDivider: {
    position: "absolute" as any,
    left: "50%" as any,
    backgroundColor: "rgba(53,17,1,0.08)",
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
