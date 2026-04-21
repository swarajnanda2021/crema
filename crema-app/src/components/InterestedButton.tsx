/**
 * InterestedButton — Phase 1 §2.1 "Interested" wholesale handshake.
 *
 * Visible only to café accounts. Tapping opens a modal with an optional
 * note; submitting posts a row to /api/wholesale_inquiries, which fires
 * a `wholesale_inquiry` notification to every roaster-account user on
 * the target roaster_slug (see services/notifications.py). The
 * notification lands in the roaster's Business tab (§2.4) with a
 * deep-link to the sending café's profile where §2.6 procurement fields
 * render for lead qualification.
 *
 * Two call styles:
 *   1. Uncontrolled (default) — renders a pill button that opens its
 *      own modal. Used next to Buy on the product detail page.
 *   2. Controlled via `controlledOpen` + `onControlledClose` — renders
 *      only the modal; the caller owns the trigger. Used by CoffeeCard
 *      so the wholesale Package icon on the card opens the inquiry
 *      flow directly (see §2.2 design polish).
 *
 * When the roaster has set a wholesale minimum or note, those surface
 * at the top of the modal as a "From the roaster" block so the café
 * sees what they're responding to before composing their own note.
 */

import { useMemo, useState } from "react";
import {
  View, Text, Pressable, StyleSheet, Platform, TextInput, ActivityIndicator, Modal,
} from "react-native";
import { Handshake, Package } from "lucide-react-native";
import { t, cardShadow } from "../tokens/useTokens";
import { apiFetchRaw } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { HapticPressable } from "./primitives";

interface Props {
  roaster_slug: string;
  roaster_name?: string;
  product_id?: string;
  product_name?: string;
  /** Minimum-order kg flagged by the roaster on this product. */
  wholesale_minimum_kg?: number | null;
  /** Roaster's free-text note about this wholesale lot. */
  wholesale_note?: string | null;
  /** Override default label ("Interested"). */
  label?: string;
  /** Compact variant for dense card layouts. */
  compact?: boolean;
  /** Controlled open state — when defined, the component renders only
   *  the modal. The trigger lives with the caller. */
  controlledOpen?: boolean;
  /** Close callback, paired with `controlledOpen`. */
  onControlledClose?: () => void;
}

type Phase = "idle" | "submitting" | "sent";

export default function InterestedButton({
  roaster_slug, roaster_name, product_id, product_name,
  wholesale_minimum_kg, wholesale_note,
  label, compact,
  controlledOpen, onControlledClose,
}: Props) {
  const { user } = useAuth();
  const isControlled = controlledOpen !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const open = isControlled ? !!controlledOpen : uncontrolledOpen;
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const visible = user?.account_type === "cafe" && !!user?.cafe_slug;
  const targetLabel = useMemo(() => {
    if (product_name) return product_name;
    if (roaster_name) return roaster_name;
    return "this roaster";
  }, [product_name, roaster_name]);
  const hasRoasterNote =
    (wholesale_minimum_kg != null && wholesale_minimum_kg > 0) ||
    (!!wholesale_note && wholesale_note.trim().length > 0);

  if (!visible) return null;

  const submit = async () => {
    setPhase("submitting");
    setError(null);
    try {
      await apiFetchRaw("/wholesale_inquiries", {
        method: "POST",
        body: JSON.stringify({
          roaster_slug,
          product_id: product_id || null,
          note: note.trim() || null,
        }),
      });
      setPhase("sent");
    } catch (e: any) {
      setError(e?.message || "Something went wrong. Try again?");
      setPhase("idle");
    }
  };

  const reset = () => {
    if (isControlled) {
      onControlledClose?.();
    } else {
      setUncontrolledOpen(false);
    }
    setNote("");
    setPhase("idle");
    setError(null);
  };

  const openModal = () => {
    if (isControlled) return; // caller owns the open state
    setUncontrolledOpen(true);
  };

  return (
    <>
      {!isControlled && (
        <HapticPressable
          haptic="select"
          onPress={openModal}
          style={[s.btn, compact && s.btnCompact]}
          accessibilityLabel={`Express wholesale interest in ${targetLabel}`}
        >
          <Handshake size={compact ? 14 : 16} color={t.color["text.on-dark"]} />
          <Text style={[s.btnText, compact && s.btnTextCompact]}>{label || "Interested"}</Text>
        </HapticPressable>
      )}

      <Modal visible={open} transparent animationType="fade" onRequestClose={reset}>
        <View style={s.overlayWrap}>
          <Pressable onPress={reset} style={s.backdrop} />
          <View style={s.card}>
            {phase === "sent" ? (
              <>
                <Text style={s.title}>Sent</Text>
                <Text style={s.body}>
                  {roaster_name || "The roaster"} now knows you're interested.
                  Your café's procurement profile goes along for the ride —
                  they'll see your volume and note.
                </Text>
                <View style={s.actionRow}>
                  <HapticPressable haptic="tap" onPress={reset} style={[s.action, s.primary]}>
                    <Text style={s.primaryText}>Close</Text>
                  </HapticPressable>
                </View>
              </>
            ) : (
              <>
                <Text style={s.title}>Interested in {targetLabel}</Text>

                {/* §2.8 — the min-kg + note fields were dropped from
                   the product schema because negotiation happens
                   inline on the inquiry thread (Phase 2). Don't
                   render legacy values; Phase 1's wholesale handshake
                   is just "available" / "not available". */}

                <Text style={s.body}>
                  Send a quick note to {roaster_name || "the roaster"}. Your
                  café's procurement profile (volume, openness, preferences)
                  is shared along with this inquiry.
                </Text>
                <TextInput
                  style={s.input}
                  value={note}
                  onChangeText={setNote}
                  placeholder="Optional: brewing style, target volume, timeline…"
                  placeholderTextColor="rgba(53,17,1,0.35)"
                  multiline
                  maxLength={500}
                  editable={phase === "idle"}
                />
                {error && <Text style={s.error}>{error}</Text>}
                <View style={s.actionRow}>
                  <HapticPressable
                    haptic="tap"
                    onPress={reset}
                    style={[s.action, s.secondary]}
                    disabled={phase === "submitting"}
                  >
                    <Text style={s.secondaryText}>Cancel</Text>
                  </HapticPressable>
                  <HapticPressable
                    haptic="commit"
                    onPress={submit}
                    style={[s.action, s.primary, phase === "submitting" && s.primaryDisabled]}
                    disabled={phase === "submitting"}
                  >
                    {phase === "submitting" ? (
                      <ActivityIndicator size="small" color="#FAF8F0" />
                    ) : (
                      <Text style={s.primaryText}>Send inquiry</Text>
                    )}
                  </HapticPressable>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  btn: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: t.color["accent.cta"],
    borderRadius: 22,
  } as any,
  btnCompact: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16 } as any,
  btnText: {
    fontFamily: t.font["body.semibold"], fontSize: 13,
    color: t.color["text.on-dark"], letterSpacing: 0.3,
  },
  btnTextCompact: { fontSize: 11 },

  // Modal is portaled to the app root by React Native, so viewport
  // positioning doesn't need fixed/absolute hacks — flex centering
  // inside the overlay is enough. Matches PostPromptModal / AuthModal.
  overlayWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    ...(Platform.OS === "web"
      ? ({ backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)" } as any)
      : {}),
  } as any,
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.35)",
  } as any,
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 20,
    width: Platform.OS === "web" ? 420 : "86%",
    maxWidth: 460,
    gap: 12,
    ...cardShadow,
    shadowOpacity: 0.2,
    shadowRadius: 32,
  } as any,
  title: {
    fontFamily: t.font["body.semibold"], fontSize: 16,
    color: t.color["text.primary"],
  },
  body: {
    fontFamily: t.font["body.regular"], fontSize: 13,
    color: t.color["text.secondary"], lineHeight: 19,
  },
  // Roaster's wholesale note block — cream card nested inside the
  // inquiry modal so the café can read the lot note before replying.
  roasterCard: {
    backgroundColor: "#EFE9DB",
    borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    gap: 6,
  } as any,
  roasterHeader: {
    flexDirection: "row", alignItems: "center", gap: 6,
  } as any,
  roasterHeaderText: {
    fontFamily: t.font["body.semibold"], fontSize: 11,
    color: "#351101", letterSpacing: 0.5, textTransform: "uppercase",
  } as any,
  roasterMin: {
    fontFamily: t.font["body.medium"], fontSize: 11,
    color: "rgba(53,17,1,0.6)", letterSpacing: 0.3,
  } as any,
  roasterNote: {
    fontFamily: t.font["body.regular"], fontSize: 13,
    color: "#351101", lineHeight: 19,
  } as any,
  input: {
    fontFamily: t.font["body.regular"], fontSize: 13,
    color: t.color["text.primary"],
    backgroundColor: "rgba(53,17,1,0.04)",
    borderWidth: 1, borderColor: "rgba(53,17,1,0.12)",
    borderRadius: 8, padding: 10,
    minHeight: 72, textAlignVertical: "top",
  } as any,
  error: {
    fontFamily: t.font["body.medium"], fontSize: 12,
    color: "#B5393C",
  },
  actionRow: { flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 4 },
  action: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16,
    alignItems: "center", justifyContent: "center", minWidth: 88,
  } as any,
  secondary: { backgroundColor: "rgba(53,17,1,0.05)" } as any,
  secondaryText: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.secondary"] },
  primary: { backgroundColor: t.color["text.primary"] } as any,
  primaryDisabled: { opacity: 0.7 } as any,
  primaryText: { fontFamily: t.font["body.semibold"], fontSize: 13, color: "#FAF8F0" },
});
