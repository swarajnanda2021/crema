/**
 * BeanDetailModal — long-press detail surface revealing every field
 * the enrichment pipeline could have populated for a single bean
 * proposal. Empty fields render as "—" so the admin can tally what
 * came back vs what didn't. When `prev_state` exists for an `update`
 * proposal, the prior value is shown in a "was: …" line so the admin
 * sees what actually changed.
 *
 * Lifted out of ScraperPanel so both the BEANS sub-tab carousel and
 * the per-roaster Coffees section on the admin roaster page can mount
 * the same modal — long-press semantics carry over identically.
 */

import {
  Modal,
  View,
  Text,
  Pressable,
  ScrollView,
  StyleSheet,
  Platform,
  Dimensions,
} from "react-native";
import { X } from "lucide-react-native";

import { t } from "../../tokens/useTokens";
import type { ScrapeProposal } from "../../resources/types";

/**
 * Coerce whatever the backend sent for proposed_state / prev_state
 * into a plain object. The CRUD route normally pre-parses the JSON
 * column server-side, but defending against a string return here
 * makes the modal robust if anything in the chain (envelope wrapper,
 * sqlite Row dict, future endpoint) ever ships the raw `_json` text
 * instead. Returns {} when there's nothing usable.
 */
function _coerceState(maybeState: any, jsonFallback: any): Record<string, any> {
  // Already a plain object → use it.
  if (maybeState && typeof maybeState === "object" && !Array.isArray(maybeState)) {
    return maybeState as Record<string, any>;
  }
  // Stringified JSON → parse defensively.
  if (typeof maybeState === "string" && maybeState.trim()) {
    try {
      const parsed = JSON.parse(maybeState);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* fall through */
    }
  }
  // Last resort: the raw `_json` companion field if it's a string.
  if (typeof jsonFallback === "string" && jsonFallback.trim()) {
    try {
      const parsed = JSON.parse(jsonFallback);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      /* fall through */
    }
  }
  return {};
}

// Field order — same shape as the Sonnet enrichment schema in
// Scraper/enrich.py, with the meta fields tucked at the end.
const ORDER = [
  "coffee_name",
  "roaster_name",
  "origin",
  "varietal",
  "process",
  "process_raw",
  "producer",
  "roast_level",
  "bean_type",
  "tasting_notes",
  "brew_recommendation_json",
  "weight_grams",
  "price_inr",
  "available",
  "image_url",
  "product_url",
  "product_id",
  "roaster_slug",
  "source",
  "scrape_confidence",
  "scrape_flags",
  "enrichment_status",
];

export default function BeanDetailModal({
  proposal,
  visible,
  onClose,
}: {
  proposal: ScrapeProposal;
  visible: boolean;
  onClose: () => void;
}) {
  // Defensive coercion — see `_coerceState`. Handles the regular case
  // (server pre-parsed the JSON), the rare case (server shipped the
  // raw `_json` string), and the missing case (proposed_state is null
  // for change_type='mark_sold_out' so we fall back to prev_state).
  const proposed = _coerceState(
    (proposal as any).proposed_state,
    (proposal as any).proposed_state_json,
  );
  const proposedFallback =
    Object.keys(proposed).length === 0
      ? _coerceState(
          (proposal as any).prev_state,
          (proposal as any).prev_state_json,
        )
      : proposed;
  const prev =
    proposal.change_type === "update"
      ? _coerceState(
          (proposal as any).prev_state,
          (proposal as any).prev_state_json,
        )
      : null;

  // Show every key from `ORDER` first, then any extras the proposal
  // happens to carry (future-proof against schema growth).
  const seen = new Set(ORDER);
  const extraKeys = Object.keys(proposedFallback)
    .filter((k) => !seen.has(k))
    .sort();
  const allKeys = [...ORDER, ...extraKeys];

  // Empty-state safety — if for any reason BOTH proposed_state and
  // prev_state came back empty, render an explicit message instead
  // of a silent list of "—" rows.
  const isEmpty = Object.keys(proposedFallback).length === 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.detailOverlayWrap}>
        <Pressable style={s.detailOverlayBg} onPress={onClose} />
        <View style={s.detailCard}>
          <View style={s.detailHeader}>
            <View style={{ flex: 1 }}>
              <Text style={s.detailTitle} numberOfLines={2}>
                {proposedFallback.coffee_name || "(no coffee_name)"}
              </Text>
              <Text style={s.detailSubtitle} numberOfLines={1}>
                {proposedFallback.roaster_name || ""}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={t.size["icon.lg"]} color={t.color["text.primary"]} />
            </Pressable>
          </View>
          {isEmpty ? (
            <View style={s.detailEmpty}>
              <Text style={s.detailEmptyText}>
                This proposal arrived without any state data. Likely a
                stale row from before the enrichment pipeline rewrite —
                rejecting + re-running enrichment will refresh it.
              </Text>
            </View>
          ) : (
            <ScrollView
              style={s.detailScroll}
              contentContainerStyle={s.detailBody}
              showsVerticalScrollIndicator={true}
            >
              {allKeys.map((key) => {
                const val = proposedFallback[key];
                const prevVal = prev?.[key];
                const display = formatVal(val);
                const isFieldEmpty = display === "" || display === "null";
                const changed = !!prev && JSON.stringify(prevVal) !== JSON.stringify(val);
                return (
                  <View key={key} style={s.detailRow}>
                    <Text style={s.detailFieldLabel}>{key}</Text>
                    <Text
                      style={[
                        s.detailFieldValue,
                        isFieldEmpty && s.detailFieldValueEmpty,
                      ]}
                    >
                      {isFieldEmpty ? "—" : display}
                    </Text>
                    {changed ? (
                      <Text style={s.detailFieldWas}>
                        was: {formatVal(prevVal) || "—"}
                      </Text>
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function formatVal(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) return v.join(", ");
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

const s = StyleSheet.create({
  detailOverlayWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    ...(Platform.OS === "web"
      ? ({ backdropFilter: "blur(35px)", WebkitBackdropFilter: "blur(35px)" } as any)
      : {}),
  } as any,
  detailOverlayBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: t.color.overlay,
  } as any,
  detailCard: {
    position: "relative",
    backgroundColor: t.color.bg,
    borderRadius: t.radius.lg,
    width: "94%",
    maxWidth: 560,
    // Concrete height (75% of the screen) so the inner ScrollView has
    // a fixed parent to flex into. The prior `maxHeight: "85%"` only
    // capped overflow — without a concrete height, the ScrollView
    // (style flex: 1) collapsed to 0 px on iOS, leaving the header
    // visible but every field row clipped.
    height: Math.round(Dimensions.get("window").height * 0.75),
    maxHeight: 720,
    overflow: "hidden",
    zIndex: 1,
  } as any,
  detailHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.md,
    paddingHorizontal: t.spacing.xl,
    paddingTop: t.spacing.lg,
    paddingBottom: t.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
  },
  detailTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.lg"],
    color: t.color["text.primary"],
    lineHeight: t.lineHeight.relaxed,
  } as any,
  detailSubtitle: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    marginTop: 2,
  },
  detailScroll: {
    flex: 1,
    // Without an explicit minHeight: 0, a flex child of a column-flex
    // parent can ignore overflow on iOS and "expand to fit content,"
    // pushing rows off-screen instead of scrolling. Belt-and-suspenders
    // alongside the parent `height`.
    minHeight: 0,
  } as any,
  detailBody: {
    padding: t.spacing.xl,
    paddingBottom: t.spacing["3xl"],
    gap: t.spacing.md,
  } as any,
  detailEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing["2xl"],
  } as any,
  detailEmptyText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    textAlign: "center",
    lineHeight: t.lineHeight.relaxed,
  } as any,
  detailRow: {
    gap: 2,
  } as any,
  detailFieldLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  detailFieldValue: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    lineHeight: t.lineHeight.relaxed,
  } as any,
  detailFieldValueEmpty: {
    color: t.color["text.muted"],
    fontStyle: "italic",
  } as any,
  detailFieldWas: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    fontStyle: "italic",
    paddingTop: 2,
  } as any,
});
