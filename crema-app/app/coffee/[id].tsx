import { useEffect, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, Platform, useWindowDimensions } from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import { openExternal } from "../../src/utils/openExternal";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useShare } from "../../src/hooks/useShare";
import { apiFetchRaw, trackClick } from "../../src/api/client";
import { t, cardShadow, makeStyles } from "../../src/tokens/useTokens";
import { ShareIcon, CartIcon } from "../../src/components/icons/FigmaIcons";
import Chip from "../../src/components/Chip";
import CoffeeCard, {
  CARD_TARGET_WIDTH,
  coffeeCardHeight,
} from "../../src/components/CoffeeCard";
import { useBreakpoint } from "../../src/hooks/useBreakpoint";
import { tap as hapticTap } from "../../src/utils/haptics";
import SiteHeader from "../../src/components/SiteHeader";
import BrewMethodCard from "../../src/components/BrewMethodCard";
import type { BrewMethod } from "../../src/resources/types";

// Brew-recommendation helpers — parse the JSON the enricher stores
// alongside each product. Mirrors the prior CoffeeDetailSheet impl;
// kept inline because they have no other consumers.
interface BrewRec {
  method?: string | null;
  dose_grams?: number | null;
  ratio?: string | null;
  water_temp_celsius?: number | null;
  notes?: string | null;
}

function parseBrew(raw: any): BrewRec | null {
  if (!raw) return null;
  if (typeof raw === "object") return raw as BrewRec;
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* fall through */
    }
  }
  return null;
}

function parseFlavorNotes(raw: any): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === "string");
  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[")) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
      } catch {
        /* fall through */
      }
    }
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function methodLabel(key: string | null | undefined): string {
  if (!key) return "";
  const map: Record<string, string> = {
    espresso: "Espresso",
    pour_over: "Pour-over",
    aeropress: "AeroPress",
    french_press: "French press",
    cold_brew: "Cold brew",
    moka: "Moka pot",
    siphon: "Siphon",
    turkish: "Turkish",
    south_indian_filter: "South Indian filter",
    other: "Other",
  };
  return map[key] || key.replace(/_/g, " ");
}

/** Canela lining numerals */
const canelaNumeral = Platform.OS === "web"
  ? ({ fontFeatureSettings: "'lnum' 1, 'pnum' 1" } as any)
  : ({ fontVariant: ["lining-nums", "proportional-nums"] } as any);

// All three floating/inline action discs on this page render at the
// same 36-px diameter — back FAB top-left, share top-right, buy
// next to the price. Consistency across the page chrome matters
// more than parity with the card's BTN_SIZE=31 (the card's icons
// sit inside a tighter 240-px frame; the page has more breathing
// room and the back FAB sets the size convention here).
const BTN_SIZE = 36;

export default function CoffeeDetailPage() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { productMap, products } = useCoffeeData();
  const { share } = useShare();
  const router = useRouter();
  const { isMobile } = useBreakpoint();
  const { width: vpWidth } = useWindowDimensions();

  const coffee = productMap?.get(id);
  const st = useStStyles();
  // Phase 1 §2.5 — roaster-submitted brew recipe cards for this product.
  const [brewMethods, setBrewMethods] = useState<BrewMethod[]>([]);
  useEffect(() => {
    if (!id) return;
    apiFetchRaw<any>(`/products/${id}/brew_methods?limit=20`)
      .then((res) => {
        const data = res?.data ?? res;
        setBrewMethods(Array.isArray(data) ? data : []);
      })
      .catch(() => setBrewMethods([]));
  }, [id]);

  if (!coffee) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <SiteHeader />
        <View style={st.notFound}>
          <Text style={{ fontFamily: t.font["body.regular"], color: t.color["text.secondary"] }}>Coffee not found</Text>
        </View>
      </>
    );
  }

  const related = products.filter((p: any) => p.roaster_slug === coffee.roaster_slug && p.product_id !== coffee.product_id).slice(0, 6);

  // Price uses the canonical card formula: `price_inr` + `weight_grams`
  // verbatim, the same way `<CoffeeLabelPrice>` renders on the card
  // front. Don't recompute as price-per-250g here \u2014 when a roaster
  // sells a 200 g pouch at \u20B9900, the card shows "\u20B9900 / 200 g" and
  // the page must match. The retired pricePer250g call returned NULL
  // when `price_per_gram` wasn't set (most rows) and the page rendered
  // an em-dash placeholder while the card showed the real number.
  const hasPrice = coffee.price_inr != null && coffee.price_inr > 0;
  const handleBack = () => {
    hapticTap();
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/browse" as any);
  };

  return (
    <>
      {/* Override the layout's `headerShown: false` so SiteHeader
         (Navbar on web, MobileHeader on narrow) renders above the
         page \u2014 same chrome pattern /article/[id] and /roaster/[slug]
         use. The MobileFooter mounts globally inside the root layout,
         so the bottom tab bar is already in place. */}
      <Stack.Screen options={{ headerShown: false }} />
      <SiteHeader />
      <ScrollView testID="coffee-detail-screen" style={st.container} showsVerticalScrollIndicator={false}>
        {/* Hero chrome \u2014 back FAB top-left, share top-right. Mirror
            corners, same 36-px disc size, distinct fills:
              \u2022 back: Crema-pink (primary navigation)
              \u2022 share: cream FigmaIcons.ShareIcon (secondary)
            Buy lives next to the price below \u2014 the cart belongs in
            the price context where weight + roaster info give it
            buying meaning, not floating on the photo. */}
        {coffee.image_url ? (
          <View style={st.heroWrap}>
            <Image source={{ uri: coffee.image_url }} style={st.heroImage} contentFit="cover" />
            <Pressable
              onPress={handleBack}
              style={st.backFloating}
              accessibilityLabel="Back"
              hitSlop={8}
            >
              <ArrowLeft
                size={18}
                color={t.color["text.on-cta"]}
                strokeWidth={2}
              />
            </Pressable>
            <Pressable
              onPress={() => share(coffee)}
              style={({ pressed }) => [st.shareFloating, pressed && st.actionPressed]}
              accessibilityLabel="Share this coffee"
              hitSlop={8}
            >
              <ShareIcon size={BTN_SIZE} />
            </Pressable>
          </View>
        ) : (
          <View style={st.heroAbsentChrome}>
            <Pressable
              onPress={handleBack}
              style={st.backFloating}
              accessibilityLabel="Back"
              hitSlop={8}
            >
              <ArrowLeft
                size={18}
                color={t.color["text.on-cta"]}
                strokeWidth={2}
              />
            </Pressable>
            <Pressable
              onPress={() => share(coffee)}
              style={({ pressed }) => [st.shareFloating, pressed && st.actionPressed]}
              accessibilityLabel="Share this coffee"
              hitSlop={8}
            >
              <ShareIcon size={BTN_SIZE} />
            </Pressable>
          </View>
        )}

        <View style={st.body}>
          {/* Title + roaster */}
          <Text style={st.title}>{coffee.coffee_name}</Text>
          <Pressable onPress={() => router.push(`/roaster/${coffee.roaster_slug}`)}>
            <Text style={st.roasterLink}>By {coffee.roaster_name}</Text>
          </Pressable>

          {/* Chips */}
          <View style={st.chipRow}>
            {coffee.roast_level && coffee.roast_level !== "Unknown" && <Chip>{coffee.roast_level}</Chip>}
            {coffee.process && <Chip>{coffee.process}</Chip>}
          </View>

          {/* Price + Buy. Buy is a Crema-pink 36-px CartIcon disc \u2014
              same size as the back FAB and the floating share, so
              all three action discs on this page read as one button
              language. The card front uses the default Espresso
              CartIcon because its info panel is constant beige; on
              this page the bg flips with light/dark mode and only
              Crema pink reads cleanly against either tone. */}
          <View style={st.priceRow}>
            <View style={{ flex: 1, minWidth: 0 }}>
              {hasPrice ? (
                <View style={st.priceLine}>
                  <Text style={st.price}>
                    {`\u20B9${coffee.price_inr.toLocaleString("en-IN")}`}
                  </Text>
                  {coffee.weight_grams ? (
                    <Text style={st.priceWeight}>{` / ${coffee.weight_grams} g`}</Text>
                  ) : null}
                </View>
              ) : null}
            </View>
            <Pressable
              testID="coffee-detail-buy"
              onPress={() => {
                if (!coffee.product_url) return;
                trackClick(coffee.product_id, coffee.roaster_slug, "coffee_page");
                openExternal(coffee.product_url);
              }}
              disabled={!coffee.product_url}
              style={({ pressed }) => [
                pressed && st.actionPressed,
                !coffee.product_url && st.actionDisabled,
              ]}
              accessibilityLabel="Buy this coffee on the roaster's site"
              hitSlop={8}
            >
              <CartIcon
                size={BTN_SIZE}
                fill={t.color["accent.cta"]}
                glyph={t.color["text.on-cta"]}
              />
            </Pressable>
          </View>

          {/* Divider */}
          <View style={st.divider} />

          {/* Rich detail sections — ported from the retired
              CoffeeDetailSheet long-press modal so the full page
              carries every field the enrichment pipeline filled.
              Sections collapse silently when empty. */}
          {(() => {
            const c: any = coffee;
            const roasterBlurb = (c.roaster_blurb || "").toString().trim();
            const origin = (c.origin || "").toString().trim();
            const cityState = [c.roaster_city, c.roaster_state].filter(Boolean).join(", ");
            const altitude = c.altitude_masl;
            const producer = (c.producer || "").toString().trim();
            const varietal = (c.varietal || "").toString().trim();
            const beanType = (c.bean_type || "").toString().trim();

            const roastVerbatim = (c.roast_level_name || "").toString().trim();
            const roastBucket = (c.roast_level || "").toString().trim();
            const processRaw = (c.process_raw || c.process || "").toString().trim();

            const brew = parseBrew(c.brew_recommendation_json || c.brew_recommendation);
            const tastingNotes = (c.tasting_notes || "").toString().trim();
            const flavorNotes = parseFlavorNotes(c.flavor_notes);
            const weight = c.weight_grams;

            const showOrigin = !!(origin || cityState || altitude || producer || varietal || beanType);
            const showRoastProcess = !!(roastVerbatim || roastBucket || processRaw);
            const showBrew =
              !!brew && !!(brew.method || brew.dose_grams || brew.ratio || brew.water_temp_celsius || brew.notes);
            const showTasting = !!(tastingNotes || flavorNotes.length > 0);
            const showPack = !!weight;

            return (
              <View style={st.sectionStack}>
                {roasterBlurb ? (
                  <View style={st.section}>
                    <Text style={st.sectionLabel}>About this coffee</Text>
                    <Text style={st.prose}>{roasterBlurb}</Text>
                  </View>
                ) : null}

                {showOrigin ? (
                  <View style={st.section}>
                    <Text style={st.sectionLabel}>Origin</Text>
                    {origin ? <Field label="Estate / region" value={origin} /> : null}
                    {cityState ? <Field label="Roastery" value={cityState} /> : null}
                    {altitude ? <Field label="Altitude" value={`${altitude} m`} /> : null}
                    {producer ? <Field label="Producer" value={producer} /> : null}
                    {varietal ? <Field label="Varietal" value={varietal} /> : null}
                    {beanType ? <Field label="Bean type" value={beanType} /> : null}
                  </View>
                ) : null}

                {showRoastProcess ? (
                  <View style={st.section}>
                    <Text style={st.sectionLabel}>Roast & process</Text>
                    {roastVerbatim ? (
                      <Field
                        label="Roast"
                        value={roastVerbatim}
                        hint={roastBucket && roastBucket !== roastVerbatim ? roastBucket : undefined}
                      />
                    ) : roastBucket ? (
                      <Field label="Roast" value={roastBucket} />
                    ) : null}
                    {processRaw ? <Field label="Process" value={processRaw} /> : null}
                  </View>
                ) : null}

                {showBrew && brew ? (
                  <View style={st.section}>
                    <Text style={st.sectionLabel}>Brew guide</Text>
                    {brew.method ? <Field label="Method" value={methodLabel(brew.method)} /> : null}
                    {brew.dose_grams ? <Field label="Dose" value={`${brew.dose_grams} g`} /> : null}
                    {brew.ratio ? <Field label="Ratio" value={brew.ratio} /> : null}
                    {brew.water_temp_celsius ? (
                      <Field label="Water temp" value={`${brew.water_temp_celsius} °C`} />
                    ) : null}
                    {brew.notes ? <Text style={[st.prose, st.brewNote]}>{brew.notes}</Text> : null}
                  </View>
                ) : null}

                {showTasting ? (
                  <View style={st.section}>
                    <Text style={st.sectionLabel}>Tasting</Text>
                    {tastingNotes ? <Text style={st.prose}>{tastingNotes}</Text> : null}
                    {flavorNotes.length > 0 ? (
                      <View style={st.flavorChipRow}>
                        {flavorNotes.map((fn, i) => (
                          <View key={`${fn}-${i}`} style={st.flavorChip}>
                            <Text style={st.flavorChipText}>{fn}</Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </View>
                ) : null}

                {showPack ? (
                  <View style={st.section}>
                    <Text style={st.sectionLabel}>Pack</Text>
                    <Field label="Weight" value={`${weight} g`} />
                  </View>
                ) : null}
              </View>
            );
          })()}

          {/* Brew recipes — roaster-submitted (§2.5) */}
          {brewMethods.length > 0 && (
            <View style={st.relatedSection}>
              <Text style={st.relatedTitle}>Recommended recipes from the roaster</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {brewMethods.map((b) => (
                  <View key={b.id} style={{ width: 240, marginRight: 20 }}>
                    <BrewMethodCard brew={b} width={240} height={300} />
                  </View>
                ))}
              </ScrollView>
            </View>
          )}

          {/* Related coffees — exact Discover BEANS cell dims so the
              card here renders identically. Mobile = viewport - 32
              (1-col, edge-to-edge minus GRID_PAD); wide = canonical
              240. coffeeCardHeight() picks the right aspect by
              viewport so the wrapper never reserves dead space. */}
          {related.length > 0 && (() => {
            const cardW = isMobile ? vpWidth - 32 : CARD_TARGET_WIDTH;
            const cardH = coffeeCardHeight(cardW, isMobile);
            return (
              <View style={st.relatedSection}>
                <Text style={st.relatedTitle}>More from {coffee.roaster_name}</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  {related.map((r: any) => (
                    <View
                      key={r.product_id}
                      style={{ width: cardW, height: cardH, marginRight: 20 }}
                    >
                      <CoffeeCard coffee={r} width={cardW} height={cardH} />
                    </View>
                  ))}
                </ScrollView>
              </View>
            );
          })()}
        </View>
        <View style={{ height: 100 }} />
      </ScrollView>
    </>
  );
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const f = useFieldStyles();
  return (
    <View style={f.field}>
      <Text style={f.fieldLabel}>{label}</Text>
      <Text style={f.fieldValue}>{value}</Text>
      {hint ? <Text style={f.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

const useStStyles = makeStyles((t) => ({
  notFound: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.color.bg },
  container: { flex: 1, backgroundColor: t.color.bg },
  // Hero geometry mirrors /article/[id] — full-bleed image + a
  // floating back FAB pinned to top-left. The 320-px height matches
  // a comfortable wide-aspect crop without dominating the viewport
  // on tall mobile screens.
  heroWrap: {
    width: "100%" as any,
    height: 320,
    backgroundColor: t.color["card.info"],
    position: "relative",
  } as any,
  heroImage: { width: "100%" as any, height: 320 },
  // No-hero variant: just enough chrome height to clear the back FAB
  // (36 px tall, anchored 16 from top). Same pattern as /article/[id]
  // for an article without a hero.
  heroAbsentChrome: {
    width: "100%" as any,
    height: 64,
    position: "relative",
  } as any,
  // Floating back FAB — `accent.cta` Crema-pink fill + `text.on-cta`
  // Espresso glyph. Per DESIGN_LANGUAGE §1, pink is reserved for
  // actionable surfaces; the back affordance qualifies (it's the
  // primary navigation action on the page) and pink reads against
  // any hero photo in both modes (an Espresso fill loses contrast on
  // dark heroes; a cream fill loses contrast on cream heroes).
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
  // Floating share — mirrors the back FAB on the opposite corner.
  // Same 36-px size; cream FigmaIcons.ShareIcon (the icon already
  // ships its own disc background, so no extra wrapper styling).
  shareFloating: {
    position: "absolute",
    top: 16,
    right: 16,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  } as any,
  body: {
    maxWidth: 1000,
    alignSelf: "center" as any,
    width: "100%" as any,
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.xl,
  } as any,
  title: {
    fontFamily: t.font.display,
    fontSize: t.size["font.display"],
    color: t.color["text.primary"],
    lineHeight: 38,
    ...canelaNumeral,
  } as any,
  roasterLink: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    marginTop: t.spacing.xs,
    color: t.color["text.secondary"],
  } as any,
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.sm,
    marginTop: t.spacing.md,
  } as any,
  // Price + Buy share this row. Price + weight on the left ("₹900
  // / 200 g" treatment from the card front, display font for the
  // price), Buy disc on the right (same 36-px size as the back FAB
  // + floating share, Crema-pink fill).
  priceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
    marginTop: t.spacing.xl,
    paddingVertical: t.spacing.md,
  } as any,
  priceLine: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
  } as any,
  price: {
    fontFamily: t.font.display,
    fontSize: t.size["font.2xl"],
    color: t.color["text.primary"],
    ...canelaNumeral,
  } as any,
  priceWeight: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.secondary"],
  } as any,
  // Pressable feedback for the floating share + buy.
  actionPressed: { opacity: 0.7 } as any,
  actionDisabled: { opacity: 0.4 } as any,
  divider: { height: 1, backgroundColor: t.color.divider, marginVertical: t.spacing.xs } as any,
  // Section stack — each section is a labeled group of Field rows.
  // Same gap rhythm as the retired CoffeeDetailSheet so the visual
  // weight reads identical to the long-press surface it replaced.
  sectionStack: {
    marginTop: t.spacing.lg,
    gap: t.spacing.xl,
  } as any,
  section: {
    gap: t.spacing.sm,
  } as any,
  sectionLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    textTransform: "uppercase",
    letterSpacing: 0.8,
  } as any,
  prose: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
    lineHeight: t.lineHeight.relaxed,
  } as any,
  brewNote: {
    fontStyle: "italic",
    color: t.color["text.secondary"],
    marginTop: t.spacing.xs,
  } as any,
  // Flavor-note chips — same chip pattern as the rest of the app.
  flavorChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.sm,
    paddingTop: t.spacing.xs,
  } as any,
  flavorChip: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.xs,
    borderRadius: t.radius.full,
    backgroundColor: t.color["card.info"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
  } as any,
  flavorChipText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
  } as any,
  relatedSection: { marginTop: 32 },
  relatedTitle: { fontFamily: t.font["body.semibold"], fontSize: 16, marginBottom: 16, color: t.color["text.primary"] },
}));

const useFieldStyles = makeStyles((t) => ({
  field: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: t.spacing.md,
    paddingVertical: t.spacing["2xs"],
  },
  fieldLabel: {
    width: 110,
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
  },
  fieldValue: {
    flex: 1,
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
    lineHeight: t.lineHeight.relaxed,
  } as any,
  fieldHint: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
  } as any,
}));
