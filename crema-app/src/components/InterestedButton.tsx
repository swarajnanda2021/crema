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
 */

import { useMemo, useState } from "react";
import {
  View, Text, Pressable, StyleSheet, Platform, TextInput, ActivityIndicator,
} from "react-native";
import { Handshake } from "lucide-react-native";
import { t, cardShadow } from "../tokens/useTokens";
import { apiFetchRaw } from "../api/client";
import { useAuth } from "../hooks/useAuth";

interface Props {
  roaster_slug: string;
  roaster_name?: string;
  product_id?: string;
  product_name?: string;
  /** Override default label ("Interested"). */
  label?: string;
  /** Compact variant for dense card layouts. */
  compact?: boolean;
}

type Phase = "idle" | "submitting" | "sent";

export default function InterestedButton({
  roaster_slug, roaster_name, product_id, product_name, label, compact,
}: Props) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const visible = user?.account_type === "cafe" && !!user?.cafe_slug;
  const targetLabel = useMemo(() => {
    if (product_name) return product_name;
    if (roaster_name) return roaster_name;
    return "this roaster";
  }, [product_name, roaster_name]);

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
    setOpen(false);
    setNote("");
    setPhase("idle");
    setError(null);
  };

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={[s.btn, compact && s.btnCompact]}
        accessibilityLabel={`Express wholesale interest in ${targetLabel}`}
      >
        <Handshake size={compact ? 14 : 16} color={t.color["text.on-dark"]} />
        <Text style={[s.btnText, compact && s.btnTextCompact]}>{label || "Interested"}</Text>
      </Pressable>

      {open && (
        <View style={s.overlayWrap} pointerEvents="box-none">
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
                  <Pressable onPress={reset} style={[s.action, s.primary]}>
                    <Text style={s.primaryText}>Close</Text>
                  </Pressable>
                </View>
              </>
            ) : (
              <>
                <Text style={s.title}>Interested in {targetLabel}</Text>
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
                  <Pressable
                    onPress={reset}
                    style={[s.action, s.secondary]}
                    disabled={phase === "submitting"}
                  >
                    <Text style={s.secondaryText}>Cancel</Text>
                  </Pressable>
                  <Pressable
                    onPress={submit}
                    style={[s.action, s.primary, phase === "submitting" && s.primaryDisabled]}
                    disabled={phase === "submitting"}
                  >
                    {phase === "submitting" ? (
                      <ActivityIndicator size="small" color="#FAF8F0" />
                    ) : (
                      <Text style={s.primaryText}>Send inquiry</Text>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      )}
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

  overlayWrap: Platform.OS === "web"
    ? ({
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      alignItems: "center", justifyContent: "center",
      zIndex: 10000,
    } as any)
    : ({
      position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
      alignItems: "center", justifyContent: "center",
      zIndex: 10000,
    } as any),
  backdrop: Platform.OS === "web"
    ? ({
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: "rgba(0,0,0,0.35)",
    } as any)
    : ({
      position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: "rgba(0,0,0,0.35)",
    } as any),
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
