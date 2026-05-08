/**
 * ArticlePreviewCard — the canonical card for any URL/article preview
 * in the app. Used by:
 *
 *   • PostCard (post_type === "article") — feed posts that share an
 *     external URL with title + domain + hero.
 *   • ArticleCard (Discover JOURNALS feed) — the standalone article
 *     row with the same data shape.
 *
 * Visual spec: Figma 801:155 (frame 350×260). Every numeric value
 * below is the LITERAL Figma value per CLAUDE.md "Hard rule —
 * Figma is literal" — we hit this card twice with token-ladder
 * approximations and the user flagged the result both times.
 *
 *   • Outer card: 350×260, bg white, borderRadius 5, shadow
 *     `0px 5px 5px 0px rgba(53,17,1,0.02)` (very subtle).
 *   • Title (801:157): "New Spirit Medium" at 18 / 25
 *     line-height, colour Espresso (#351101). The Medium weight
 *     is requested as `fontWeight: "500"` — see the missing-asset
 *     note below.
 *   • Domain (801:159): Inter Regular at 11 / ~17 line-height,
 *     colour Gray-Brown (#A09580 = `text.muted` light).
 *   • Hero (801:158): 330×162 (aspect 2.04), borderRadius 5,
 *     positioned 10 from card's left/right edges (NOT 16 like the
 *     text column — the hero is intentionally wider than the
 *     title's text column).
 *
 * Card-staying-light: the article preview reads as a content card
 * regardless of the active mode (the article reader page itself is
 * also white). Bg uses `card.product.bg` (constant cream/white)
 * rather than `card.front` (which flips to `#2a0d00` in dark mode).
 * Title color uses `card.product.text` (constant Espresso) so it
 * reads on the constant-cream card.
 *
 * Missing asset — NewSpirit-Medium.otf: the Figma asks for "New
 * Spirit Medium" but `assets/fonts/` only ships the Regular variant
 * (`NewSpiritTRIAL-Regular.otf`). The title is rendered with
 * `fontFamily: t.font.display` + `fontWeight: "500"` so iOS / web
 * synthesise a medium-ish weight from the loaded Regular face.
 * For exact spec match the designer would need to provide the
 * Medium .otf and we'd load it in `app/_layout.tsx`'s `useFonts`.
 *
 * The card fills its parent's width — callers control sizing via
 * the surrounding column. Hero height is derived from the 330/162
 * aspect ratio so it scales with width without extra layout math.
 *
 * Props are intentionally minimal: no roaster/author identity here
 * — that context belongs to the surrounding `PostCard` author row
 * (in the feed) or to the `JOURNALS` rail (which already shows the
 * roaster identity via its strip).
 */

import { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";

import { t, makeStyles } from "../../tokens/useTokens";
import { resolveUploadUrl } from "../../api/client";
import { thumbnailUrl } from "../../utils/imageUrl";
import { tap as hapticTap } from "../../utils/haptics";

interface ArticlePreviewCardProps {
  title: string | null | undefined;
  /** External URL — used to extract the parent domain ("sprudge.com"). */
  sourceUrl: string | null | undefined;
  /** Hero image URL (Shopify CDN, /uploads/, etc.). Optional — when
   *  missing the hero block is hidden and the card collapses to
   *  title + domain only. */
  imageUrl: string | null | undefined;
  onPress: () => void;
  /** Override the press handler's haptic (defaults to `tap`). Pass
   *  `null` to skip haptics entirely. */
  haptic?: "tap" | null;
  /** Accessibility label override; defaults to "Open article: {title}". */
  accessibilityLabel?: string;
}

export default function ArticlePreviewCard({
  title,
  sourceUrl,
  imageUrl,
  onPress,
  haptic = "tap",
  accessibilityLabel,
}: ArticlePreviewCardProps) {
  const s = useStyles();

  const heroSrc = imageUrl
    ? (() => {
        const resolved = resolveUploadUrl(imageUrl) || imageUrl;
        return thumbnailUrl(resolved, 800) || resolved;
      })()
    : null;

  // Hero is suppressed when the URL has no thumbnail at all
  // (heroSrc null) AND when the URL is set but the image actually
  // fails to load — without `imageFailed`, an invalid / 404'd
  // hero left a cream `card.info` placeholder where the image
  // should be, which read as a "blank thumbnail" to the user.
  // `key={heroSrc}` reset is unnecessary because the effect below
  // re-clears the failure flag whenever the URL changes.
  const [imageFailed, setImageFailed] = useState(false);
  useEffect(() => {
    setImageFailed(false);
  }, [heroSrc]);
  const showHero = !!heroSrc && !imageFailed;

  const domain = extractDomain(sourceUrl);

  const handlePress = () => {
    if (haptic === "tap") hapticTap();
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      style={({ pressed }) => [s.card, pressed && s.cardPressed]}
      accessibilityRole="button"
      accessibilityLabel={
        accessibilityLabel || (title ? `Open article: ${title}` : "Open article")
      }
    >
      <View style={s.textWrap}>
        {title ? (
          <Text style={s.title} numberOfLines={2}>
            {title}
          </Text>
        ) : null}
        {domain ? (
          <Text style={s.domain} numberOfLines={1}>
            {domain}
          </Text>
        ) : null}
      </View>

      {showHero ? (
        <View style={s.hero}>
          <Image
            source={{ uri: heroSrc! }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            transition={200}
            onError={() => setImageFailed(true)}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

/** Extract the parent domain from a URL — e.g. "sprudge.com" from
 *  "https://www.sprudge.com/2024/coffee-india.html". Returns null
 *  when the URL is unparseable so the caller can hide the line. */
function extractDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    // Fallback for malformed URLs — strip protocol + www, take the
    // first path segment.
    const stripped = url.replace(/^https?:\/\//, "").replace(/^www\./, "");
    const host = stripped.split("/")[0];
    return host || null;
  }
}

// ── Styles ─────────────────────────────────────────────────────────────────

const useStyles = makeStyles((t) => ({
  // Numeric values below are LITERAL to Figma 801:156 — see the
  // file header. Off-ladder by design (radius 5 isn't on the
  // ladder; paddingLeft 10 isn't on the ladder; etc.) per
  // CLAUDE.md "Hard rule — Figma is literal".
  //
  // Layout: card paddingHorizontal sits at 10 (= the hero's
  // inset from the card's outer edge per Figma). The text column
  // adds another 6 px via `textWrap` to reach the Figma's 16-px
  // text inset. Card paddingTop 12 + title height + domain
  // height + 8 px gap + hero (162) + paddingBottom 11 = 260.
  card: {
    backgroundColor: t.color["card.product.bg"],
    borderRadius: 5,
    paddingTop: 12,
    paddingBottom: 11,
    paddingHorizontal: 10,
    overflow: "hidden",
    shadowColor: t.color.shadow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.02,
    shadowRadius: 5,
    elevation: 1,
  } as any,
  cardPressed: { opacity: 0.92 },
  // Title + domain column. Extra horizontal padding so the text
  // sits at the Figma's 16-px inset (card pad 10 + textWrap pad
  // 6 = 16). marginBottom 8 = the gap from text-block bottom to
  // hero top per Figma.
  textWrap: {
    paddingHorizontal: 6,
    marginBottom: 8,
  },
  title: {
    fontFamily: t.font.display,
    // Figma asks for "New Spirit Medium" (weight 500). The
    // project ships only NewSpiritTRIAL-Regular.otf, so the
    // Medium is synthesised via fontWeight: "500" — see the
    // file-header note about the missing asset.
    fontWeight: "500",
    fontSize: 18,
    lineHeight: 25,
    color: t.color["card.product.text"],
  } as any,
  domain: {
    fontFamily: t.font["body.regular"],
    fontWeight: "400",
    fontSize: 11,
    lineHeight: 17,
    color: t.color["text.muted"],
  } as any,
  // Inner hero card. AspectRatio derived from Figma 330×162 so
  // the hero scales with the card's width without manual sizing.
  // Background uses `card.product.bg` (constant cream/white in
  // both modes) rather than `card.info` (which flips to the
  // dark page body in dark mode). Without this, transparent PNG
  // hero images — common for roaster wordmarks / brand-mark
  // hero crops — composited their alpha onto a dark surface in
  // dark mode and read as "site-colored," not white. Same
  // reasoning that drove the card body's bg in §2.40.21:
  // article-preview surfaces stay light in both modes.
  hero: {
    width: "100%" as any,
    aspectRatio: 330 / 162,
    backgroundColor: t.color["card.product.bg"],
    borderRadius: 5,
    overflow: "hidden",
  } as any,
}));
