/**
 * ArticleCard — chronological feed card for the Discover JOURNAL tab.
 *
 * Composes RoasterLogo + Image + body tokens. Reads everything from
 * `useTokens` per CRUD_UTOPIA Rule 4 — no inline hex, no inline
 * fontSize numbers, no per-component shadow composition.
 *
 * Visual peer: src/components/CoffeeCard.tsx (the bean grid card)
 * and src/components/domain/PostCard.tsx (the feed post). Hero
 * image fills the card width at a 16:9 aspect, title sits on top
 * of body copy, and a meta row pairs the roaster identity treatment
 * (RoasterLogo, rounded-square per DESIGN_LANGUAGE §4) with the
 * publish date + estimated reading time.
 *
 * Tap → /article/{id}. The reader screen hydrates synchronously
 * from RoasterArticlesProvider so navigation is instant.
 *
 * Image rendering uses thumbnailUrl(image_url, 800) so Shopify
 * CDN serves a 800-px-wide variant instead of the full-res hero
 * (the reader screen requests a larger variant).
 */

import { View, Text, Pressable, StyleSheet } from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";

import { t, makeStyles, cardShadow } from "../../tokens/useTokens";
import { thumbnailUrl } from "../../utils/imageUrl";
import { tap as hapticTap } from "../../utils/haptics";
import RoasterLogo from "../primitives/RoasterLogo";
import type { RoasterArticle } from "../../resources/types";

interface ArticleCardProps {
  article: RoasterArticle;
  /** Card width — feed list passes the resolved column width so the
   *  hero image can size correctly. Defaults to a sensible mobile
   *  fallback when omitted. */
  width?: number;
}

export default function ArticleCard({ article, width }: ArticleCardProps) {
  const router = useRouter();
  const s = useStyles();

  const cardWidth = width || 360;
  const heroHeight = Math.round(cardWidth * (9 / 16));
  const heroSrc = article.image_url
    ? thumbnailUrl(article.image_url, 800) || article.image_url
    : null;

  const dateLabel = formatPublishedDate(
    article.published_at || article.scraped_at,
  );
  const readingTime = estimateReadingTime(article.word_count);

  const onPress = () => {
    hapticTap();
    router.push(`/article/${article.id}` as any);
  };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.card,
        { width: cardWidth },
        pressed && s.cardPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={`Open article: ${article.title}`}
    >
      {/* ── Hero image ────────────────────────────────────────────── */}
      <View style={[s.hero, { height: heroHeight }]}>
        {heroSrc ? (
          <Image
            source={{ uri: heroSrc }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            transition={200}
          />
        ) : (
          <View style={s.heroFallback} />
        )}
      </View>

      {/* ── Body ──────────────────────────────────────────────────── */}
      <View style={s.body}>
        <Text style={s.title} numberOfLines={2}>
          {article.title}
        </Text>

        <View style={s.metaRow}>
          <RoasterLogo
            url={article.roaster_logo_url}
            size={24}
            fallbackInitial={article.roaster_name || article.roaster_slug}
          />
          <Text style={s.meta} numberOfLines={1}>
            {[
              article.roaster_name || article.roaster_slug,
              dateLabel,
              readingTime,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </View>

        {article.excerpt ? (
          <Text style={s.excerpt} numberOfLines={2}>
            {article.excerpt}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}


// ── Helpers ────────────────────────────────────────────────────────────────

/** "12 Apr 2026" / "Apr 2026" / "—". The roaster's published_at is
 *  the source of truth when present; we fall back to scraped_at so a
 *  malformed publish date doesn't strip the meta line. */
function formatPublishedDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const day = d.getDate();
  const month = d.toLocaleString("en-US", { month: "short" });
  return sameYear ? `${day} ${month}` : `${day} ${month} ${d.getFullYear()}`;
}

/** "4 min read" — only when word_count > 0. 200 wpm assumption. */
function estimateReadingTime(words: number | null | undefined): string {
  if (!words || words <= 0) return "";
  const minutes = Math.max(1, Math.round(words / 200));
  return `${minutes} min read`;
}


// ── Styles ─────────────────────────────────────────────────────────────────

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.lg,
    overflow: "hidden",
    ...cardShadow,
  } as any,
  cardPressed: { opacity: 0.92 },
  hero: {
    width: "100%" as any,
    backgroundColor: t.color["card.info"],
  } as any,
  heroFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: t.color["card.info"],
  } as any,
  body: {
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.lg,
    paddingBottom: t.spacing.lg,
    gap: t.spacing.md,
  } as any,
  title: {
    fontFamily: t.font.display,
    fontSize: t.size["font.xl"],
    lineHeight: 26,
    color: t.color["text.primary"],
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
  },
  meta: {
    flex: 1,
    minWidth: 0,
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
  } as any,
  excerpt: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    lineHeight: t.lineHeight.relaxed,
    color: t.color["text.secondary"],
  } as any,
}));
