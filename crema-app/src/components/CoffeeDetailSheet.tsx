/**
 * CoffeeDetailSheet — consumer-side long-press detail surface for a
 * coffee bean. Mirrors the admin BeanDetailModal in spirit (one place
 * to inspect every field the enrichment pipeline filled), but with
 * polished labels + grouped sections so it reads as a product detail
 * sheet, not a debugging dump.
 *
 * Mounted from:
 *   • `CoffeeList` (Discover BEANS) — long-press any card → this sheet.
 *   • `CoffeeGrid` on `app/roaster/[slug].tsx` — same.
 *
 * Sections (in render order, each only rendered if it has content):
 *   1. Roaster blurb — the Sonnet-distilled 1-2 sentence narrative
 *      ("About this coffee").
 *   2. Origin — estate, region, altitude (MASL), producer, varietal,
 *      bean type.
 *   3. Roast & process — verbatim roast term + the canonical bucket;
 *      verbatim process text (process_raw is the only process source
 *      after the Phase 6 enricher rewrite).
 *   4. Brew guide — parsed brew_recommendation_json: method, dose,
 *      ratio, water temp, the roaster's own brew note.
 *   5. Tasting — tasting_notes prose + flavor_notes chips.
 *   6. Pack — weight_grams + price.
 *
 * Empty fields collapse silently. If the whole record is empty we
 * still show the header + an explicit "(no extra detail captured)"
 * message so the long-press doesn't feel broken.
 */

import { Modal, View, Text, Pressable, ScrollView, StyleSheet, Platform, Dimensions } from "react-native";
import { X } from "lucide-react-native";

import { t } from "../tokens/useTokens";

interface BrewRec {
  method?: string | null;
  dose_grams?: number | null;
  ratio?: string | null;
  water_temp_celsius?: number | null;
  notes?: string | null;
}

function _parseBrew(raw: any): BrewRec | null {
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

function _parseFlavorNotes(raw: any): string[] {
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
    // Comma-separated fallback ("Citrus, Caramel, Stone Fruit")
    return trimmed.split(",").map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function _METHOD_LABEL(key: string | null | undefined): string {
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

export default function CoffeeDetailSheet({
  coffee,
  visible,
  onClose,
}: {
  coffee: Record<string, any> | null;
  visible: boolean;
  onClose: () => void;
}) {
  // Tolerate a missing coffee — modal opens, body renders the empty
  // state. Closing puts it back to harmless.
  const c: Record<string, any> = coffee || {};

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

  const brew = _parseBrew(c.brew_recommendation_json || c.brew_recommendation);
  const tastingNotes = (c.tasting_notes || "").toString().trim();
  const flavorNotes = _parseFlavorNotes(c.flavor_notes);

  const weight = c.weight_grams;
  const price = c.price_inr;

  // Section visibility — collapse silently if nothing in the section.
  const showOrigin = !!(origin || cityState || altitude || producer || varietal || beanType);
  const showRoastProcess = !!(roastVerbatim || roastBucket || processRaw);
  const showBrew =
    !!brew && !!(brew.method || brew.dose_grams || brew.ratio || brew.water_temp_celsius || brew.notes);
  const showTasting = !!(tastingNotes || flavorNotes.length > 0);
  const showPack = !!(weight || price);

  const isAllEmpty =
    !roasterBlurb && !showOrigin && !showRoastProcess && !showBrew && !showTasting && !showPack;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlayWrap}>
        <Pressable style={s.overlayBg} onPress={onClose} />
        <View style={s.card}>
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.title} numberOfLines={2}>
                {c.coffee_name || "Coffee"}
              </Text>
              {c.roaster_name ? (
                <Text style={s.subtitle} numberOfLines={1}>
                  {c.roaster_name}
                </Text>
              ) : null}
            </View>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close coffee detail">
              <X size={t.size["icon.lg"]} color={t.color["text.primary"]} />
            </Pressable>
          </View>

          {isAllEmpty ? (
            <View style={s.emptyBlock}>
              <Text style={s.emptyText}>
                No extra detail captured for this coffee yet. The
                roaster may not have shared the full sourcing story.
              </Text>
            </View>
          ) : (
            <ScrollView
              style={s.scroll}
              contentContainerStyle={s.body}
              showsVerticalScrollIndicator={true}
            >
              {roasterBlurb ? (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>About this coffee</Text>
                  <Text style={s.prose}>{roasterBlurb}</Text>
                </View>
              ) : null}

              {showOrigin ? (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>Origin</Text>
                  {origin ? <Field label="Estate / region" value={origin} /> : null}
                  {cityState ? <Field label="Roastery" value={cityState} /> : null}
                  {altitude ? <Field label="Altitude" value={`${altitude} m`} /> : null}
                  {producer ? <Field label="Producer" value={producer} /> : null}
                  {varietal ? <Field label="Varietal" value={varietal} /> : null}
                  {beanType ? <Field label="Bean type" value={beanType} /> : null}
                </View>
              ) : null}

              {showRoastProcess ? (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>Roast & process</Text>
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
                <View style={s.section}>
                  <Text style={s.sectionLabel}>Brew guide</Text>
                  {brew.method ? <Field label="Method" value={_METHOD_LABEL(brew.method)} /> : null}
                  {brew.dose_grams ? <Field label="Dose" value={`${brew.dose_grams} g`} /> : null}
                  {brew.ratio ? <Field label="Ratio" value={brew.ratio} /> : null}
                  {brew.water_temp_celsius ? (
                    <Field label="Water temp" value={`${brew.water_temp_celsius} °C`} />
                  ) : null}
                  {brew.notes ? (
                    <Text style={[s.prose, s.brewNote]}>{brew.notes}</Text>
                  ) : null}
                </View>
              ) : null}

              {showTasting ? (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>Tasting</Text>
                  {tastingNotes ? <Text style={s.prose}>{tastingNotes}</Text> : null}
                  {flavorNotes.length > 0 ? (
                    <View style={s.chipRow}>
                      {flavorNotes.map((fn, i) => (
                        <View key={`${fn}-${i}`} style={s.chip}>
                          <Text style={s.chipText}>{fn}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}

              {showPack ? (
                <View style={s.section}>
                  <Text style={s.sectionLabel}>Pack</Text>
                  {weight ? <Field label="Weight" value={`${weight} g`} /> : null}
                  {price ? <Field label="Price" value={`₹${price}`} /> : null}
                </View>
              ) : null}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function Field({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <View style={s.field}>
      <Text style={s.fieldLabel}>{label}</Text>
      <Text style={s.fieldValue}>{value}</Text>
      {hint ? <Text style={s.fieldHint}>{hint}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  overlayWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    ...(Platform.OS === "web"
      ? ({ backdropFilter: "blur(35px)", WebkitBackdropFilter: "blur(35px)" } as any)
      : {}),
  } as any,
  overlayBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: t.color.overlay,
  } as any,
  card: {
    position: "relative",
    backgroundColor: t.color.bg,
    borderRadius: t.radius.lg,
    width: "94%",
    maxWidth: 560,
    // Concrete height (75% of screen) so the inner ScrollView has a
    // definite parent to flex into. Same fix the BeanDetailModal got
    // — `maxHeight: "85%"` alone collapses the scroll body to 0px on
    // iOS.
    height: Math.round(Dimensions.get("window").height * 0.78),
    maxHeight: 760,
    overflow: "hidden",
    zIndex: 1,
  } as any,
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.md,
    paddingHorizontal: t.spacing.xl,
    paddingTop: t.spacing.lg,
    paddingBottom: t.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
  },
  title: {
    fontFamily: t.font.display,
    fontSize: t.size["font.xl"],
    color: t.color["text.primary"],
    lineHeight: t.lineHeight.relaxed,
  } as any,
  subtitle: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    marginTop: 2,
  },
  scroll: {
    flex: 1,
    minHeight: 0,
  } as any,
  body: {
    padding: t.spacing.xl,
    paddingBottom: t.spacing["3xl"],
    gap: t.spacing.xl,
  } as any,
  emptyBlock: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing["2xl"],
  } as any,
  emptyText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    textAlign: "center",
    lineHeight: t.lineHeight.relaxed,
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
  },
  prose: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
    lineHeight: t.lineHeight.relaxed,
  } as any,
  brewNote: {
    fontStyle: "italic",
    color: t.color["text.secondary"],
  } as any,

  // Field rows (label + value)
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

  // Flavor-note chips
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.sm,
    paddingTop: t.spacing.xs,
  },
  chip: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.xs,
    borderRadius: t.radius.full,
    backgroundColor: t.color["card.info"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
  } as any,
  chipText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
  },
});
