/**
 * Article reader — full-page renderer for a roaster's blog/journal
 * article. Hydrates synchronously from RoasterArticlesProvider's
 * cache (every field except body_html), then silent-revalidates via
 * `/articles/{id}` so the body_html slots in a tick later.
 *
 * Layout:
 *   • Floating back FAB (text.primary fill, on-cta icon — same
 *     pattern as the consumer roaster page hero back button).
 *   • Hero image (full-width, 16:9 on mobile).
 *   • Title (display, font.display).
 *   • Roaster row — RoasterLogo + name → tap routes to
 *     /roaster/{slug}; meta line (date · reading time).
 *   • Body — htmlToBlocks() produces a flat list of native blocks
 *     (heading, paragraph, list, image, quote, hr) rendered with
 *     token-driven styles.
 *   • Bottom CTA — "Read the original on [domain]" → openExternal,
 *     tracked via /clicks with source_page='article'. The escape
 *     hatch when the in-app renderer drops markup it doesn't know.
 *
 * Tap the roaster identity row → /roaster/{slug}. The back FAB
 * routes to history when canGoBack() else replaces to JOURNAL.
 */

import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, ExternalLink } from "lucide-react-native";

import { t, makeStyles } from "../../src/tokens/useTokens";
import { useRoasterArticles } from "../../src/hooks/useRoasterArticles";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useBreakpoint } from "../../src/hooks/useBreakpoint";
import { apiFetchRaw, resolveUploadUrl, trackClick } from "../../src/api/client";
import { thumbnailUrl } from "../../src/utils/imageUrl";
import { openExternal } from "../../src/utils/openExternal";
import { tap as hapticTap } from "../../src/utils/haptics";
import { htmlToBlocks } from "../../src/utils/htmlToBlocks";
import { onChromeScroll } from "../../src/utils/chromeScroll";
import RoasterLogo from "../../src/components/primitives/RoasterLogo";
import SiteHeader from "../../src/components/SiteHeader";
import CoffeeCard, {
  CARD_TARGET_WIDTH,
  coffeeCardHeight,
} from "../../src/components/CoffeeCard";
import ActionBar from "../../src/components/primitives/ActionBar";
import CommentThread from "../../src/components/primitives/CommentThread";
import { openPostModal } from "../../src/components/primitives";
import { useAuth } from "../../src/hooks/useAuth";
import { articleShareUrl } from "../../src/utils/articleShare";
import type { RoasterArticle } from "../../src/resources/types";

export default function ArticlePage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const { isMobile } = useBreakpoint();
  const cache = useRoasterArticles();
  const { products } = useCoffeeData();
  const { user } = useAuth();
  const s = useStyles();

  const idNum = id ? Number(id) : NaN;
  const cached = cache.getById(idNum);
  // Local state for the full payload (with body_html). Falls back to
  // the cached row's body_html if it's already present (e.g. user
  // reopened the same article from the cache after a /articles/{id}
  // fetch).
  const [full, setFull] = useState<RoasterArticle | null>(
    cached && cached.body_html ? cached : null,
  );
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!Number.isFinite(idNum)) {
      setError("Invalid article id");
      return;
    }
    if (full && full.body_html) return; // already have everything

    setFetching(true);
    apiFetchRaw<RoasterArticle>(`/articles/${idNum}`)
      .then((res: any) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        if (data && data.id != null) {
          setFull(data as RoasterArticle);
          // Merge back into the sitewide cache so other views see the
          // body_html without their own round-trip.
          cache.upsert(data as RoasterArticle);
        } else {
          setError("Article not found");
        }
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message || "Failed to load article");
      })
      .finally(() => {
        if (!cancelled) setFetching(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idNum]);

  // Article shape rendered: full payload preferred, cached stub as
  // fallback. The cached stub doesn't carry body_html (the list
  // endpoint excludes it for payload size).
  const article = full || cached;

  const heroSrc = useMemo(() => {
    if (!article?.image_url) return null;
    const w = isMobile ? 1080 : 1600;
    // Local /uploads/articles/<...>.webp paths need the API origin
    // prepended; absolute URLs (Shopify CDN, etc.) pass through.
    const resolved = resolveUploadUrl(article.image_url) || article.image_url;
    return thumbnailUrl(resolved, w) || resolved;
  }, [article?.image_url, isMobile]);

  const heroHeight = isMobile
    ? Math.round(width * (9 / 16))
    : Math.min(540, Math.round(width * 0.4));

  const blocks = useMemo(
    () => (article?.body_html ? htmlToBlocks(article.body_html) : []),
    [article?.body_html],
  );

  // Bottom-of-article carousel: this roaster's available products.
  // Source = the same `useCoffeeData` cache the rest of the app reads,
  // so no per-article fetch is needed and the carousel paints in the
  // same frame as the body. Cap at 12 — beyond that the user is
  // browsing, not buying-from-this-article.
  const roasterCoffees = useMemo(() => {
    const slug = article?.roaster_slug;
    if (!slug || !products?.length) return [];
    return (products as any[])
      .filter((p) => p.roaster_slug === slug && p.available !== 0)
      .slice(0, 12);
  }, [article?.roaster_slug, products]);

  const goBack = () => {
    hapticTap();
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/browse?tab=journal" as any);
  };

  const openOriginal = () => {
    if (!article?.url) return;
    // Track as a click event on the click_events table — articles
    // don't have a product_id, so we synthesize one from the article
    // id ("article:42"). The traction dashboard already buckets by
    // source_page, so 'article' is the lens that surfaces journal
    // engagement separately from card / coffee-page clicks.
    trackClick(`article:${article.id}`, article.roaster_slug, "article");
    openExternal(article.url);
  };

  const goToRoaster = () => {
    if (!article?.roaster_slug) return;
    hapticTap();
    router.push(`/roaster/${article.roaster_slug}` as any);
  };

  if (!article) {
    // No cached row + first fetch in flight. Render the SiteHeader
    // anyway so chrome stays consistent across the loading hop.
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <SiteHeader />
        <View style={s.fullCenter}>
          {error ? (
            <Text style={s.errorText}>{error}</Text>
          ) : (
            <ActivityIndicator size="small" color={t.color["text.primary"]} />
          )}
        </View>
      </>
    );
  }

  const dateLabel = formatDate(article.published_at || article.scraped_at);
  const readingTime = estimateReadingTime(article.word_count);
  const externalDomain = safeDomain(article.url);

  return (
    <>
      {/* Override the layout's `headerShown: false` so the SiteHeader
         (mobile MobileHeader / web Navbar) renders above the page —
         consistent with /coffee/[id], /roaster/[slug], /user/[username].
         The MobileFooter renders globally inside the root layout, so
         the bottom tab bar is already in place. */}
      <Stack.Screen options={{ headerShown: false }} />
      <SiteHeader />
      <ScrollView
        style={s.page}
        contentContainerStyle={{ paddingBottom: 64 }}
        showsVerticalScrollIndicator={false}
        // Sitewide scroll-aware chrome — header collapses on
        // scroll-down, expands on scroll-up. Same pattern Discover
        // BEANS, the feed, and every other long-scroll surface
        // share via onChromeScroll.
        onScroll={onChromeScroll}
        scrollEventThrottle={16}
      >
      {/* Hero with floating back FAB */}
      <View style={[s.heroWrap, { height: heroHeight }]}>
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
        <Pressable
          onPress={goBack}
          style={s.backFloating}
          accessibilityLabel="Back"
          hitSlop={8}
        >
          <ArrowLeft
            size={18}
            color={t.color["text.on-cta"]}
            strokeWidth={2}
          />
        </Pressable>
      </View>

      {/* Body column — capped width on wide viewports for readability. */}
      <View style={[s.bodyColumn, { maxWidth: 720 }]}>
        <Text style={s.title}>{article.title}</Text>

        <Pressable
          onPress={goToRoaster}
          style={({ pressed }) => [s.metaRow, pressed && { opacity: 0.7 }]}
          accessibilityRole="link"
          accessibilityLabel={`Open ${article.roaster_name || article.roaster_slug}'s page`}
        >
          <RoasterLogo
            url={article.roaster_logo_url}
            size={32}
            fallbackInitial={article.roaster_name || article.roaster_slug}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={s.metaName} numberOfLines={1}>
              {article.roaster_name || article.roaster_slug}
            </Text>
            <Text style={s.metaSub} numberOfLines={1}>
              {[dateLabel, readingTime].filter(Boolean).join(" · ")}
            </Text>
          </View>
        </Pressable>

        {/* Body blocks. Empty while body_html is in flight; the
            cached stub still gives us hero + meta. */}
        {fetching && !article.body_html ? (
          <View style={s.bodySpinner}>
            <ActivityIndicator
              size="small"
              color={t.color["text.primary"]}
            />
          </View>
        ) : (
          <View style={s.blocks}>
            {blocks.map((block, idx) => (
              <RenderedBlock
                key={`${block.kind}-${idx}`}
                block={block}
                pageWidth={width}
              />
            ))}
            {blocks.length === 0 && article.excerpt ? (
              // Body extraction came back empty but we have an
              // og:description excerpt — render that as a single
              // paragraph so the page isn't blank, then the bottom
              // CTA carries the user to the original.
              <Text style={s.paragraph}>{article.excerpt}</Text>
            ) : null}
          </View>
        )}

        {/* "More from {roaster}" — closes the loop from sourcing-
            story content to a buy-the-bean intent. Per DESIGN_LANGUAGE
            §7: horizontal carousel on every viewport. Mobile cards
            size up to ~Figma's 370-wide landscape so the variant has
            room to render cleanly (left a 60px gutter for the peek
            of the next card cuing scroll); wide cards stay at the
            canonical 240-wide portrait. coffeeCardHeight() picks the
            right aspect by viewport. */}
        {roasterCoffees.length > 0 ? (
          <View style={s.coffeeRailWrap}>
            <Text style={s.coffeeRailTitle}>
              More from {article.roaster_name || article.roaster_slug}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{ gap: 16, paddingRight: 16 }}
            >
              {roasterCoffees.map((c: any) => {
                // Match Discover BEANS cell dims exactly (CoffeeList
                // grid math): mobile = viewport - 32 (1-col edge-to-
                // edge minus GRID_PAD), wide = CARD_TARGET_WIDTH.
                const cardW = isMobile ? width - 32 : CARD_TARGET_WIDTH;
                const cardH = coffeeCardHeight(cardW, isMobile);
                return (
                  <View
                    key={c.product_id}
                    style={{ width: cardW, height: cardH }}
                  >
                    <CoffeeCard coffee={c} width={cardW} height={cardH} />
                  </View>
                );
              })}
            </ScrollView>
          </View>
        ) : null}

        {/* Read-on-original CTA. Always visible — even when the
            in-app body rendered cleanly, the original page often
            has video / interactive content the renderer skipped. */}
        {article.url ? (
          <Pressable
            onPress={openOriginal}
            style={({ pressed }) => [
              s.externalCta,
              pressed && s.externalCtaPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Read the original on ${externalDomain || "the roaster's site"}`}
          >
            <ExternalLink
              size={t.size["icon.sm"]}
              color={t.color["text.on-cta"]}
              strokeWidth={2}
            />
            <Text style={s.externalCtaLabel}>
              Read the original
              {externalDomain ? ` on ${externalDomain}` : ""}
            </Text>
          </Pressable>
        ) : null}

        {/* Engagement — like / comment / repost / share. Action bar
            and comment thread sit at the bottom of the reader, after
            the body + "More from this roaster" carousel + "Read the
            original" CTA. Spacing mirrors the JOURNALS row spec:
            single hairline divider above, then the bar inset to the
            content column, then the comment thread.

            The share URL is the canonical
            `https://crema.app/article/{id}` pattern that
            `<ThreadBody>` unfurls into an `<ArticlePreviewCard>`
            inside chat bubbles. Anonymous viewers still see counts;
            the toggle / comment / repost actions surface the
            AuthGate when triggered. */}
        <View style={s.engagementBarWrap}>
          <ActionBar
            likeResource="article_likes"
            targetId={article.id}
            likeCount={article.like_count ?? 0}
            commentCount={article.comment_count ?? 0}
            repostCount={article.repost_count ?? 0}
            likedByMe={!!article.liked_by_me}
            shareUrl={articleShareUrl(article.id)}
            onComment={() => hapticTap()}
            onRepost={() => {
              hapticTap();
              openPostModal({ article, mode: "repost" });
            }}
          />
        </View>
        <View style={s.engagementThreadWrap}>
          <CommentThread
            resource="article_comments"
            likeResource="article_comment_likes"
            parentResource="articles"
            parentId={article.id}
            user={user}
          />
        </View>
      </View>
      </ScrollView>
    </>
  );
}


// ── Block renderer ─────────────────────────────────────────────────────────

function RenderedBlock({
  block,
  pageWidth,
}: {
  block: ReturnType<typeof htmlToBlocks>[number];
  pageWidth: number;
}) {
  const s = useStyles();
  if (block.kind === "paragraph") {
    return <Text style={s.paragraph}>{block.text}</Text>;
  }
  if (block.kind === "heading") {
    const styleByLevel: Record<number, any> = {
      1: s.h1,
      2: s.h2,
      3: s.h3,
      4: s.h4,
      5: s.h4,
      6: s.h4,
    };
    return <Text style={styleByLevel[block.level]}>{block.text}</Text>;
  }
  if (block.kind === "quote") {
    return (
      <View style={s.quoteWrap}>
        <Text style={s.quote}>{block.text}</Text>
      </View>
    );
  }
  if (block.kind === "list") {
    return (
      <View style={s.listWrap}>
        {block.items.map((item, i) => (
          <View key={i} style={s.listItemRow}>
            <Text style={s.listMarker}>
              {block.ordered ? `${i + 1}.` : "·"}
            </Text>
            <Text style={s.listItem}>{item}</Text>
          </View>
        ))}
      </View>
    );
  }
  if (block.kind === "image") {
    const maxImgW = Math.min(720, pageWidth - 32);
    const sized = thumbnailUrl(block.src, 1200) || block.src;
    return (
      <View style={[s.imageBlock, { width: maxImgW }]}>
        <Image
          source={{ uri: sized }}
          style={[s.image, { width: maxImgW, height: maxImgW * 0.62 }]}
          contentFit="cover"
          transition={200}
        />
        {block.alt ? <Text style={s.imageAlt}>{block.alt}</Text> : null}
      </View>
    );
  }
  if (block.kind === "hr") return <View style={s.hr} />;
  return null;
}


// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function estimateReadingTime(words: number | null | undefined): string {
  if (!words || words <= 0) return "";
  const minutes = Math.max(1, Math.round(words / 200));
  return `${minutes} min read`;
}

function safeDomain(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}


// ── Styles ─────────────────────────────────────────────────────────────────

const useStyles = makeStyles((t) => ({
  page: {
    flex: 1,
    backgroundColor: t.color.bg,
  },
  fullCenter: {
    flex: 1,
    backgroundColor: t.color.bg,
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.lg,
  } as any,
  heroWrap: {
    width: "100%" as any,
    backgroundColor: t.color["card.info"],
    position: "relative",
  } as any,
  heroFallback: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: t.color["card.info"],
  } as any,
  // Floating FAB — `accent.cta` Crema-pink fill + `text.on-cta`
  // Espresso glyph. Pink is the only fill that reads reliably in
  // both modes against ANY hero image: an Espresso fill loses
  // contrast on dark heroes, a cream fill loses contrast on cream
  // heroes (Caarabi's beige wordmark, Coffee Culture's white logo,
  // etc.), and the brand reserves pink + on-cta for action buttons —
  // which is exactly what this is. Same surface treatment as the
  // "Read the original" CTA pill at the bottom of this screen, so
  // the two action chrome elements pair visually.
  backFloating: {
    position: "absolute",
    top: 16,
    left: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.color["accent.cta"],
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  } as any,
  bodyColumn: {
    width: "100%" as any,
    alignSelf: "center",
    paddingHorizontal: t.spacing.xl,
    paddingTop: t.spacing.xl,
    gap: t.spacing.lg,
  } as any,
  title: {
    fontFamily: t.font.display,
    fontSize: t.size["font.display"],
    lineHeight: 38,
    color: t.color["text.primary"],
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: t.color.divider,
  } as any,
  metaName: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
  },
  metaSub: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    marginTop: 2,
  } as any,
  bodySpinner: {
    paddingVertical: t.spacing["3xl"],
    alignItems: "center",
  } as any,
  blocks: {
    gap: t.spacing.lg,
  } as any,
  paragraph: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.lg"],
    lineHeight: 28,
    color: t.color["text.primary"],
  } as any,
  h1: {
    fontFamily: t.font.display,
    fontSize: t.size["font.display"],
    lineHeight: 38,
    color: t.color["text.primary"],
    marginTop: t.spacing.md,
  } as any,
  h2: {
    fontFamily: t.font.display,
    fontSize: t.size["font.2xl"],
    lineHeight: 32,
    color: t.color["text.primary"],
    marginTop: t.spacing.md,
  } as any,
  h3: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xl"],
    lineHeight: 26,
    color: t.color["text.primary"],
    marginTop: t.spacing.sm,
  } as any,
  h4: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.lg"],
    lineHeight: 24,
    color: t.color["text.primary"],
  } as any,
  quoteWrap: {
    paddingLeft: t.spacing.lg,
    borderLeftWidth: 3,
    borderLeftColor: t.color["accent.cta"],
    paddingVertical: t.spacing.sm,
  } as any,
  quote: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.lg"],
    lineHeight: 28,
    color: t.color["text.secondary"],
    fontStyle: "italic",
  } as any,
  listWrap: {
    gap: t.spacing.sm,
  } as any,
  listItemRow: {
    flexDirection: "row",
    gap: t.spacing.sm,
    alignItems: "flex-start",
  } as any,
  listMarker: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.lg"],
    color: t.color["text.muted"],
    minWidth: 20,
  } as any,
  listItem: {
    flex: 1,
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.lg"],
    lineHeight: 26,
    color: t.color["text.primary"],
  } as any,
  imageBlock: {
    alignSelf: "center",
    marginVertical: t.spacing.sm,
    gap: t.spacing.xs,
  } as any,
  image: {
    borderRadius: t.radius.md,
    backgroundColor: t.color["card.info"],
  } as any,
  imageAlt: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    textAlign: "center",
  },
  hr: {
    height: 1,
    backgroundColor: t.color.divider,
    marginVertical: t.spacing.md,
  } as any,
  errorText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.muted"],
    textAlign: "center",
  },
  externalCta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.sm,
    marginTop: t.spacing.xl,
    alignSelf: "flex-start",
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    borderRadius: t.radius.full,
    backgroundColor: t.color["accent.cta"],
  } as any,
  externalCtaPressed: { opacity: 0.85 },
  externalCtaLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    letterSpacing: 0.4,
    color: t.color["text.on-cta"],
  } as any,
  coffeeRailWrap: {
    marginTop: t.spacing["2xl"],
    paddingTop: t.spacing.lg,
    borderTopWidth: 1,
    borderTopColor: t.color.divider,
    gap: t.spacing.md,
  } as any,
  coffeeRailTitle: {
    fontFamily: t.font.display,
    fontSize: t.size["font.xl"],
    color: t.color["text.primary"],
  },
  // Engagement strip — sits below the "Read the original" CTA.
  // Spec mirrors the JOURNALS row's old action bar wrapper: tight
  // top gap, bar inset to the body-column 20-px text edge, single
  // top hairline divider. The comment thread (its own primitive
  // with paddingHorizontal: 20 baked in) is wrapped separately and
  // negative-margins out of the body column so its 20-px inset
  // lands at the body text edge rather than inside it.
  engagementBarWrap: {
    marginTop: t.spacing.lg,
    paddingTop: t.spacing.md,
    borderTopWidth: 1,
    borderTopColor: t.color.divider,
    // Span across body-column padding so the divider is full-width.
    marginHorizontal: -t.spacing.xl,
    // Re-add the column inset so the bar buttons sit at the body
    // text edge on mobile (ActionBar.barMobile.paddingHorizontal: 0).
    paddingHorizontal: t.spacing.xl,
  } as any,
  // CommentThread already carries its own paddingHorizontal: 20 in
  // `section`. To land that 20-inset at the body text edge (rather
  // than inside the body column's 20 padding), negate the column
  // padding here so the thread's section inset lines up.
  engagementThreadWrap: {
    marginHorizontal: -t.spacing.xl,
  } as any,
}));
