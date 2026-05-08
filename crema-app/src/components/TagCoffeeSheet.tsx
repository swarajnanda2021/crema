/**
 * TagCoffeeSheet — bottom-slide sheet that opens when the user taps
 * "Tag a coffee" inside the focus-mode composer. Matches Figma
 * 895:415 (Crema – Tag a Coffee Search Slider).
 *
 * Three horizontally-scrolling rails of the redesigned simple
 * coffee mini-card (name + roaster only — no price, flavour notes,
 * Buy/Cart, social dot). The rails are populated from:
 *
 *   • Recent coffees — the user's most-recently-clicked products
 *     (sourced from `click_events`, deduped by product_id, newest
 *     first).
 *   • Open Bags — the user's `open_bags` shelf entries.
 *   • On the List — the user's `on_the_list` shelf entries.
 *
 * The user can tap any card to tag that coffee, OR type into the
 * search bar. Search-typing behaviour is unwired — the user will
 * dictate the next-step UX once this slider matches the Figma
 * spec exactly.
 *
 * Layout values are LITERAL to Figma 895:415 per CLAUDE.md "Hard
 * rule — Figma is literal":
 *
 *   • Backdrop scrim: `#684F44` Dull Brown at 60% opacity, mix-
 *     blend multiply (warm scrim, not the generic black-translucent
 *     overlay). On native we approximate the multiply effect with
 *     plain alpha on the same warm brown — visually close enough
 *     and `mix-blend-mode` is web-only anyway.
 *   • Sheet: 1 px below the scrim's top, full width, top corners
 *     20-px radius, fill `bg` (Crema White light / dark page in
 *     dark mode).
 *   • Drag handle: 60×6 pill at top centre, y=16, bg `border`
 *     (Dark Beige), borderRadius 10. Tappable + closes the sheet.
 *   • Hairline divider at y=84.
 *   • Search bar: 351×38 pill at x=20 / y=34, bg `card.product.bg`
 *     (constant cream/white), borderRadius 20. Magnifying glass
 *     20×20 at x=32 / y=43; placeholder "Search by coffee or
 *     roaster" Inter Medium 14.5 / 18 in `text.muted`.
 *   • Section labels Inter Medium 12 in `text.secondary` at x=21,
 *     y=99 / y=350 / y=601.
 *   • Carousel rails: 369-wide × 200-tall at x=21, y=123 /
 *     y=374 / y=625.
 *
 * Mini-card geometry (Figma 895:424 et al):
 *   • 145.745 × 199.584 (rounded to 146 × 200 in code), bg
 *     `card.info` (Beige #EFE9DB), borderRadius 5.
 *   • Image 130.52 × 117.47 at x=7.61 / y=7.61, borderRadius 5,
 *     white fallback.
 *   • Title: New Spirit Regular 13, Espresso, multi-line, x=7.22
 *     / y=133.06.
 *   • Inner divider 89.731 px at x=7.61 / y=174.47, color
 *     `text.secondary`.
 *   • Subtitle: Inter Medium 7.5, `text.secondary`, x=7.61 /
 *     y=180.12, single line, ellipsis on overflow.
 *
 * Cards are 7-px apart in the rail (152.75 - 145.745 = 7.005).
 */

import { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Image } from "expo-image";
import { Search } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { apiFetchRaw, resolveUploadUrl } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { useCoffeeData } from "../hooks/useCoffeeData";
import { useShelves } from "../hooks/useShelves";
import { t, makeStyles } from "../tokens/useTokens";
import { thumbnailUrl } from "../utils/imageUrl";
import { tap as hapticTap } from "../utils/haptics";

// Card dimensions — LITERAL Figma 895:438 frame (145.745 × 199.584).
// We don't round; sub-pixel positioning preserves the 7-px gap math
// (152.75 - 145.745 = 7.005) the Figma layout assumes.
const CARD_W = 145.745;
const CARD_H = 199.584;
const CARD_GAP = 7;

interface Coffee {
  product_id: string;
  coffee_name: string;
  roaster_name?: string;
  hero_image?: string | null;
  image_url?: string | null;
}

const SEARCH_LIMIT = 30;

interface TagCoffeeSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (coffee: Coffee) => void;
}

export default function TagCoffeeSheet({
  visible,
  onClose,
  onSelect,
}: TagCoffeeSheetProps) {
  const { user } = useAuth();
  // `useCoffeeData` exposes `productMap` for keyed lookups (used to
  // hydrate shelf entries) AND `products` for the raw list (used to
  // run the live search filter when the user types).
  const { productMap, products } = useCoffeeData() as any;
  const { shelves, fetchShelves } = useShelves();
  const insets = useSafeAreaInsets();
  const [recent, setRecent] = useState<Coffee[]>([]);
  const [search, setSearch] = useState("");
  const s = useStyles();

  // Trim + lowercase once per render. Empty query → carousels mode;
  // any non-empty query → search-results list mode (Figma 895:1199).
  const query = search.trim().toLowerCase();
  const isSearching = query.length > 0;
  const searchResults: Coffee[] = isSearching
    ? ((products as Coffee[]) || [])
        .filter((p) => {
          const name = (p.coffee_name || "").toLowerCase();
          const roaster = (p.roaster_name || "").toLowerCase();
          return name.includes(query) || roaster.includes(query);
        })
        .slice(0, SEARCH_LIMIT)
    : [];

  // Single Animated.Value driving the sheet's translateY directly,
  // so a finger drag, a programmatic close, and the open spring all
  // operate on the same animated property. `0` = resting (sheet
  // fully open), `900` = fully off-screen (a generic large number
  // that exceeds any reasonable viewport height — the sheet's
  // `bottom: 0` clips overshoot).
  const sheetY = useRef(new Animated.Value(900)).current;
  const [mounted, setMounted] = useState(visible);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.spring(sheetY, {
        toValue: 0,
        useNativeDriver: true,
        bounciness: 4,
        speed: 16,
      }).start();
    } else if (mounted) {
      Animated.timing(sheetY, {
        toValue: 900,
        duration: 220,
        useNativeDriver: true,
        easing: Easing.out(Easing.cubic),
      }).start(({ finished }) => {
        if (finished) setMounted(false);
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Drag-to-dismiss on the handle. Tracks finger movement; updates
  // sheetY directly during drag so the sheet follows the finger.
  // On release: if the user dragged down past the threshold OR
  // released with a downward fling, dismiss; otherwise spring back
  // to resting. A small finger movement (< 5 pt) is treated as a
  // tap and also dismisses (preserves the original tap-to-close).
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 2,
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) sheetY.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        const traveled = Math.abs(gs.dy);
        const isFling = gs.vy > 0.5;
        const pastThreshold = gs.dy > 100;
        if (pastThreshold || isFling || traveled < 5) {
          onClose();
        } else {
          Animated.spring(sheetY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 4,
            speed: 16,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(sheetY, {
          toValue: 0,
          useNativeDriver: true,
          bounciness: 4,
          speed: 16,
        }).start();
      },
    }),
  ).current;

  // Refresh shelf + recent-clicks data each time the sheet opens —
  // the user may have shelved a coffee since the last open.
  useEffect(() => {
    if (!visible) return;
    fetchShelves();
    fetchRecent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function fetchRecent() {
    if (!user?.id || !productMap) {
      setRecent([]);
      return;
    }
    try {
      // `/my-recent-clicks` is the /me-scoped read path for click
      // history — `click_events` is `write_only: True` in the
      // registry, so the registry's auto-generated `/filter` route
      // doesn't exist. The endpoint already deduplicates by
      // `product_id` (most-recent click wins) and orders newest-
      // first server-side; we just hydrate via the productMap.
      const raw: any = await apiFetchRaw(`/my-recent-clicks?limit=12`);
      const data = raw?.data ?? raw;
      const list = Array.isArray(data) ? data : [];
      const ordered: Coffee[] = [];
      for (const ev of list) {
        const product = productMap.get?.(String(ev.product_id));
        if (product?.coffee_name) ordered.push(product as Coffee);
      }
      setRecent(ordered);
    } catch {
      setRecent([]);
    }
  }

  // Hydrate shelf-entry product details from the shared catalog.
  // `shelves[key]` carries `{ id, product_id }` rows; we look up
  // each product in the productMap so the mini-card has a name +
  // roaster + hero to render.
  const hydrate = (entries: any[]): Coffee[] =>
    (entries || [])
      .map((entry: any) => productMap?.get?.(entry.product_id))
      .filter((c: any) => c?.coffee_name)
      .filter(
        (c: any, i: number, arr: any[]) =>
          arr.findIndex((x: any) => x.product_id === c.product_id) === i,
      );

  const openBags = hydrate(shelves?.open_bags || []);
  const onTheList = hydrate(shelves?.on_the_list || []);

  const onCardPress = (coffee: Coffee) => {
    hapticTap();
    onSelect(coffee);
    onClose();
  };

  if (!mounted) return null;

  // Scrim opacity tracks the sheet position — at rest (sheetY=0)
  // the scrim is fully opaque; as the sheet slides toward 900
  // (off-screen) the scrim fades out in lockstep. This means a
  // finger drag also fades the scrim, which feels right.
  const scrimOpacity = sheetY.interpolate({
    inputRange: [0, 900],
    outputRange: [1, 0],
    extrapolate: "clamp",
  });

  return (
    <Modal
      visible
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={s.host}>
        {/* Backdrop scrim — Figma 895:416. Tap-to-dismiss. */}
        <Animated.View style={[s.scrim, { opacity: scrimOpacity }]}>
          <Pressable
            style={StyleSheet.absoluteFillObject}
            onPress={onClose}
            accessibilityLabel="Close"
          />
        </Animated.View>

        {/* Sheet — slides up from below. Resting top sits below the
            iPhone safe-area + an extra 60-pt peek so the drag handle
            lands inside a thumb's natural reach (not pinned at the
            very top edge of the display) AND the scrim above stays
            visible as a tap-to-dismiss target. The Figma's
            "essentially full height" treatment isn't comfortable on
            real hardware — this offset is the pragmatic adjustment.
            (User feedback §2.40.27.) */}
        <Animated.View
          style={[
            s.sheet,
            { top: insets.top + 60, transform: [{ translateY: sheetY }] },
          ]}
        >
          {/* Drag handle — supports BOTH a tap-to-dismiss and a
              full drag-to-dismiss gesture. PanResponder catches
              the gesture; tap (no movement) and drag-past-
              threshold both end in `onClose()`. */}
          <View
            style={s.dragHandleHit}
            accessibilityLabel="Close"
            accessibilityRole="button"
            {...panResponder.panHandlers}
          >
            <View style={s.dragHandle} />
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Search bar — sits 34 px from the sheet top. */}
            <View style={s.searchWrap}>
              <View style={s.searchBar}>
                <Search
                  size={20}
                  color={t.color["text.muted"] as string}
                  strokeWidth={1.75}
                />
                <TextInput
                  style={s.searchInput}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Search by coffee or roaster"
                  placeholderTextColor={t.color["text.muted"] as string}
                />
              </View>
            </View>

            <View style={s.divider} />

            {/* Two body modes (Figma 895:415 ↔ 895:1199):
                - Empty query: three horizontal carousels (Recent /
                  Open Bags / On the List).
                - Any typed query: vertical list of matching coffees
                  rendered as `SearchResultRow`s. The carousels
                  vanish entirely while the user is typing — only
                  the matches are visible. */}
            {isSearching ? (
              searchResults.length === 0 ? (
                <View style={s.emptyResults}>
                  <Text style={s.emptyText}>
                    No coffees match "{search.trim()}".
                  </Text>
                </View>
              ) : (
                searchResults.map((c, idx) => (
                  <View key={c.product_id}>
                    <SearchResultRow coffee={c} onPress={() => onCardPress(c)} />
                    {idx < searchResults.length - 1 ? (
                      <View style={s.resultDivider} />
                    ) : null}
                  </View>
                ))
              )
            ) : (
              <>
                <Section
                  label="Recent coffees"
                  items={recent}
                  onPress={onCardPress}
                />
                <Section
                  label="Open Bags"
                  items={openBags}
                  onPress={onCardPress}
                />
                <Section
                  label="On the List"
                  items={onTheList}
                  onPress={onCardPress}
                />
              </>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

interface SectionProps {
  label: string;
  items: Coffee[];
  onPress: (c: Coffee) => void;
}

function Section({ label, items, onPress }: SectionProps) {
  const s = useStyles();
  return (
    <View style={s.section}>
      <Text style={s.sectionLabel}>{label}</Text>
      {items.length === 0 ? (
        <View style={s.emptyRail}>
          <Text style={s.emptyText}>Nothing here yet.</Text>
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={s.railContent}
        >
          {items.map((c) => (
            <CoffeeMiniCard
              key={c.product_id}
              coffee={c}
              onPress={() => onPress(c)}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

interface MiniCardProps {
  coffee: Coffee;
  onPress: () => void;
}

/**
 * SearchResultRow — Figma 895:1199 row layout. Used in the
 * search-active state when the user has typed a query.
 *
 * Geometry literal to Figma 895:1440 et al.:
 *   • Image 83 × 83 at x=20, borderRadius 2.
 *   • Text column starts at x=117 (= 20 + 83 + 14-px gap).
 *   • Title Inter Semibold 16 / 20 in `card.product.text`
 *     (constant Espresso). Allows up to 2 lines (matches the
 *     Figma "Ratnagiri Estate – L8 Washed" wrap behaviour).
 *   • Subtitle Inter Medium 12 in `card.product.text.muted`
 *     (constant warm brown). Single line ellipsis.
 *   • Title + subtitle are vertically centered on the image.
 *   • Row total height 119 px; the divider between adjacent rows
 *     sits at the row boundary as a 350-wide hairline.
 */
function SearchResultRow({ coffee, onPress }: MiniCardProps) {
  const s = useStyles();
  const heroSrc =
    coffee.hero_image || coffee.image_url
      ? (() => {
          const raw = (coffee.hero_image || coffee.image_url) as string;
          const resolved = resolveUploadUrl(raw) || raw;
          return thumbnailUrl(resolved, 200) || resolved;
        })()
      : null;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.resultRow, pressed && s.cardPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Tag ${coffee.coffee_name}`}
    >
      <View style={s.resultImage}>
        {heroSrc ? (
          <Image
            source={{ uri: heroSrc }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            transition={150}
          />
        ) : null}
      </View>
      <View style={s.resultText}>
        <Text style={s.resultTitle} numberOfLines={2} ellipsizeMode="tail">
          {coffee.coffee_name}
        </Text>
        <Text style={s.resultRoaster} numberOfLines={1} ellipsizeMode="tail">
          By {coffee.roaster_name || "—"}
        </Text>
      </View>
    </Pressable>
  );
}

function CoffeeMiniCard({ coffee, onPress }: MiniCardProps) {
  const s = useStyles();
  const heroSrc =
    coffee.hero_image || coffee.image_url
      ? (() => {
          const raw = (coffee.hero_image || coffee.image_url) as string;
          const resolved = resolveUploadUrl(raw) || raw;
          return thumbnailUrl(resolved, 320) || resolved;
        })()
      : null;

  // Every child is absolutely positioned at its literal Figma
  // 895:438 offset (image at 7.61 / 7.61, title at 7.22 / 133.06,
  // divider at 7.61 / 174.47, subtitle at 7.61 / 180.12). Stacking
  // via flex was off-by-a-few-pixels because the title's wrap
  // count (1 vs 2 lines) shifted everything below it. Absolute
  // positioning locks the divider + subtitle to the same vertical
  // pixel regardless of title length — matches the Figma exactly.
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.card, pressed && s.cardPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Tag ${coffee.coffee_name}`}
    >
      <View style={s.cardImage}>
        {heroSrc ? (
          <Image
            source={{ uri: heroSrc }}
            style={StyleSheet.absoluteFillObject}
            contentFit="cover"
            transition={200}
          />
        ) : null}
      </View>

      <Text style={s.cardTitle} numberOfLines={2} ellipsizeMode="tail">
        {coffee.coffee_name}
      </Text>

      <View style={s.cardInnerDivider} />

      <Text style={s.cardSubtitle} numberOfLines={1} ellipsizeMode="tail">
        By {coffee.roaster_name || "—"}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  host: { flex: 1 } as any,

  // ── Scrim ───────────────────────────────────────────────────
  // Figma 895:416 — Dull Brown at 60% with mix-blend-multiply.
  // RN doesn't support mix-blend-mode on native; on web we apply
  // the property and on native we accept plain alpha on the same
  // warm brown. Visually it reads as a warm overlay either way.
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(104,79,68,0.6)",
    ...(Platform.OS === "web"
      ? ({ mixBlendMode: "multiply" } as any)
      : {}),
  } as any,

  // ── Sheet ───────────────────────────────────────────────────
  // `top` is set inline by the caller (`insets.top + 60`) so the
  // sheet's resting position sits below the iPhone safe-area with a
  // 60-pt peek of scrim showing above for tap-to-dismiss + handle
  // reachability. The static style provides everything else.
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: t.color.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
  } as any,

  // ── Drag handle ─────────────────────────────────────────────
  // Figma 895:418: handle at y=16, height 6 — bottom edge at y=22.
  // Hit area takes only the top padding so the search bar's
  // `paddingTop: 12` lands the search at exactly y=34 (Figma's
  // 895:610 search-bar top).
  dragHandleHit: {
    alignItems: "center",
    paddingTop: 16,
    paddingBottom: 0,
  } as any,
  dragHandle: {
    width: 60,
    height: 6,
    borderRadius: 10,
    backgroundColor: t.color.divider,
  } as any,

  // ── Search bar ──────────────────────────────────────────────
  // Sheet-top + 16 (handle padTop) + 6 (handle) + 12 (this padTop)
  // = y=34 per Figma 895:610.
  searchWrap: {
    paddingHorizontal: 20,
    paddingTop: 12,
  } as any,
  searchBar: {
    height: 38,
    borderRadius: 20,
    backgroundColor: t.color["card.product.bg"],
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    gap: 7,
  } as any,
  searchInput: {
    flex: 1,
    fontFamily: t.font["body.medium"],
    fontSize: 14.5,
    lineHeight: 18,
    color: t.color["text.primary"],
    ...(Platform.OS === "web" ? { outlineStyle: "none" } : {}),
  } as any,

  // ── Section divider (under search) ──────────────────────────
  // Search bar bottom at y=72 (= 34 + 38). Figma divider at y=84
  // → 12 gap.
  divider: {
    height: 1,
    backgroundColor: t.color.divider,
    marginTop: 12,
  } as any,

  // ── Section + rail ──────────────────────────────────────────
  section: {
    paddingTop: 15,
    paddingBottom: 12,
  } as any,
  sectionLabel: {
    fontFamily: t.font["body.medium"],
    fontSize: 12,
    color: t.color["text.secondary"],
    paddingHorizontal: 21,
    marginBottom: 10,
  } as any,
  railContent: {
    paddingHorizontal: 21,
    gap: CARD_GAP,
  } as any,
  emptyRail: {
    paddingHorizontal: 21,
    paddingVertical: 24,
    alignItems: "flex-start",
  } as any,
  emptyText: {
    fontFamily: t.font["body.regular"],
    fontSize: 13,
    color: t.color["text.muted"],
  } as any,

  // ── Search results (Figma 895:1199) ─────────────────────────
  // Row block 119 tall = 83 px image + 36 px padding distributed
  // around it so the title/subtitle column reads as vertically
  // centered against the image.
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 20,
    paddingVertical: 18, // (119 - 83) / 2 ≈ 18
  } as any,
  resultImage: {
    width: 83,
    height: 83,
    borderRadius: 2,
    backgroundColor: t.color["card.product.bg"],
    overflow: "hidden",
  } as any,
  resultText: {
    flex: 1,
    marginLeft: 14, // gap from image right edge to text column
    justifyContent: "center",
  } as any,
  // Title + roaster use the MODE-FLIPPING `text.primary` /
  // `text.secondary` (NOT the constant `card.product.*` family).
  // The Tag-a-coffee sheet's surface is `t.color.bg`, which is
  // cream in light mode and dark `#2a0d00` in dark mode — text
  // colours have to follow that flip or they read as Espresso-
  // on-dark and disappear (user-reported regression). The flip
  // keeps the title legible at Espresso/CremaWhite in their
  // respective modes.
  resultTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: 16,
    lineHeight: 20,
    color: t.color["text.primary"],
  } as any,
  resultRoaster: {
    fontFamily: t.font["body.medium"],
    fontSize: 12,
    color: t.color["text.secondary"],
    marginTop: 4,
  } as any,
  // 350-wide hairline divider between rows, centered horizontally.
  resultDivider: {
    height: 1,
    backgroundColor: t.color.divider,
    width: 350,
    alignSelf: "center",
  } as any,
  emptyResults: {
    paddingHorizontal: 20,
    paddingVertical: 32,
    alignItems: "flex-start",
  } as any,

  // ── Mini-card ───────────────────────────────────────────────
  // Card frame sized to the Figma literal (145.745 × 199.584).
  // `position: relative` is RN's default but explicit here so the
  // absolute children are unambiguously positioned against this
  // frame.
  card: {
    width: CARD_W,
    height: CARD_H,
    backgroundColor: t.color["card.info"],
    borderRadius: 5,
    position: "relative",
    overflow: "hidden",
  } as any,
  cardPressed: { opacity: 0.92 } as any,
  // Image at Figma (7.61, 7.61) — 130.52 × 117.47, borderRadius 5.
  cardImage: {
    position: "absolute",
    left: 7.61,
    top: 7.61,
    width: 130.52,
    height: 117.47,
    borderRadius: 5,
    backgroundColor: t.color["card.product.bg"],
    overflow: "hidden",
  } as any,
  // Title at Figma (left=7.22, right=7.31, top=133.06). New Spirit
  // Regular 13 with `leading-[normal]` — RN's default lineHeight
  // for this fontSize is ~15, close enough to the Figma render and
  // doesn't shift the divider / subtitle below since those are
  // absolute too.
  cardTitle: {
    position: "absolute",
    left: 7.22,
    right: 7.31,
    top: 133.06,
    fontFamily: t.font.display,
    fontSize: 13,
    lineHeight: 15,
    color: t.color["text.primary"],
  } as any,
  // Inner divider at Figma (left=7.61, top=174.47). The Figma node
  // measured the line at 89.731 px wide, but the user asked for the
  // divider to mirror the card's left padding on the right side too
  // — so we anchor with `left: 7.61` AND `right: 7.61` (no fixed
  // width) and the line spans the full content column (130.525 px,
  // matching the image's width above it). Color is `divider`
  // (= Dark Beige #D7D1C4 in light mode) — the previous
  // `text.secondary` (Dull Brown #684F44) read as too saturated for
  // a hairline.
  cardInnerDivider: {
    position: "absolute",
    left: 7.61,
    right: 7.61,
    top: 174.47,
    height: 1,
    backgroundColor: t.color.divider,
  } as any,
  // Subtitle at Figma (left=7.61, top=180.12). Inter Medium 7.5 in
  // `text.secondary`. `right` mirrors `left` so a long roaster name
  // ellipsises before reaching the card edge.
  cardSubtitle: {
    position: "absolute",
    left: 7.61,
    right: 7.61,
    top: 180.12,
    fontFamily: t.font["body.medium"],
    fontSize: 7.5,
    color: t.color["text.secondary"],
  } as any,
}));
