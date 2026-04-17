/**
 * InquiryThreadBody — chat thread content for a single wholesale
 * inquiry. Shared between the MessagesDrawer's thread view and any
 * future full-screen layouts. No modal/drawer chrome here — just the
 * conversation surface.
 *
 * Polls messages every 5 seconds while mounted. Marks read on mount
 * and on new inbound messages. Roasters get a compact … menu for
 * Mark-replied / Archive / Reopen.
 *
 * Layout: compact header (back/avatar/name/status) → collapsible
 * Details drawer (business context) → scrolling message list →
 * composer. The Details drawer auto-expands on a fresh thread so the
 * recipient has context before their first reply.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, Pressable, StyleSheet, Platform,
  TextInput, ActivityIndicator, ScrollView,
} from "react-native";
import {
  X, Send, Package, ChevronDown, ChevronUp,
  MoreHorizontal, Check, Archive, RotateCcw, ArrowLeft,
} from "lucide-react-native";
import { t, cardShadow } from "../tokens/useTokens";
import { apiFetchRaw } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { timeAgo, CroppedAvatar } from "./primitives";

interface Props {
  inquiryId: number;
  /** Optional back handler. When provided, a back-arrow renders
   *  in the header (used by MessagesDrawer in master-detail mode). */
  onBack?: () => void;
  /** Close the whole chrome surrounding this body. */
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

const POLL_MS = 5000;

export default function InquiryThreadBody({ inquiryId, onBack, onClose }: Props) {
  const { user } = useAuth();
  const [inquiry, setInquiry] = useState<any>(null);
  const [messages, setMessages] = useState<InquiryMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const pollRef = useRef<any>(null);
  const lastMessageCount = useRef(0);

  const isRoaster = user?.account_type === "roaster";

  const fetchThread = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    setError(null);
    try {
      const raw = await apiFetchRaw<any>(`/wholesale-inquiries/${inquiryId}/thread`);
      const data = raw?.data ?? raw;
      setInquiry(data?.inquiry || null);
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
    } catch (e: any) {
      if (!opts.silent) setError(e?.message || "Couldn't load this conversation.");
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, [inquiryId]);

  const markRead = useCallback(async () => {
    try {
      await apiFetchRaw(`/wholesale-inquiries/${inquiryId}/read`, { method: "POST" });
    } catch {
      // Silent — eventually consistent.
    }
  }, [inquiryId]);

  useEffect(() => {
    fetchThread();
    markRead();
    pollRef.current = setInterval(() => fetchThread({ silent: true }), POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchThread, markRead]);

  // Auto-expand details on a fresh thread so recipients have context.
  useEffect(() => {
    if (inquiry && messages.length === 0 && !detailsOpen) {
      setDetailsOpen(true);
    }
  }, [inquiry, messages.length]);

  // Mark read + scroll to bottom on new inbound messages.
  useEffect(() => {
    if (messages.length > lastMessageCount.current) {
      markRead();
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    }
    lastMessageCount.current = messages.length;
  }, [messages.length, markRead]);

  const send = useCallback(async () => {
    const text = draft.trim();
    if (!text || sending) return;
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

  const setStatus = useCallback(async (next: "open" | "responded" | "archived") => {
    if (!isRoaster) return;
    setMenuOpen(false);
    try {
      await apiFetchRaw(`/wholesale-inquiries/${inquiryId}/respond`, {
        method: "POST",
        body: JSON.stringify({ status: next }),
      });
      setInquiry((prev: any) => (prev ? { ...prev, status: next } : prev));
    } catch (e: any) {
      setError(e?.message || "Couldn't update status.");
    }
  }, [inquiryId, isRoaster]);

  const counterparty = useMemo(() => {
    if (!inquiry) return { name: "…", logo: null as string | null, cropX: null as number | null, cropY: null as number | null, zoom: null as number | null };
    if (user?.account_type === "roaster") {
      return {
        name: inquiry.cafe_name || inquiry.cafe_slug || "the café",
        logo: inquiry.cafe_logo_url,
        cropX: inquiry.cafe_logo_crop_x, cropY: inquiry.cafe_logo_crop_y, zoom: inquiry.cafe_logo_zoom,
      };
    }
    return {
      name: inquiry.roaster_name || inquiry.roaster_slug?.replace(/-/g, " ") || "the roaster",
      logo: inquiry.roaster_logo_url,
      cropX: null, cropY: null, zoom: null,
    };
  }, [inquiry, user]);

  const hasContext =
    !!inquiry?.note ||
    !!inquiry?.wholesale_note ||
    (inquiry?.wholesale_minimum_kg != null) ||
    (inquiry?.cafe_monthly_volume_kg != null) ||
    (inquiry?.cafe_open_to_new_roasters === 1) ||
    !!inquiry?.cafe_procurement_note;

  const statusLabel = inquiry?.status === "responded" ? "Replied"
    : inquiry?.status === "archived" ? "Archived"
    : "Open";

  return (
    <View style={s.root}>
      {/* Header */}
      <View style={s.header}>
        {onBack && (
          <Pressable onPress={onBack} hitSlop={6} style={s.iconBtn}>
            <ArrowLeft size={18} color={t.color["text.primary"]} />
          </Pressable>
        )}
        {counterparty.logo ? (
          <CroppedAvatar
            url={counterparty.logo}
            cropX={counterparty.cropX ?? undefined}
            cropY={counterparty.cropY ?? undefined}
            zoom={counterparty.zoom ?? undefined}
            size={36}
          />
        ) : (
          <View style={s.avatarFb}>
            <Text style={s.avatarLetter}>{(counterparty.name || "?")[0].toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title} numberOfLines={1}>{counterparty.name}</Text>
          <View style={s.subtitleRow}>
            {inquiry?.product_name && (
              <Text style={s.subtitle} numberOfLines={1}>{inquiry.product_name}</Text>
            )}
            <View style={[
              s.statusChip,
              statusLabel === "Open" ? s.statusChipOpen
                : statusLabel === "Replied" ? s.statusChipReplied
                : s.statusChipArchived,
            ]}>
              <Text style={s.statusChipText}>{statusLabel}</Text>
            </View>
          </View>
        </View>
        {isRoaster && (
          <Pressable onPress={() => setMenuOpen((v) => !v)} style={s.iconBtn} hitSlop={6}>
            <MoreHorizontal size={18} color={t.color["text.primary"]} />
          </Pressable>
        )}
        <Pressable onPress={onClose} hitSlop={8} style={s.iconBtn}>
          <X size={18} color={t.color["text.primary"]} />
        </Pressable>
      </View>

      {/* Roaster status menu */}
      {menuOpen && isRoaster && (
        <View style={s.menuCard}>
          <Pressable style={s.menuItem} onPress={() => setStatus("responded")}>
            <Check size={14} color={t.color["text.primary"]} />
            <Text style={s.menuText}>Mark as replied</Text>
          </Pressable>
          <Pressable style={s.menuItem} onPress={() => setStatus("archived")}>
            <Archive size={14} color={t.color["text.primary"]} />
            <Text style={s.menuText}>Archive</Text>
          </Pressable>
          {inquiry?.status !== "open" && (
            <Pressable style={s.menuItem} onPress={() => setStatus("open")}>
              <RotateCcw size={14} color={t.color["text.primary"]} />
              <Text style={s.menuText}>Reopen</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* Details drawer */}
      {hasContext && (
        <>
          <Pressable onPress={() => setDetailsOpen((v) => !v)} style={s.detailsToggle}>
            <Text style={s.detailsToggleText}>{detailsOpen ? "Hide details" : "Details"}</Text>
            {detailsOpen
              ? <ChevronUp size={14} color={t.color["text.muted"]} />
              : <ChevronDown size={14} color={t.color["text.muted"]} />}
          </Pressable>

          {detailsOpen && inquiry && (
            <View style={s.detailsWrap}>
              <View style={s.contextRow}>
                {(inquiry.cafe_monthly_volume_kg != null
                  || inquiry.cafe_procurement_note
                  || inquiry.cafe_open_to_new_roasters === 1) && (
                  <View style={s.contextCol}>
                    <Text style={s.contextLabel}>From the café</Text>
                    {inquiry.cafe_monthly_volume_kg != null && (
                      <Text style={s.contextValue}>{inquiry.cafe_monthly_volume_kg} kg/month</Text>
                    )}
                    {inquiry.cafe_open_to_new_roasters === 1 && (
                      <Text style={s.contextChip}>Open to new roasters</Text>
                    )}
                    {inquiry.cafe_procurement_note && (
                      <Text style={s.contextNote} numberOfLines={4}>
                        {inquiry.cafe_procurement_note}
                      </Text>
                    )}
                  </View>
                )}
                {(inquiry.wholesale_note || inquiry.wholesale_minimum_kg != null) && (
                  <View style={s.contextCol}>
                    <View style={s.contextLabelRow}>
                      <Package size={11} color="#351101" strokeWidth={1.8} />
                      <Text style={s.contextLabel}>From the roaster</Text>
                    </View>
                    {inquiry.wholesale_minimum_kg != null && (
                      <Text style={s.contextValue}>min {inquiry.wholesale_minimum_kg} kg</Text>
                    )}
                    {inquiry.wholesale_note && (
                      <Text style={s.contextNote} numberOfLines={4}>{inquiry.wholesale_note}</Text>
                    )}
                  </View>
                )}
              </View>
              {inquiry.note && (
                <View style={s.initialNote}>
                  <Text style={s.contextLabel}>Inquiry</Text>
                  <Text style={s.contextNote}>{inquiry.note}</Text>
                </View>
              )}
            </View>
          )}
        </>
      )}

      {/* Messages */}
      <ScrollView
        ref={scrollRef}
        style={s.messages}
        contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 14, gap: 10 }}
        showsVerticalScrollIndicator={false}
      >
        {loading && messages.length === 0 ? (
          <ActivityIndicator size="small" color="#D798DA" style={{ marginTop: 20 }} />
        ) : messages.length === 0 ? (
          <Text style={s.emptyText}>Say hi 👋 — {counterparty.name} is waiting to hear from you.</Text>
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
                    <View style={s.avatarFbSmall}>
                      <Text style={s.avatarLetterSmall}>
                        {(m.display_name || "?")[0].toUpperCase()}
                      </Text>
                    </View>
                  )
                )}
                <View style={[s.bubble, self ? s.bubbleSelf : s.bubbleOther]}>
                  {!self && <Text style={s.bubbleName}>{m.display_name}</Text>}
                  <Text style={[s.bubbleText, self && s.bubbleTextSelf]}>{m.body}</Text>
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
          placeholder={`Message ${counterparty.name}…`}
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
          {sending ? <ActivityIndicator size="small" color="#FAF8F0" /> : <Send size={16} color="#FAF8F0" />}
        </Pressable>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#FFFFFF" } as any,
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14, paddingTop: 14, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: "#EDE8E1",
  } as any,
  title: { fontFamily: t.font["body.semibold"], fontSize: 15, color: t.color["text.primary"] },
  subtitleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 } as any,
  subtitle: { fontFamily: t.font["body.medium"], fontSize: 11, color: t.color["text.muted"], maxWidth: 200 } as any,
  statusChip: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10 } as any,
  statusChipOpen: { backgroundColor: "rgba(215,152,218,0.18)" } as any,
  statusChipReplied: { backgroundColor: "rgba(78,156,104,0.18)" } as any,
  statusChipArchived: { backgroundColor: "rgba(53,17,1,0.08)" } as any,
  statusChipText: {
    fontFamily: t.font["body.semibold"], fontSize: 9,
    color: "#351101", letterSpacing: 0.5, textTransform: "uppercase",
  } as any,
  iconBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(53,17,1,0.06)",
    alignItems: "center", justifyContent: "center",
  } as any,
  avatarFb: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: t.color["text.primary"],
    alignItems: "center", justifyContent: "center",
  } as any,
  avatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 14, color: "#FAF8F0" },
  avatarFbSmall: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: t.color["text.primary"],
    alignItems: "center", justifyContent: "center",
  } as any,
  avatarLetterSmall: { fontFamily: t.font["body.semibold"], fontSize: 11, color: "#FAF8F0" },
  menuCard: {
    position: "absolute",
    top: 60, right: 56,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    paddingVertical: 4,
    minWidth: 180,
    ...cardShadow,
    shadowOpacity: 0.2,
    zIndex: 20,
  } as any,
  menuItem: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
  } as any,
  menuText: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.primary"] },
  detailsToggle: {
    flexDirection: "row", alignItems: "center", gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 16, paddingVertical: 8,
  } as any,
  detailsToggleText: {
    fontFamily: t.font["body.semibold"], fontSize: 11,
    color: t.color["text.muted"], letterSpacing: 0.4, textTransform: "uppercase",
  } as any,
  detailsWrap: {
    paddingHorizontal: 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: "#EDE8E1",
    gap: 10,
  } as any,
  contextRow: { flexDirection: "row", flexWrap: "wrap", gap: 10 } as any,
  contextCol: {
    flex: 1, minWidth: 140,
    backgroundColor: "#EFE9DB",
    borderRadius: 8,
    padding: 10,
    gap: 4,
  } as any,
  contextLabelRow: { flexDirection: "row", alignItems: "center", gap: 5 } as any,
  contextLabel: {
    fontFamily: t.font["body.semibold"], fontSize: 10,
    color: "#351101", letterSpacing: 0.6, textTransform: "uppercase",
  } as any,
  contextValue: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.primary"] },
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
  messages: { flex: 1 } as any,
  emptyText: {
    fontFamily: t.font["body.regular"], fontSize: 13,
    color: t.color["text.muted"], textAlign: "center", paddingVertical: 40,
    paddingHorizontal: 20,
  } as any,
  bubbleRow: { flexDirection: "row", alignItems: "flex-end", gap: 8 } as any,
  bubbleRowSelf: { justifyContent: "flex-end" } as any,
  bubbleRowOther: { justifyContent: "flex-start" } as any,
  bubble: {
    maxWidth: "78%",
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 14,
    gap: 3,
  } as any,
  bubbleSelf: { backgroundColor: t.color["text.primary"], borderBottomRightRadius: 3 } as any,
  bubbleOther: { backgroundColor: "#EFE9DB", borderBottomLeftRadius: 3 } as any,
  bubbleName: {
    fontFamily: t.font["body.semibold"], fontSize: 10,
    color: "rgba(53,17,1,0.7)", letterSpacing: 0.3,
  } as any,
  bubbleText: {
    fontFamily: t.font["body.regular"], fontSize: 13,
    color: t.color["text.primary"], lineHeight: 18,
  },
  bubbleTextSelf: { color: "#FAF8F0" } as any,
  bubbleTime: { fontFamily: t.font["body.regular"], fontSize: 9, color: t.color["text.muted"] } as any,
  bubbleTimeSelf: { color: "rgba(250,248,240,0.55)" } as any,
  error: {
    fontFamily: t.font["body.medium"], fontSize: 11,
    color: "#B5393C", textAlign: "center", paddingVertical: 4,
  } as any,
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 14, paddingVertical: 12,
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
