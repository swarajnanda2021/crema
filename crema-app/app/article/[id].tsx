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
import { ArrowLeft, ArrowRight, ExternalLink, Play } from "lucide-react-native";

import { t, makeStyles } from "../../src/tokens/useTokens";
import { useRoasterArticles } from "../../src/hooks/useRoasterArticles";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useBreakpoint } from "../../src/hooks/useBreakpoint";
import { apiFetchRaw, resolveUploadUrl, trackClick, trackImpression } from "../../src/api/client";
import { thumbnailUrl } from "../../src/utils/imageUrl";
import { openExternal } from "../../src/utils/openExternal";
import { tap as hapticTap } from "../../src/utils/haptics";
import {
  htmlToBlocks,
  type Block,
  type Run,
} from "../../src/utils/htmlToBlocks";
import { onChromeScroll } from "../../src/utils/chromeScroll";
import RoasterLogo from "../../src/components/primitives/RoasterLogo";
import SiteHeader from "../../src/components/SiteHeader";
import CoffeeCard, {
  CARD_TARGET_WIDTH,
  coffeeCardHeight,
} from "../../src/components/CoffeeCard";
import ActionBar from "../../src/components/primitives/ActionBar";
import CommentThread from "../../src/components/primitives/CommentThread";
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
          // Eagerly fetch this roaster's full article set so the
          // inline-link resolver can match references that fell
          // outside the chronological cache window. The sitewide
          // /articles?limit=500 endpoint orders by published_at DESC
          // — older articles (Caffena's 2022 evergreens, for example)
          // sit past the cap. Per-roaster fetch is bounded (each
          // roaster ships 5-30 articles) so it's cheap, and most
          // editorial cross-references are intra-roaster ("see our
          // earlier guide on..."). The cache.upsert merges them in
          // so subsequent navigation also benefits.
          const slug = (data as RoasterArticle).roaster_slug;
          if (slug) {
            apiFetchRaw(
              `/roasters/${encodeURIComponent(slug)}/articles?limit=100`,
            )
              .then((siblingRes: any) => {
                if (cancelled) return;
                const siblings = siblingRes?.data || siblingRes || [];
                if (Array.isArray(siblings)) {
                  for (const s of siblings) {
                    if (s?.id != null) cache.upsert(s as RoasterArticle);
                  }
                }
              })
              .catch(() => {
                // Coverage best-effort; don't block the reader on a
                // sibling fetch failure.
              });
          }
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

  // Ad-placement entries — the article's merged placement set,
  // bucketed by source ('inline' | 'auto' | 'manual'). Each entry
  // carries its attribution cause + the paragraph index where the
  // cause was found, so the reader can:
  //   • splice the card next to the originating paragraph (anchor)
  //   • show 'Recommended due to: <cause>' under each carousel
  //
  // `paragraph_idx = -1` means the cause came from title/excerpt
  // (no body anchor) or there's no specific anchor — the reader
  // falls back to a mid-body splice in that case.
  type PlacementEntry = {
    product_id: string;
    source: "inline" | "auto" | "manual";
    roaster_slug: string;
    attribution_cause?: string;
    /** The exact word/phrase from the catalog that matched a paragraph.
     *  Used by the reader's caption: "because this paragraph mentioned
     *  {trigger}". Empty/absent for inline + manual (no caption shown). */
    trigger?: string;
    paragraph_idx?: number;
  };
  const [placements, setPlacements] = useState<PlacementEntry[]>([]);
  useEffect(() => {
    if (!Number.isFinite(idNum)) return;
    let cancelled = false;
    apiFetchRaw(`/articles/${idNum}/placements`)
      .then((res: any) => {
        if (cancelled) return;
        const data = res?.data ?? res;
        if (Array.isArray(data)) {
          setPlacements(
            data
              .filter((e: any) => typeof e?.product_id === "string" && typeof e?.source === "string")
              .map((e: any) => ({
                product_id: e.product_id,
                source: e.source,
                roaster_slug: e.roaster_slug,
                attribution_cause: typeof e.attribution_cause === "string" ? e.attribution_cause : undefined,
                trigger: typeof e.trigger === "string" ? e.trigger : undefined,
                paragraph_idx: typeof e.paragraph_idx === "number" ? e.paragraph_idx : -1,
              })),
          );
        }
      })
      .catch(() => {
        // Best-effort — a placements miss falls back to inline-link
        // matching only, which is what the reader did before P0.
      });
    return () => {
      cancelled = true;
    };
  }, [idNum]);

  // Fire one impression per (session, article, product, source) on
  // first render of each placement. The server's UNIQUE constraint
  // dedups so refreshes within the same session collapse to a
  // single row. Runs once per placement set change — i.e. on the
  // initial fetch only, since `placements` is stable for the
  // article's lifetime.
  useEffect(() => {
    if (!placements.length || !article?.id) return;
    for (const entry of placements) {
      trackImpression({
        article_id: article.id,
        product_id: entry.product_id,
        roaster_slug: entry.roaster_slug,
        placement_source: entry.source,
      });
    }
  }, [placements, article?.id]);

  const heroSrc = useMemo(() => {
    if (!article?.image_url) return null;
    const w = isMobile ? 1080 : 1600;
    // Local /uploads/articles/<...>.webp paths need the API origin
    // prepended; absolute URLs (Shopify CDN, etc.) pass through.
    const resolved = resolveUploadUrl(article.image_url) || article.image_url;
    return thumbnailUrl(resolved, w) || resolved;
  }, [article?.image_url, isMobile]);

  // Hero height starts as a sensible 16:9 placeholder and resolves to
  // the image's intrinsic aspect once it loads — same reason as
  // BodyImage below: forcing a fixed container aspect with
  // contentFit="cover" crops out parts of the image the photographer
  // chose to include. Capped at 540 on wide so heroes don't dominate
  // the viewport.
  const [heroAspect, setHeroAspect] = useState<number | null>(null);
  const heroHeightDefault = isMobile
    ? Math.round(width * (9 / 16))
    : Math.min(540, Math.round(width * 0.4));
  const heroHeight = heroAspect
    ? Math.min(
        isMobile ? Math.round(width * 1.5) : 700,
        Math.round(width / heroAspect),
      )
    : heroHeightDefault;

  // Two-step body assembly. Step 1: parse body_html into block list
  // (paragraphs/headings carry inline `runs` after the v3 enricher
  // started preserving <a>/<strong>/<em>). Step 2: walk every run's
  // href, match against the in-catalog product + sibling-article
  // caches, and splice synthetic embed blocks under the first
  // paragraph that mentions each match. The reader renders inline
  // links AND the embed (CoffeeCard / journal callout) together —
  // the inline link gets a smart router (in-app when the href
  // resolves to a known coffee/article, external otherwise); the
  // embed is the editorial placement under the paragraph.
  const baseBlocks = useMemo(
    () => (article?.body_html ? htmlToBlocks(article.body_html) : []),
    [article?.body_html],
  );

  // Index products + articles by canonical URL once per cache change.
  // `canonicaliseUrl` lowercases host, strips trailing slash + query +
  // fragment so minor href drift between roaster prose and our
  // ingested URL doesn't sink the match.
  const productByUrl = useMemo(() => {
    const map = new Map<string, any>();
    if (!products) return map;
    for (const p of products as any[]) {
      const k = canonicaliseUrl(p?.product_url);
      if (k) map.set(k, p);
    }
    return map;
  }, [products]);

  // Same roaster's products indexed by roaster_slug, for the prefix-
  // fuzzy fallback. Shopify roasters serve products under the canonical
  // slug (`/products/newton-100-arabica`) but their own articles often
  // link to the SHORT marketing slug (`/products/newton`) which 301s
  // to the canonical. Strict-URL match misses; prefix-against-same-
  // roaster-catalog match catches it cleanly.
  const productsByRoaster = useMemo(() => {
    const map = new Map<string, any[]>();
    if (!products) return map;
    for (const p of products as any[]) {
      const slug = p?.roaster_slug;
      if (!slug) continue;
      const list = map.get(slug) || [];
      list.push(p);
      map.set(slug, list);
    }
    return map;
  }, [products]);

  const articleByUrl = useMemo(() => {
    const map = new Map<string, RoasterArticle>();
    for (const a of cache.articles) {
      const k = canonicaliseUrl(a?.url);
      if (k) map.set(k, a);
    }
    return map;
  }, [cache.articles]);

  // Per-roaster article index — used by the title-token fuzzy
  // fallback when an href fails the strict canonical-URL match. CMS
  // platforms like Caffena's serve the same article under multiple
  // slugs (an SEO-friendly canonical that 301s to the legacy storage
  // slug), and inline `<a href>` tags author against the canonical
  // while our scraper stored the redirect target. The strict map
  // can't bridge that gap; comparing href slug tokens against the
  // article's title closes it without a network round-trip.
  const articlesByRoaster = useMemo(() => {
    const map = new Map<string, RoasterArticle[]>();
    for (const a of cache.articles) {
      if (!a?.roaster_slug) continue;
      const list = map.get(a.roaster_slug);
      if (list) list.push(a);
      else map.set(a.roaster_slug, [a]);
    }
    return map;
  }, [cache.articles]);

  const blocks = useMemo<RenderableBlock[]>(
    () =>
      augmentBlocksWithEmbeds(baseBlocks, {
        productByUrl,
        articleByUrl,
        articlesByRoaster,
        productsByRoaster,
        currentRoasterSlug: article?.roaster_slug ?? null,
        currentArticleId: article?.id,
        placements,
      }),
    [
      baseBlocks,
      productByUrl,
      articleByUrl,
      articlesByRoaster,
      productsByRoaster,
      article?.roaster_slug,
      article?.id,
      placements,
    ],
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

  // Display the article's own publish date only — never the scrape
  // day. NULL published_at hides the date in the meta line cleanly.
  const dateLabel = formatDate(article.published_at);
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
        testID="article-screen"
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
      {/* Hero with floating back FAB. `contain` + intrinsic-aspect
          height ensures we never crop the photographer's framing.
          When the article has NO hero (image_url=null), we DO NOT
          render a placeholder block — empty cream rectangles between
          the back button and the title read as broken UI. Instead we
          render a slim chrome strip just tall enough to hold the
          back FAB so the title floats at the top of the page. */}
      {heroSrc ? (
        <View style={[s.heroWrap, { height: heroHeight }]}>
          <Image
            source={{ uri: heroSrc }}
            style={StyleSheet.absoluteFillObject}
            contentFit="contain"
            transition={200}
            onLoad={(e: any) => {
              const w = e?.source?.width;
              const h = e?.source?.height;
              if (typeof w === "number" && typeof h === "number" && h > 0) {
                setHeroAspect(w / h);
              }
            }}
          />
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
      ) : (
        <View style={s.heroAbsentChrome}>
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
      )}

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
                isMobile={isMobile}
                productByUrl={productByUrl}
                articleByUrl={articleByUrl}
                articlesByRoaster={articlesByRoaster}
                productsByRoaster={productsByRoaster}
                currentRoasterSlug={article.roaster_slug ?? null}
                currentArticleId={article.id}
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
            likedByMe={!!article.liked_by_me}
            shareUrl={articleShareUrl(article.id)}
            onComment={() => hapticTap()}
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


// ── Body image — preserves intrinsic aspect ────────────────────────────────
//
// Articles come from 97 different roasters; their photos run the gamut
// from 16:9 hero panoramas to 1:1 portrait crops to 4:3 farm shots.
// Forcing a fixed container aspect with `contentFit="cover"` clips
// content the photographer chose to include — faces cropped to half-
// faces, captions of in-image text cut off, etc.
//
// Fix: capture each image's natural dimensions on load, size the
// container to that aspect ratio, render full-frame. The pre-load
// placeholder uses a 3:2 default which covers most photos without
// causing a jarring layout shift when the real aspect resolves.
function BodyImage({
  src,
  alt,
  maxWidth,
}: {
  src: string;
  alt?: string;
  maxWidth: number;
}) {
  const s = useStyles();
  const [aspect, setAspect] = useState<number | null>(null);
  const height = aspect ? maxWidth / aspect : Math.round(maxWidth * 0.667);
  return (
    <View style={[s.imageBlock, { width: maxWidth }]}>
      <Image
        source={{ uri: src }}
        style={[s.image, { width: maxWidth, height }]}
        contentFit="contain"
        transition={200}
        onLoad={(e: any) => {
          const w = e?.source?.width;
          const h = e?.source?.height;
          if (typeof w === "number" && typeof h === "number" && h > 0) {
            setAspect(w / h);
          }
        }}
      />
      {alt ? <Text style={s.imageAlt}>{alt}</Text> : null}
    </View>
  );
}


// ── Block renderer ─────────────────────────────────────────────────────────

/** A renderable block extends the base htmlToBlocks output with
 *  synthetic embed blocks the reader inserts after a paragraph that
 *  references an in-catalog product or sibling article. The base
 *  shapes are unchanged. */
type RenderableBlock =
  | Block
  | {
      kind: "embed-coffee";
      productIds: string[];
      embedSource?: "inline" | "auto" | "manual" | "mentioned";
      roasterName?: string;
      // Per-product trigger map. The reader's caption renders as
      // "because this paragraph mentioned {trigger}" using the exact
      // catalog string that matched (e.g. "Anaerobic", "MOGRA",
      // "Baarbara Estate"). Captions are AUTO-ONLY — inline (URL
      // link) and manual (roaster pick) don't render a caption.
      triggers?: Record<string, string>;
    }
  | { kind: "embed-article"; articleIds: number[] };

function RenderedBlock({
  block,
  pageWidth,
  isMobile,
  productByUrl,
  articleByUrl,
  articlesByRoaster,
  productsByRoaster,
  currentRoasterSlug,
  currentArticleId,
}: {
  block: RenderableBlock;
  pageWidth: number;
  isMobile: boolean;
  productByUrl: Map<string, any>;
  articleByUrl: Map<string, RoasterArticle>;
  articlesByRoaster: Map<string, RoasterArticle[]>;
  productsByRoaster: Map<string, any[]>;
  currentRoasterSlug: string | null;
  currentArticleId?: number | null;
}) {
  const s = useStyles();
  const router = useRouter();

  // Tap handler for inline links. Smart router — in-app when href
  // resolves to a known coffee/article, external otherwise. The
  // SAME logic the embed-resolution pass uses, applied per-tap so a
  // run with no embedded card still routes correctly when tapped.
  const onLinkPress = (href: string) => {
    if (!href) return;
    const canon = canonicaliseUrl(href);
    if (canon) {
      const product = productByUrl.get(canon);
      if (product?.product_id) {
        hapticTap();
        router.push(`/coffee/${product.product_id}` as any);
        return;
      }
      const article = articleByUrl.get(canon);
      if (article?.id != null) {
        hapticTap();
        router.push(`/article/${article.id}` as any);
        return;
      }
    }
    // Strict-URL miss → try same-roaster product slug-prefix fuzzy
    // match first (Shopify product canonical slugs append variant
    // suffixes like `-100-arabica` that the article body's prose
    // links typically don't carry; `/products/newton` resolves to
    // catalog's `/products/newton-100-arabica`).
    const fuzzyProduct = findFuzzyProductMatch(
      href,
      currentRoasterSlug,
      productsByRoaster,
    );
    if (fuzzyProduct?.product_id) {
      hapticTap();
      router.push(`/coffee/${fuzzyProduct.product_id}` as any);
      return;
    }
    // Then same-roaster article title-token fuzzy match — handles
    // CMS redirects where authors link to an SEO-friendly slug that
    // 301s to the legacy storage slug we ingested under (Caffena's
    // `arabica-coffee-complete-guide` → `news-specialty-...`).
    const fuzzy = findFuzzyArticleMatch(
      href,
      currentRoasterSlug,
      articlesByRoaster,
    );
    if (fuzzy) {
      hapticTap();
      router.push(`/article/${fuzzy.id}` as any);
      return;
    }
    openExternal(href);
  };

  if (block.kind === "paragraph") {
    return (
      <Text style={s.paragraph}>
        <RenderedRuns runs={block.runs} onLinkPress={onLinkPress} />
      </Text>
    );
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
    return (
      <Text style={styleByLevel[block.level]}>
        <RenderedRuns
          runs={block.runs}
          onLinkPress={onLinkPress}
          inheritColor
        />
      </Text>
    );
  }
  if (block.kind === "quote") {
    return (
      <View style={s.quoteWrap}>
        <Text style={s.quote}>
          <RenderedRuns runs={block.runs} onLinkPress={onLinkPress} />
        </Text>
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
            <Text style={s.listItem}>
              <RenderedRuns runs={item} onLinkPress={onLinkPress} />
            </Text>
          </View>
        ))}
      </View>
    );
  }
  if (block.kind === "image") {
    const maxImgW = Math.min(720, pageWidth - 32);
    // Body images may be local /uploads/articles/<sha>.webp paths
    // (after the WebP-ification pass) — those need the API origin
    // prefixed before fetch, same as the hero. Absolute URLs (Shopify
    // CDN, etc.) pass through resolveUploadUrl unchanged.
    const resolved = resolveUploadUrl(block.src) || block.src;
    const sized = thumbnailUrl(resolved, 1200) || resolved;
    // Caption (from <figcaption>) sits below the image in muted
    // body.regular at font.sm — editorial caption typography. Falls
    // back to alt text when no figcaption was authored.
    const captionText = block.caption || block.alt;
    return (
      <BodyImage src={sized} alt={captionText} maxWidth={maxImgW} />
    );
  }
  if (block.kind === "video") {
    // 16:9 thumbnail frame, capped at the same 720-px column the
    // editorial reader uses for images so the video lands as a peer
    // of every other inline media block. The cream play disc sits
    // centered on the thumbnail (DESIGN_LANGUAGE §0: same 52-px disc
    // language as the site's primary FABs). "Watch on {platform}"
    // caption strip below the frame mirrors the affordance language
    // of the Buy click on CoffeeCard — same external-link glyph,
    // same muted body.medium voice.
    const maxW = Math.min(720, pageWidth - 32);
    const frameH = Math.round((maxW * 9) / 16);
    const platformLabel = block.platform === "youtube" ? "YouTube" : "Vimeo";
    const onPress = () => {
      trackClick(
        `video:${block.platform}:${block.videoId}`,
        currentRoasterSlug,
        "article",
      );
      openExternal(block.url);
    };
    return (
      <View style={[s.videoBlock, { width: maxW }]}>
        <Pressable
          onPress={onPress}
          accessibilityRole="link"
          accessibilityLabel={`Watch video on ${platformLabel}`}
          style={[s.videoFrame, { width: maxW, height: frameH }]}
        >
          {block.thumbnailUrl ? (
            <Image
              source={{ uri: block.thumbnailUrl }}
              style={StyleSheet.absoluteFillObject as any}
              contentFit="cover"
              transition={200}
            />
          ) : (
            <View
              style={[
                StyleSheet.absoluteFillObject,
                s.videoThumbFallback,
              ]}
            />
          )}
          <View style={s.videoPlayWrap} pointerEvents="none">
            <View style={s.videoPlayDisc}>
              <Play
                size={20}
                color={t.color["text.on-light"]}
                fill={t.color["text.on-light"]}
                strokeWidth={0}
              />
            </View>
          </View>
        </Pressable>
        <Pressable onPress={onPress} hitSlop={4} style={s.videoCaption}>
          <Text style={s.videoCaptionText}>
            Watch on {platformLabel}
          </Text>
          <ExternalLink
            size={12}
            color={t.color["text.secondary"]}
            strokeWidth={1.8}
          />
        </Pressable>
      </View>
    );
  }
  if (block.kind === "adslot") {
    // Ad-slot anchor — Haiku emits these as `<hr>` between major
    // topical sections. For now we render an editorial ornament; the
    // monetization layer (sponsored coffee card, roaster spotlight)
    // swaps in here later. Three muted dots so the reader still
    // perceives a topical break even when no ad is wired.
    return (
      <View style={s.adslot}>
        <Text style={s.adslotMark}>· · ·</Text>
      </View>
    );
  }
  if (block.kind === "embed-coffee") {
    // Coffee placement carousel — one of three sources:
    //   • 'mentioned' — paragraph contained `<a href>` resolving to a
    //     catalog product (in-flow inline match, rendered after the
    //     mentioning paragraph). Label: "Found in this article".
    //   • 'inline'    — server detected the link in body during the
    //     placement merge. Crema-responsible. Label: "Referenced in
    //     this article". Tracked as `placement_source='inline'` on
    //     any click.
    //   • 'auto'      — server's scorer matched the article. Label:
    //     "Crema suggests". Tracked as `placement_source='auto'`.
    //   • 'manual'    — roaster's curated pick. Label: "{Roaster}
    //     recommends". Tracked as `placement_source='manual'`.
    //
    // The 'mentioned' bucket is what the original P0 splice produced
    // (inline-href matches resolved client-side). With server-side
    // inline detection in place, 'mentioned' overlaps semantically
    // with 'inline' — but the splice point differs (mentioned
    // renders after the paragraph that mentioned it; inline renders
    // mid-body alongside auto/manual). For attribution purposes
    // both are `placement_source='inline'` on the click event —
    // they reference the same product through the same surface.
    const items = block.productIds
      .map((id) => {
        for (const p of productByUrl.values()) {
          if (p?.product_id === id) return p;
        }
        return null;
      })
      .filter(Boolean);
    if (items.length === 0) return null;
    const cardW = isMobile ? pageWidth - 32 : CARD_TARGET_WIDTH;
    const cardH = coffeeCardHeight(cardW, isMobile);
    // Bucket label. "Referenced in this article" only for inline
    // (URL link the article author placed). Everything else —
    // Crema-detected matches AND roaster-curated picks — surfaces
    // as "Promoted" so the affordance reads honestly to the
    // consumer (this is an ad slot, regardless of who chose the
    // coffee).
    const label =
      (block.embedSource === "inline" || block.embedSource === "mentioned")
        ? "Referenced in this article"
      : "Promoted";
    // Click events from in-article CoffeeCards carry the placement
    // context so attribution can split ad-slot vs organic clicks.
    const clickSource: "inline" | "auto" | "manual" =
      block.embedSource === "auto" ? "auto"
      : block.embedSource === "manual" ? "manual"
      : "inline";
    // Caption logic. Only AUTO placements show a caption, and the
    // caption is constructed from the trigger word in the form
    // "because this paragraph mentioned {trigger}". Inline + manual
    // skip the caption entirely:
    //   • Inline: the URL link in the body IS the explanation
    //   • Manual: the roaster picked it — no algorithmic reason
    //     to surface
    const triggers = block.triggers || {};
    const showCaption = block.embedSource === "auto";
    // When all cards in this carousel share the same trigger, the
    // caption goes ABOVE the carousel as a single shared line.
    // When triggers differ across cards (a multi-product splice
    // with mixed causes — rare but possible after the grouping
    // pass), each card gets its own per-card caption below it.
    const distinctTriggers = showCaption
      ? Array.from(new Set(Object.values(triggers).filter(Boolean)))
      : [];
    const sharedTrigger = distinctTriggers.length === 1 ? distinctTriggers[0] : null;
    return (
      <View style={s.embedWrap}>
        <Text style={s.embedLabel}>{label}</Text>
        {showCaption && sharedTrigger ? (
          <Text style={s.embedCause}>
            because this paragraph mentioned {sharedTrigger}
          </Text>
        ) : null}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 16, paddingRight: 16 }}
        >
          {items.map((c: any) => {
            const trig = triggers[c.product_id];
            const showPerCard = showCaption && !sharedTrigger && !!trig;
            return (
              <View
                key={c.product_id}
                style={{ width: cardW }}
              >
                <View style={{ width: cardW, height: cardH }}>
                  <CoffeeCard
                    coffee={c}
                    width={cardW}
                    height={cardH}
                    attribution={
                      currentArticleId != null
                        ? { article_id: currentArticleId, placement_source: clickSource }
                        : undefined
                    }
                  />
                </View>
                {showPerCard ? (
                  <Text style={s.embedCausePerCard} numberOfLines={2}>
                    because this paragraph mentioned {trig}
                  </Text>
                ) : null}
              </View>
            );
          })}
        </ScrollView>
      </View>
    );
  }
  if (block.kind === "embed-article") {
    // Sibling article reference — paragraph linked to another article
    // we have in our cache. Render each as a calm framed callout the
    // reader can tap to jump to.
    const items = block.articleIds
      .map((id) => {
        for (const a of articleByUrl.values()) {
          if (a?.id === id) return a;
        }
        return null;
      })
      .filter(Boolean);
    if (items.length === 0) return null;
    return (
      <View style={s.embedWrap}>
        <Text style={s.embedLabel}>Read more</Text>
        {items.map((a: any) => (
          <Pressable
            key={a.id}
            onPress={() => {
              hapticTap();
              router.push(`/article/${a.id}` as any);
            }}
            style={({ pressed }) => [
              s.articleCallout,
              pressed && { opacity: 0.85 },
            ]}
            accessibilityRole="link"
            accessibilityLabel={`Read article: ${a.title}`}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.articleCalloutTitle} numberOfLines={2}>
                {a.title}
              </Text>
              {a.roaster_name ? (
                <Text style={s.articleCalloutMeta} numberOfLines={1}>
                  By {a.roaster_name}
                </Text>
              ) : null}
            </View>
            <View style={s.articleCalloutArrowDisc}>
              <ArrowRight
                size={18}
                color={t.color["text.on-cta"]}
                strokeWidth={2}
              />
            </View>
          </Pressable>
        ))}
      </View>
    );
  }
  return null;
}


/** Render a list of inline runs as nested <Text> children. The parent
 *  block-level <Text> owns the base typography (font, size, color);
 *  each child <Text> only sets the formatting it overrides — bold via
 *  family swap, italic via fontStyle, link via accent color +
 *  underline + tap handler. The shape works on RN web + native
 *  because <Text> children inherit context from their <Text> parent. */
function RenderedRuns({
  runs,
  onLinkPress,
  inheritColor = false,
}: {
  runs: Run[];
  onLinkPress: (href: string) => void;
  /** When the parent already sets a color (headings) we don't want
   *  links to recolor — they look louder than the heading itself. */
  inheritColor?: boolean;
}) {
  const s = useStyles();
  return (
    <>
      {runs.map((r, i) => {
        const isLink = !!r.href;
        const styles: any[] = [];
        if (r.bold) styles.push(s.runBold);
        if (r.italic) styles.push(s.runItalic);
        if (isLink && !inheritColor) styles.push(s.runLink);
        if (isLink && inheritColor) styles.push(s.runLinkInherit);
        if (isLink) {
          return (
            <Text
              key={i}
              style={styles}
              onPress={() => onLinkPress(r.href!)}
              accessibilityRole="link"
            >
              {r.text}
            </Text>
          );
        }
        if (styles.length === 0) {
          // Fast path — bare text run, render as a string child so RN
          // can flatten it into the parent <Text> at layout time.
          return r.text;
        }
        return (
          <Text key={i} style={styles}>
            {r.text}
          </Text>
        );
      })}
    </>
  );
}


// ── Embed resolution ───────────────────────────────────────────────────────

/** Walk every block and, for each block that carries inline runs,
 *  collect the hrefs that match a known product or article. After
 *  the first paragraph that mentions each match, splice in a
 *  synthetic embed block so the reader can render a CoffeeCard /
 *  journal callout right below. Dedup at the article level — once
 *  we've embedded a product card, we don't repeat it later in the
 *  same article even if mentioned twice. */
function augmentBlocksWithEmbeds(
  blocks: Block[],
  ctx: {
    productByUrl: Map<string, any>;
    articleByUrl: Map<string, RoasterArticle>;
    articlesByRoaster: Map<string, RoasterArticle[]>;
    productsByRoaster: Map<string, any[]>;
    currentRoasterSlug: string | null;
    currentArticleId?: number | null;
    placements?: Array<{
      product_id: string;
      source: "inline" | "auto" | "manual";
      roaster_slug: string;
      attribution_cause?: string;
      trigger?: string;
      paragraph_idx?: number;
    }>;
  },
): RenderableBlock[] {
  const result: RenderableBlock[] = [];
  // Per-section dedup: the `seen` sets reset at every <hr> adslot
  // anchor (Haiku emits these between topical sections per the
  // prompt's "hr count = h2 count" rule). Same product / article
  // mentioned again in a NEW section gets its own embed, but
  // multiple mentions inside one section collapse to a single
  // embed.
  let seenProducts = new Set<string>();
  let seenArticles = new Set<number>();
  for (const block of blocks) {
    result.push(block);
    if (block.kind === "adslot") {
      seenProducts = new Set();
      seenArticles = new Set();
      continue;
    }
    const refs = gatherRefsInBlock(block, ctx);
    const newProducts = refs.products.filter((id) => !seenProducts.has(id));
    const newArticles = refs.articles.filter((id) => !seenArticles.has(id));
    newProducts.forEach((id) => seenProducts.add(id));
    newArticles.forEach((id) => seenArticles.add(id));
    if (newProducts.length > 0) {
      // In-flow href match — labeled "Found in this article". For
      // attribution, this maps to placement_source='inline' on click
      // (the server-side merge categorises the same product as
      // inline; the in-flow splice is just a different visual
      // anchor for the same underlying placement).
      result.push({ kind: "embed-coffee", productIds: newProducts, embedSource: "mentioned" });
    }
    if (newArticles.length > 0) {
      result.push({ kind: "embed-article", articleIds: newArticles });
    }
  }

  // Persisted ad-placement splice (P1 — bottom-up causal model).
  //
  // Server returns each placement with `paragraph_idx` — the index
  // of the <p> block in the article body where the attribution
  // cause was found. We splice each card RIGHT AFTER that paragraph
  // so the card sits next to its evidence ("Mentioned by name in
  // paragraph 9" → card after paragraph 9). This is the editorial
  // win the bottom-up rewrite buys: every placement is anchored to
  // why it's there, not at an arbitrary mid-body splice point.
  //
  // paragraph_idx === -1 means the cause came from title/excerpt
  // (no body anchor) OR the placement is roaster-curated manual
  // (no inherent reference). Those fall back to a mid-body splice.
  //
  // Resolve the roaster name from the products cache for the
  // "{Roaster} recommends" label on the manual bucket.
  const roasterSlug = ctx.currentRoasterSlug;
  let roasterName: string | undefined;
  if (roasterSlug) {
    for (const p of ctx.productByUrl.values()) {
      if (p?.roaster_slug === roasterSlug && p?.roaster_name) {
        roasterName = p.roaster_name;
        break;
      }
    }
  }

  const placements = ctx.placements || [];
  if (placements.length > 0) {
    // Skip placements already rendered via the in-flow `<a href>`
    // pass above (the "mentioned" bucket renders them near their
    // mentioning paragraph already; a second placement card would
    // double up).
    const alreadyEmbedded = new Set<string>();
    for (const b of result) {
      if (b.kind === "embed-coffee") {
        for (const id of b.productIds) alreadyEmbedded.add(id);
      }
    }
    const remaining = placements.filter((p) => !alreadyEmbedded.has(p.product_id));

    // Build paragraph-index map: server's <p> index → block index in
    // the rendered `result`. Both sides count <p> blocks (filtering
    // empties) so the indices align if the body_html parsing agrees.
    const pToBlockIdx: number[] = [];
    for (let i = 0; i < result.length; i++) {
      if (result[i].kind === "paragraph") pToBlockIdx.push(i);
    }
    const blockIdxForPara = (pi: number): number => {
      if (pi < 0 || pToBlockIdx.length === 0) {
        // -1 / no anchor → mid-body fallback (the 60% mark of
        // paragraphs, or the last paragraph if there are few).
        if (pToBlockIdx.length === 0) return result.length - 1;
        return pToBlockIdx[Math.min(
          pToBlockIdx.length - 1,
          Math.floor(pToBlockIdx.length * 0.6),
        )];
      }
      return pToBlockIdx[Math.min(pi, pToBlockIdx.length - 1)];
    };

    // Group placements by (source, paragraph_idx). Multiple coffees
    // attributed to the SAME paragraph render together in one
    // carousel under that paragraph; coffees attributed to different
    // paragraphs render separately under each anchor.
    type Group = {
      source: "inline" | "auto" | "manual";
      paragraphIdx: number;
      ids: string[];
      // Per-product trigger word — the catalog attribute that
      // matched in the paragraph. Used by the renderer's caption:
      // "because this paragraph mentioned {trigger}". Empty/absent
      // for inline + manual (no caption renders).
      triggers: Record<string, string>;
    };
    const groups: Group[] = [];
    const groupKey = (p: typeof remaining[0]) =>
      `${p.source}::${p.paragraph_idx ?? -1}`;
    const byKey = new Map<string, Group>();
    for (const p of remaining) {
      const key = groupKey(p);
      let g = byKey.get(key);
      if (!g) {
        g = {
          source: p.source,
          paragraphIdx: p.paragraph_idx ?? -1,
          ids: [],
          triggers: {},
        };
        byKey.set(key, g);
        groups.push(g);
      }
      g.ids.push(p.product_id);
      if (p.trigger) g.triggers[p.product_id] = p.trigger;
    }

    // Splice each group at its anchor paragraph. Insert in
    // descending block-index order so earlier indices aren't
    // shifted by the inserts that follow.
    const positioned = groups
      .map((g) => ({ group: g, at: blockIdxForPara(g.paragraphIdx) }))
      .sort((a, b) => b.at - a.at);
    for (const { group, at } of positioned) {
      result.splice(at + 1, 0, {
        kind: "embed-coffee",
        productIds: group.ids,
        embedSource: group.source,
        roasterName,
        triggers: group.triggers,
      });
    }
  }

  return result;
}

function gatherRefsInBlock(
  block: Block,
  ctx: {
    productByUrl: Map<string, any>;
    articleByUrl: Map<string, RoasterArticle>;
    articlesByRoaster: Map<string, RoasterArticle[]>;
    productsByRoaster: Map<string, any[]>;
    currentRoasterSlug: string | null;
    currentArticleId?: number | null;
  },
): { products: string[]; articles: number[] } {
  const productIds: string[] = [];
  const articleIds: number[] = [];
  const seenP = new Set<string>();
  const seenA = new Set<number>();

  const visitRuns = (runs: Run[]) => {
    for (const run of runs) {
      if (!run.href) continue;
      const canon = canonicaliseUrl(run.href);
      if (canon) {
        const product = ctx.productByUrl.get(canon);
        if (product?.product_id && !seenP.has(product.product_id)) {
          seenP.add(product.product_id);
          productIds.push(product.product_id);
          continue;
        }
        const article = ctx.articleByUrl.get(canon);
        if (
          article?.id != null &&
          article.id !== ctx.currentArticleId &&
          !seenA.has(article.id)
        ) {
          seenA.add(article.id);
          articleIds.push(article.id);
          continue;
        }
      }
      // Strict-URL miss → same-roaster product slug-prefix fuzzy
      // fallback (Shopify product canonicals carry a variant suffix
      // — `/products/newton-100-arabica` — that the article's prose
      // links typically omit — `/products/newton`. The 301 lives on
      // the roaster's site; client-side slug-prefix scan resolves
      // without a network round-trip).
      const fuzzyP = findFuzzyProductMatch(
        run.href,
        ctx.currentRoasterSlug,
        ctx.productsByRoaster,
      );
      if (fuzzyP?.product_id && !seenP.has(fuzzyP.product_id)) {
        seenP.add(fuzzyP.product_id);
        productIds.push(fuzzyP.product_id);
        continue;
      }
      // Then same-roaster article title-token fuzzy fallback —
      // closes the gap when a CMS serves the same article under
      // multiple slugs.
      const fuzzy = findFuzzyArticleMatch(
        run.href,
        ctx.currentRoasterSlug,
        ctx.articlesByRoaster,
      );
      if (
        fuzzy &&
        fuzzy.id !== ctx.currentArticleId &&
        !seenA.has(fuzzy.id)
      ) {
        seenA.add(fuzzy.id);
        articleIds.push(fuzzy.id);
      }
    }
  };

  if (block.kind === "paragraph" || block.kind === "heading" || block.kind === "quote") {
    visitRuns(block.runs);
  } else if (block.kind === "list") {
    for (const item of block.items) visitRuns(item);
  }
  return { products: productIds, articles: articleIds };
}

/** Stopwords + 1-2 char tokens dropped before scoring fuzzy matches.
 *  Generic English filler + CMS path noise + SEO clichés. The SEO
 *  cliché set ("what", "how", "why", "complete", "ultimate", "guide",
 *  "coffee", "essential", "everything") gets dropped because they
 *  appear in nearly every blog slug AND title on a coffee app and
 *  carry no distinguishing signal — without filtering them, every
 *  "what-is-X" body link matches every "X coffee guide" article and
 *  yields a tie that the strict-winner gate rejects. After this
 *  filter, the surviving tokens are the actual SUBJECT (origin,
 *  varietal, process, brew method) which DO discriminate. */
const FUZZY_STOPWORDS = new Set([
  // Generic English filler
  "a", "an", "and", "the", "of", "to", "for", "in", "on", "at",
  "by", "with", "from", "is", "it", "its", "be", "as", "or",
  "this", "that", "these", "those", "your", "our", "my",
  // CMS path noise
  "blog", "blogs", "article", "post", "posts", "news",
  // SEO clichés — appear in nearly every coffee-blog slug/title
  "what", "how", "why", "when", "where", "who", "which",
  "complete", "ultimate", "guide", "guides", "essential",
  "everything", "basics", "introduction", "simple", "terms",
  "know", "knowing", "learn", "learning", "discover",
  "understanding", "intro",
  // The platform's whole-domain word — drops the "coffee article on
  // a coffee app" tautology
  "coffee", "coffees",
]);

/** Tokenize a string for fuzzy matching: lowercase, split on
 *  non-alphanumeric, drop stopwords + tokens shorter than 3 chars.
 *  Returns a Set so set-overlap math is O(min(a,b)). */
function fuzzyTokens(s: string | null | undefined): Set<string> {
  if (!s) return new Set();
  const out = new Set<string>();
  for (const tok of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (tok.length < 3) continue;
    if (FUZZY_STOPWORDS.has(tok)) continue;
    out.add(tok);
  }
  return out;
}

/** Resolve an inline href that missed the strict canonical-URL match
 *  by scoring it against the same roaster's article titles. CMS
 *  platforms like Caffena's serve the same article under multiple
 *  slugs (an SEO-friendly canonical that 301s to a legacy storage
 *  slug); the body_html links to the canonical, our scraper stored
 *  the redirect target, the strict map can't bridge the gap. Token
 *  overlap between the href's slug + the article's title closes it
 *  with no network round-trip and acceptable false-positive risk
 *  (we require ≥3 distinct overlapping tokens AND a strict winner —
 *  no tie at the top of the score table).
 *
 *  Skips when:
 *    • currentRoasterSlug is null (we don't fuzzy-match across
 *      roasters; that's a wider net with more false-positive risk)
 *    • the href has no parseable last-path-segment
 *    • the slug yields fewer than 3 content tokens after stopword
 *      filtering (too low signal)
 *    • two or more articles tie for the top score (ambiguous)
 *
 *  Returns the matched RoasterArticle or null. */
function findFuzzyArticleMatch(
  href: string | null | undefined,
  currentRoasterSlug: string | null,
  articlesByRoaster: Map<string, RoasterArticle[]>,
): RoasterArticle | null {
  if (!href || !currentRoasterSlug) return null;
  let path: string;
  try {
    const u = new URL(href, "https://crema.placeholder/");
    path = u.pathname;
  } catch {
    return null;
  }
  const lastSeg = path.replace(/\/+$/, "").split("/").pop() || "";
  const slugTokens = fuzzyTokens(lastSeg);
  // ≥1 distinguishing token after the expanded noise filter. Most
  // body-prose links to sibling articles use short SEO slugs (e.g.
  // `what-is-arabica`, `what-is-specialty-coffee`); after dropping
  // "what" + "coffee" + "is", the slug typically yields one strong
  // subject token (`arabica`, `specialty`). The strict-winner gate
  // below keeps the false-positive surface narrow even at low
  // threshold — a 1-token match resolves only when EXACTLY one
  // same-roaster article carries that token in title or slug.
  if (slugTokens.size < 1) return null;

  const candidates = articlesByRoaster.get(currentRoasterSlug);
  if (!candidates || candidates.length === 0) return null;

  let best: RoasterArticle | null = null;
  let bestScore = 0;
  let bestTie = false;
  for (const a of candidates) {
    // Score with title weighted 2x slug. Caffena's CMS occasionally
    // serves an article under a URL whose slug references a
    // DIFFERENT article's subject (e.g. article 1218 "Arabica
    // Coffee Guide" is stored at URL `…/news-specialty-coffee-a-
    // complete-guide-…` — a 301-alias artifact). Slug-only
    // matching ties such articles with the article that actually
    // discusses the subject; title-weighting breaks the tie in
    // favor of the one whose own subject matches.
    const titleTokens = fuzzyTokens(a.title);
    const articleLastSeg = (a.url || "")
      .replace(/\/+$/, "")
      .split("/")
      .pop() || "";
    const slugSetTokens = fuzzyTokens(articleLastSeg);
    let score = 0;
    for (const tok of slugTokens) {
      if (titleTokens.has(tok)) score += 2;
      else if (slugSetTokens.has(tok)) score += 1;
    }
    if (score < 1) continue;
    if (score > bestScore) {
      bestScore = score;
      best = a;
      bestTie = false;
    } else if (score === bestScore) {
      bestTie = true;
    }
  }
  if (bestTie) return null;
  return best;
}

/** Resolve a `/products/<slug>` href against the same roaster's
 *  catalog by slug-prefix overlap. Closes the Shopify-canonical
 *  mismatch: Caffena links to `/products/newton` in body prose
 *  while their catalog stores the canonical `/products/newton-100-
 *  arabica`. The roaster's own 301 bridges the two on their site,
 *  but our strict-URL map sees them as different keys.
 *
 *  Strategy: take the href's last path segment, find every same-
 *  roaster product whose own slug last-segment starts with or is
 *  the prefix of the href's slug (whichever matches a shared
 *  TOKEN-LEVEL prefix). Require a single unambiguous winner;
 *  bail on ties.
 *
 *  Skips when:
 *    • currentRoasterSlug is null (no cross-roaster fuzzy matches)
 *    • the href doesn't look like a product link
 *      (`/products/<slug>` in pathname)
 *    • the slug has no content tokens after stopword filter
 *    • two or more catalog products tie for prefix overlap
 *
 *  Returns the matched product row or null. */
function findFuzzyProductMatch(
  href: string | null | undefined,
  currentRoasterSlug: string | null,
  productsByRoaster: Map<string, any[]>,
): any | null {
  if (!href || !currentRoasterSlug) return null;
  let path: string;
  try {
    const u = new URL(href, "https://crema.placeholder/");
    path = u.pathname.toLowerCase();
  } catch {
    return null;
  }
  // Only consider /products/<slug> paths — keep article + collection
  // hrefs out of this matcher (those have their own resolvers).
  const m = path.match(/\/products\/([^/]+)$/);
  if (!m) return null;
  const hrefSlug = m[1];
  const hrefTokens = hrefSlug
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !FUZZY_STOPWORDS.has(t));
  if (hrefTokens.length === 0) return null;

  const candidates = productsByRoaster.get(currentRoasterSlug);
  if (!candidates || candidates.length === 0) return null;

  // Score every product by token-prefix overlap. The hrefSlug's
  // tokens must appear as a contiguous head of the product's own
  // slug tokens — `newton` matches `newton-100-arabica` (head),
  // not `100-arabica-newton` (tail) — to keep the false-positive
  // surface narrow.
  let best: any = null;
  let bestScore = 0;
  let bestTie = false;
  for (const p of candidates) {
    const pUrl = p?.product_url;
    if (!pUrl) continue;
    let pPath: string;
    try {
      pPath = new URL(pUrl).pathname.toLowerCase();
    } catch {
      continue;
    }
    const pm = pPath.match(/\/products\/([^/]+)$/);
    if (!pm) continue;
    const pSlug = pm[1];
    const pTokens = pSlug
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 3 && !FUZZY_STOPWORDS.has(t));
    if (pTokens.length === 0) continue;
    // Head-prefix score: number of consecutive matching tokens
    // starting from index 0.
    let score = 0;
    for (let i = 0; i < hrefTokens.length && i < pTokens.length; i++) {
      if (hrefTokens[i] === pTokens[i]) score += 1;
      else break;
    }
    if (score < 1) continue;
    if (score > bestScore) {
      bestScore = score;
      best = p;
      bestTie = false;
    } else if (score === bestScore) {
      bestTie = true;
    }
  }
  if (bestTie) return null;
  return best;
}

/** Lowercase host, strip `www.`, drop trailing slash, drop query +
 *  fragment. The two failure modes we've seen: (1) Caffena's prose
 *  links to a product URL with a trailing slash while our catalog
 *  ingestion stores it without; (2) Shopify article-card links
 *  carry `?_pos=2&_sid=…` tracking params that the canonical
 *  product URL doesn't. Both are eliminated by this canonicalisation.
 *  Returns null for unparseable / non-http hrefs. */
function canonicaliseUrl(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  try {
    // Resolve protocol-relative + path-only links against a sentinel
    // origin so URL parsing succeeds; we strip the origin back out
    // when comparing absolute URLs come straight through.
    const u = new URL(s, "https://crema.placeholder/");
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    let host = u.host.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    if (host === "crema.placeholder") return null; // unresolvable relative
    let path = u.pathname.replace(/\/+$/, "");
    if (path === "") path = "/";
    return `${host}${path}`;
  } catch {
    return null;
  }
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
  // No-hero variant: just enough chrome height to clear the back FAB
  // (which is 36px tall, top-anchored at 16px). 64px keeps the FAB
  // away from both the page top and the title below, with no visible
  // empty rectangle. The page bg shows through — no fill, no
  // contrast band, no "broken image" feeling.
  heroAbsentChrome: {
    width: "100%" as any,
    height: 64,
    position: "relative",
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
  // Video block — 16:9 thumbnail frame + centered play disc + caption
  // strip. Mirrors the image block's margin / centering so the video
  // sits as a peer of every other inline media. The play disc is the
  // 52-px FAB language (cream-info disc, primary-color play glyph).
  // YouTube `hqdefault.jpg` is 480×360 4:3 with 45-px letterbox bars
  // top + bottom; `contentFit: "cover"` in the 16:9 frame crops
  // exactly those bars, leaving only the content area visible.
  videoBlock: {
    alignSelf: "center",
    marginVertical: t.spacing.sm,
    gap: t.spacing.xs,
  } as any,
  videoFrame: {
    position: "relative",
    borderRadius: t.radius.lg,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color["card.info"],
  } as any,
  videoThumbFallback: {
    backgroundColor: t.color["card.info"],
  } as any,
  videoPlayWrap: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  } as any,
  videoPlayDisc: {
    width: 52,
    height: 52,
    borderRadius: 26,
    // Always-cream identity surface so the disc reads as a clear
    // affordance on any thumbnail behind it, light OR dark mode.
    // `card.info` collapses to the page-body Espresso in dark mode
    // and the disc would melt into a dark thumbnail.
    backgroundColor: t.color["bg.identity"],
    alignItems: "center",
    justifyContent: "center",
  } as any,
  videoCaption: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    paddingTop: t.spacing.xs,
  } as any,
  videoCaptionText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
  } as any,
  adslot: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: t.spacing.xl,
  } as any,
  adslotMark: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.lg"],
    color: t.color["text.muted"],
    letterSpacing: 4,
  } as any,
  // Inline run formatting. The parent block-level <Text> sets the
  // base color/family/size; child <Text>s only override what they
  // need. Bold swaps the family to body.semibold (Inter SemiBold) —
  // the existing ladder slot for emphasized body text. Italic uses
  // fontStyle since Inter ships an italic synthetic on RN. Links
  // use accent (Crema pink) per DESIGN_LANGUAGE — pink is the
  // engagement color, and tapping a link IS an engagement action.
  runBold: {
    fontFamily: t.font["body.semibold"],
  } as any,
  runItalic: {
    fontStyle: "italic",
  } as any,
  runLink: {
    color: t.color["accent.cta"],
    textDecorationLine: "underline",
  } as any,
  runLinkInherit: {
    // Headings already in display font and primary color — the link
    // gets an underline but inherits color so it doesn't look
    // louder than its own heading.
    textDecorationLine: "underline",
  } as any,
  // Inline embeds — coffee carousel + journal callout. Sits below
  // the referencing paragraph, leans editorial: small uppercase
  // label, then the cards/callout. Margin top tightens the visual
  // tie to the paragraph above.
  embedWrap: {
    marginTop: t.spacing.sm,
    marginBottom: t.spacing.sm,
    gap: t.spacing.sm,
  } as any,
  embedLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    letterSpacing: 1.2,
    textTransform: "uppercase",
    color: t.color["text.muted"],
  } as any,
  // Bucket-level cause line — reads under the label when every card
  // in the carousel has the same attribution_cause. Lower-emphasis
  // than the label (body.regular vs body.semibold, no caps) so it
  // reads as supporting context, not a header.
  embedCause: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    marginTop: -t.spacing.xs,
  } as any,
  // Per-card cause line — renders BELOW each CoffeeCard when the
  // carousel has mixed causes across its cards. Constrained to the
  // card's width so the explanation lines up with the bag it's
  // describing.
  embedCausePerCard: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    marginTop: t.spacing.xs,
    paddingHorizontal: 4,
  } as any,
  // Journal callout — a calm framed card the reader taps to jump
  // to the referenced article. Border + cream surface, text aligned
  // left with an arrow indicator on the right.
  articleCallout: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.color.border,
    backgroundColor: t.color["card.subtle"],
  } as any,
  articleCalloutTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    lineHeight: 20,
    color: t.color["text.primary"],
  } as any,
  // Encircled forward-arrow on the callout — matches the article
  // reader's back-button language (36-px Crema-pink disc with an
  // Espresso glyph). Keeps the "engagement = pink" semantic
  // consistent: tapping a back arrow leaves, tapping a forward
  // arrow continues to the next read.
  articleCalloutArrowDisc: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.color["accent.cta"],
    alignItems: "center",
    justifyContent: "center",
  } as any,
  articleCalloutMeta: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    marginTop: 2,
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
