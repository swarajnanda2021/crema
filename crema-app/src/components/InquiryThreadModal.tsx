/**
 * InquiryThreadModal — short-form chat between a café and a roaster
 * on a single wholesale inquiry (Phase 1 §2.1 follow-up).
 *
 * Opens from either side's Business notification tab. Displays:
 *   - The roaster's original wholesale note + minimum kg (if set)
 *   - The café's procurement snapshot (volume, openness, note)
 *   - The initial "Interested" note the café sent
 *   - All subsequent messages, aligned by sender (self right, other left)
 *   - A composer at the bottom — either party can send
 *
 * Uses the site's Modal + overlayWrap + card pattern (same as
 * PostPromptModal / AuthModal) so it portals over any content.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, Pressable, StyleSheet, Platform,
  TextInput, Modal, ActivityIndicator, ScrollView,
} from "react-native";
import { X, Send, Package } from "lucide-react-native";
import { t, cardShadow } from "../tokens/useTokens";
import { apiFetchRaw } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { timeAgo, CroppedAvatar } from "./primitives";

interface Props {
  inquiryId: number | null;
  onClose: () => void;
}

interface InquiryMessage {
  id: number;
  inquiry_id: number;
  user_id: number;
  body: string;
  created_at: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  avatar_crop_x: number | null;
  avatar_crop_y: number | null;
  avatar_zoom: number | null;
  account_type: string;
}

export default function InquiryThreadModal({ inquiryId, onClose }: Props) {
  const { user } = useAuth();
  const [inquiry, setInquiry] = useState<any>(null);
  const [messages, setMessages] = useState<InquiryMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  const open = inquiryId !== null;

  const fetchThread = useCallback(async () => {
    if (!inquiryId) return;
    setLoading(true);
    setError(null);
    try {
      const raw = await apiFetchRaw<any>(`/wholesale-inquiries/${inquiryId}/thread`);
      const data = raw?.data ?? raw;
      setInquiry(data?.inquiry || null);
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
    } catch (e: any) {
      setError(e?.message || "Couldn't load this inquiry.");
    } finally {
      setLoading(false);
    }
  }, [inquiryId]);

  useEffect(() => {
    if (open) {
      setDraft("");
      fetchThread();
    } else {
      setInquiry(null);
      setMessages([]);
    }
  }, [open, fetchThread]);

  useEffect(() => {
    // Scroll to bottom whenever messages change.
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
  }, [messages.length]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || !inquiryId || sending) return;
    setSending(true);
    setError(null);
    try {
      const raw = await apiFetchRaw<any>(
        `/wholesale-inquiries/${inquiryId}/messages`,
        { method: "POST", body: JSON.stringify({ body: text }) },
      );
      const msg = raw?.data ?? raw;
      setMessages((prev) => [...prev, msg]);
      setDraft("");
    } catch (e: any) {
      setError(e?.message || "Couldn't send. Try again?");
    } finally {
      setSending(false);
    }
  }, [draft, inquiryId, sending]);

  const counterparty = useMemo(() => {
    if (!inquiry) return "the other side";
    if (user?.account_type === "roaster") return inquiry.cafe_name || inquiry.cafe_slug || "the café";
    return inquiry.roaster_slug?.replace(/-/g, " ") || "the roaster";
  }, [inquiry, user]);

  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlayWrap}>
        <Pressable style={s.backdrop} onPress={onClose} />
        <View style={s.card}>
          {/* Header */}
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.title} numberOfLines={1}>
                {inquiry?.product_name || "Wholesale inquiry"}
              </Text>
              <Text style={s.subtitle} numberOfLines={1}>
                {inquiry
                  ? `${inquiry.cafe_name || inquiry.cafe_slug} ↔ ${inquiry.roaster_slug?.replace(/-/g, " ") || ""}`
                  : "\u00a0"}
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8} style={s.closeBtn}>
              <X size={18} color={t.color["text.primary"]} />
            </Pressable>
          </View>

          {/* Context strip — roaster note + café procurement snapshot */}
          {inquiry && (
            <View style={s.contextWrap}>
              {(inquiry.wholesale_note || inquiry.cafe_monthly_volume_kg != null
                || inquiry.cafe_open_to_new_roasters === 1) && (
                <View style={s.contextRow}>
                  {/* Roaster side */}
                  {(inquiry.cafe_monthly_volume_kg != null || inquiry.cafe_procurement_note) && (
                    <View style={s.contextCol}>
                      <Text style={s.contextLabel}>From the café</Text>
                      {inquiry.cafe_monthly_volume_kg != null && (
                        <Text style={s.contextValue}>
                          {inquiry.cafe_monthly_volume_kg} kg/month
                        </Text>
                      )}
                      {inquiry.cafe_open_to_new_roasters === 1 && (
                        <Text style={s.contextChip}>Open to new roasters</Text>
                      )}
                      {inquiry.cafe_procurement_note && (
                        <Text style={s.contextNote} numberOfLines={3}>
                          {inquiry.cafe_procurement_note}
                        </Text>
                      )}
                    </View>
                  )}
                  {/* Roaster's lot note (if present) */}
                  {(inquiry.wholesale_note || inquiry.wholesale_minimum_kg != null) && (
                    <View style={s.contextCol}>
                      <View style={s.contextLabelRow}>
                        <Package size={11} color="#351101" strokeWidth={1.8} />
                        <Text style={s.contextLabel}>From the roaster</Text>
                      </View>
                      {inquiry.wholesale_minimum_kg != null && (
                        <Text style={s.contextValue}>
                          min {inquiry.wholesale_minimum_kg} kg
                        </Text>
                      )}
                      {inquiry.wholesale_note && (
                        <Text style={s.contextNote} numberOfLines={3}>
                          {inquiry.wholesale_note}
                        </Text>
                      )}
                    </View>
                  )}
                </View>
              )}
              {inquiry.note && (
                <View style={s.initialNote}>
                  <Text style={s.contextLabel}>Initial message</Text>
                  <Text style={s.contextNote}>{inquiry.note}</Text>
                </View>
              )}
            </View>
          )}

          {/* Message list */}
          <ScrollView
            ref={scrollRef}
            style={s.messages}
            contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}
            showsVerticalScrollIndicator={false}
          >
            {loading ? (
              <ActivityIndicator size="small" color="#D798DA" style={{ marginTop: 20 }} />
            ) : messages.length === 0 ? (
              <Text style={s.emptyText}>
                No replies yet — be the first to say something to {counterparty}.
              </Text>
            ) : (
              messages.map((m) => {
                const self = m.user_id === user?.id;
                return (
                  <View
                    key={m.id}
                    style={[s.bubbleRow, self ? s.bubbleRowSelf : s.bubbleRowOther]}
                  >
                    {!self && (
                      m.avatar_url ? (
                        <CroppedAvatar
                          url={m.avatar_url}
                          cropX={m.avatar_crop_x ?? undefined}
                          cropY={m.avatar_crop_y ?? undefined}
                          zoom={m.avatar_zoom ?? undefined}
                          size={26}
                        />
                      ) : (
                        <View style={s.avatarFb}>
                          <Text style={s.avatarLetter}>
                            {(m.display_name || "?")[0].toUpperCase()}
                          </Text>
                        </View>
                      )
                    )}
                    <View
                      style={[
                        s.bubble,
                        self ? s.bubbleSelf : s.bubbleOther,
                      ]}
                    >
                      {!self && (
                        <Text style={s.bubbleName}>{m.display_name}</Text>
                      )}
                      <Text style={[s.bubbleText, self && s.bubbleTextSelf]}>
                        {m.body}
                      </Text>
                      <Text style={[s.bubbleTime, self && s.bubbleTimeSelf]}>
                        {timeAgo(m.created_at)}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </ScrollView>

          {error && <Text style={s.error}>{error}</Text>}

          {/* Composer */}
          <View style={s.composer}>
            <TextInput
              style={s.input}
              value={draft}
              onChangeText={setDraft}
              placeholder={`Message ${counterparty}…`}
              placeholderTextColor="rgba(53,17,1,0.4)"
              multiline
              maxLength={2000}
              editable={!sending}
              onSubmitEditing={send}
            />
            <Pressable
              onPress={send}
              disabled={!draft.trim() || sending}
              style={[s.sendBtn, (!draft.trim() || sending) && s.sendBtnDisabled]}
              accessibilityLabel="Send message"
            >
              {sending ? (
                <ActivityIndicator size="small" color="#FAF8F0" />
              ) : (
                <Send size={16} color="#FAF8F0" />
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
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
    width: Platform.OS === "web" ? 520 : "92%",
    maxWidth: 560,
    maxHeight: Platform.OS === "web" ? "82%" : "86%",
    overflow: "hidden",
    ...cardShadow,
    shadowOpacity: 0.22,
    shadowRadius: 34,
  } as any,
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 20, paddingTop: 18, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: "#EDE8E1",
  } as any,
  title: {
    fontFamily: t.font["body.semibold"], fontSize: 15,
    color: t.color["text.primary"],
  },
  subtitle: {
    fontFamily: t.font["body.medium"], fontSize: 11,
    color: t.color["text.muted"], marginTop: 2,
  } as any,
  closeBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(53,17,1,0.06)",
    alignItems: "center", justifyContent: "center",
  } as any,
  contextWrap: {
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: "#EDE8E1",
    gap: 12,
  } as any,
  contextRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  } as any,
  contextCol: {
    flex: 1,
    minWidth: 140,
    backgroundColor: "#EFE9DB",
    borderRadius: 8,
    padding: 10,
    gap: 4,
  } as any,
  contextLabelRow: {
    flexDirection: "row", alignItems: "center", gap: 5,
  } as any,
  contextLabel: {
    fontFamily: t.font["body.semibold"], fontSize: 10,
    color: "#351101", letterSpacing: 0.6, textTransform: "uppercase",
  } as any,
  contextValue: {
    fontFamily: t.font["body.semibold"], fontSize: 13,
    color: t.color["text.primary"],
  },
  contextChip: {
    alignSelf: "flex-start",
    fontFamily: t.font["body.medium"], fontSize: 10,
    color: "#351101", letterSpacing: 0.3,
    backgroundColor: "rgba(53,17,1,0.1)",
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4,
  } as any,
  contextNote: {
    fontFamily: t.font["body.regular"], fontSize: 12,
    color: t.color["text.primary"], lineHeight: 17,
  },
  initialNote: {
    backgroundColor: "rgba(53,17,1,0.04)",
    borderRadius: 8, padding: 10, gap: 4,
  } as any,
  messages: { flex: 1, minHeight: 180, maxHeight: 360 } as any,
  emptyText: {
    fontFamily: t.font["body.regular"], fontSize: 13,
    color: t.color["text.muted"], textAlign: "center", paddingVertical: 20,
  } as any,
  bubbleRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  } as any,
  bubbleRowSelf: { justifyContent: "flex-end" } as any,
  bubbleRowOther: { justifyContent: "flex-start" } as any,
  avatarFb: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: t.color["text.primary"],
    alignItems: "center", justifyContent: "center",
  } as any,
  avatarLetter: {
    fontFamily: t.font["body.semibold"], fontSize: 11, color: "#FAF8F0",
  },
  bubble: {
    maxWidth: "78%",
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 14,
    gap: 3,
  } as any,
  bubbleSelf: {
    backgroundColor: t.color["text.primary"],
    borderBottomRightRadius: 3,
  } as any,
  bubbleOther: {
    backgroundColor: "#EFE9DB",
    borderBottomLeftRadius: 3,
  } as any,
  bubbleName: {
    fontFamily: t.font["body.semibold"], fontSize: 10,
    color: "rgba(53,17,1,0.7)", letterSpacing: 0.3,
  } as any,
  bubbleText: {
    fontFamily: t.font["body.regular"], fontSize: 13,
    color: t.color["text.primary"], lineHeight: 18,
  },
  bubbleTextSelf: { color: "#FAF8F0" } as any,
  bubbleTime: {
    fontFamily: t.font["body.regular"], fontSize: 9,
    color: t.color["text.muted"],
  } as any,
  bubbleTimeSelf: { color: "rgba(250,248,240,0.55)" } as any,
  error: {
    fontFamily: t.font["body.medium"], fontSize: 11,
    color: "#B5393C", textAlign: "center", paddingVertical: 4,
  } as any,
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: "#EDE8E1",
  } as any,
  input: {
    flex: 1,
    fontFamily: t.font["body.regular"], fontSize: 13,
    color: t.color["text.primary"],
    backgroundColor: "rgba(53,17,1,0.04)",
    borderWidth: 1, borderColor: "rgba(53,17,1,0.1)",
    borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9,
    maxHeight: 100, minHeight: 38,
    textAlignVertical: "top",
  } as any,
  sendBtn: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: t.color["text.primary"],
    alignItems: "center", justifyContent: "center",
  } as any,
  sendBtnDisabled: { opacity: 0.4 } as any,
});
