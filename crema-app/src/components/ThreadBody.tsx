/**
 * ThreadBody — generic chat thread surface.
 *
 * Handles both thread kinds in one component:
 *   - wholesale_inquiry: café ↔ roaster, with a collapsible Details
 *     drawer carrying the business context (inquiry note, café
 *     procurement snapshot, roaster's lot note). Roaster-only status
 *     menu (Mark-replied / Archive / Reopen).
 *   - direct_message: any user ↔ any user, no business context, no
 *     status. Just conversation.
 *
 * Polls every 5s while mounted. Marks read on mount + on each new
 * inbound message. The generic shape lets the Messages dropdown use
 * one renderer for whatever the user taps, and keeps a future third
 * thread kind a small patch away.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, Pressable, StyleSheet,
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

export type ThreadKind = "wholesale_inquiry" | "direct_message";

interface Props {
  kind: ThreadKind;
  id: number;
  /** Optional back handler — renders a back-arrow in the header.
   *  Used by MessagesDropdown in master-detail mode. */
  onBack?: () => void;
  onClose: () => void;
}

interface ThreadMessage {
  id: number;
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

function endpointsFor(kind: ThreadKind, id: number) {
  if (kind === "wholesale_inquiry") {
    return {
      fetch: `/wholesale-inquiries/${id}/thread`,
      post: `/wholesale-inquiries/${id}/messages`,
      read: `/wholesale-inquiries/${id}/read`,
      respond: `/wholesale-inquiries/${id}/respond` as string | null,
    };
  }
  return {
    fetch: `/direct-threads/${id}/thread`,
    post: `/direct-threads/${id}/messages`,
    read: `/direct-threads/${id}/read`,
    respond: null as string | null,
  };
}

export default function ThreadBody({ kind, id, onBack, onClose }: Props) {
  const { user } = useAuth();
  const [thread, setThread] = useState<any>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const pollRef = useRef<any>(null);
  const lastMessageCount = useRef(0);

  const isWholesale = kind === "wholesale_inquiry";
  const isRoaster = user?.account_type === "roaster";
  const endpoints = useMemo(() => endpointsFor(kind, id), [kind, id]);

  const fetchThread = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    setError(null);
    try {
      const raw = await apiFetchRaw<any>(endpoints.fetch);
      const data = raw?.data ?? raw;
      // Wholesale response: { inquiry, messages }. Direct: { thread, messages }.
      setThread(data?.inquiry ?? data?.thread ?? null);
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
    } catch (e: any) {
      if (!opts.silent) setError(e?.message || "Couldn't load this conversation.");
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, [endpoints.fetch]);

  const markRead = useCallback(async () => {
    try { await apiFetchRaw(endpoints.read, { method: "POST" }); } catch { /* silent */ }
  }, [endpoints.read]);

  useEffect(() => {
    fetchThread();
    markRead();
    pollRef.current = setInterval(() => fetchThread({ silent: true }), POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchThread, markRead]);

  useEffect(() => {
    if (isWholesale && thread && messages.length === 0 && !detailsOpen) {
      setDetailsOpen(true);
    }
  }, [isWholesale, thread, messages.length]);

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
      const raw = await apiFetchRaw<any>(endpoints.post, {
        method: "POST",
        body: JSON.stringify({ body: text }),
      });
      const msg = raw?.data ?? raw;
      setMessages((prev) => [...prev, msg]);
      setDraft("");
    } catch (e: any) {
      setError(e?.message || "Couldn't send. Try again?");
    } finally {
      setSending(false);
    }
  }, [draft, endpoints.post, sending]);

  const setStatus = useCallback(async (next: "open" | "responded" | "archived") => {
    if (!isWholesale || !isRoaster || !endpoints.respond) return;
    setMenuOpen(false);
    try {
      await apiFetchRaw(endpoints.respond, {
        method: "POST",
        body: JSON.stringify({ status: next }),
      });
      setThread((prev: any) => (prev ? { ...prev, status: next } : prev));
    } catch (e: any) {
      setError(e?.message || "Couldn't update status.");
    }
  }, [endpoints.respond, isRoaster, isWholesale]);

  const counterparty = useMemo(() => {
    if (!thread) return { name: "…", logo: null as string | null, cropX: null as number | null, cropY: null as number | null, zoom: null as number | null, productName: null as string | null };
    if (isWholesale) {
      if (user?.account_type === "roaster") {
        return {
          name: thread.cafe_name || thread.cafe_slug || "the café",
          logo: thread.cafe_logo_url,
          cropX: thread.cafe_logo_crop_x,
          cropY: thread.cafe_logo_crop_y,
          zoom: thread.cafe_logo_zoom,
          productName: thread.product_name,
        };
      }
      return {
        name: thread.roaster_name || thread.roaster_slug?.replace(/-/g, " ") || "the roaster",
        logo: thread.roaster_logo_url,
        cropX: null, cropY: null, zoom: null,
        productName: thread.product_name,
      };
    }
    const o = thread.other || {};
    return {
      name: o.display_name || o.username || "User",
      logo: o.avatar_url,
      cropX: o.avatar_crop_x,
      cropY: o.avatar_crop_y,
      zoom: o.avatar_zoom,
      productName: null,
    };
  }, [thread, isWholesale, user]);

  const hasContext = isWholesale && (
    !!thread?.note ||
    !!thread?.wholesale_note ||
    (thread?.wholesale_minimum_kg != null) ||
    (thread?.cafe_monthly_volume_kg != null) ||
    (thread?.cafe_open_to_new_roasters === 1) ||
    !!thread?.cafe_procurement_note
  );

  const statusLabel = !isWholesale ? null
    : thread?.status === "responded" ? "Replied"
    : thread?.status === "archived" ? "Archived"
    : "Open";

  return (
    <View style={s.root}>
      <View style={s.header}>
        {onBack && (
          <Pressable onPress={onBack} hitSlop={6} style={s.iconBtn}>
            <ArrowLeft size={16} color={t.color["text.primary"]} />
          </Pressable>
        )}
        {counterparty.logo ? (
          <CroppedAvatar
            url={counterparty.logo}
            cropX={counterparty.cropX ?? undefined}
            cropY={counterparty.cropY ?? undefined}
            zoom={counterparty.zoom ?? undefined}
            size={32}
          />
        ) : (
          <View style={s.avatarFb}>
            <Text style={s.avatarLetter}>{(counterparty.name || "?")[0].toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title} numberOfLines={1}>{counterparty.name}</Text>
          <View style={s.subtitleRow}>
            {counterparty.productName && (
              <Text style={s.subtitle} numberOfLines={1}>{counterparty.productName}</Text>
            )}
            {statusLabel && (
              <View style={[
                s.statusChip,
                statusLabel === "Open" ? s.statusChipOpen
                  : statusLabel === "Replied" ? s.statusChipReplied
                  : s.statusChipArchived,
              ]}>
                <Text style={s.statusChipText}>{statusLabel}</Text>
              </View>
            )}
          </View>
        </View>
        {isWholesale && isRoaster && (
          <Pressable onPress={() => setMenuOpen((v) => !v)} style={s.iconBtn} hitSlop={6}>
            <MoreHorizontal size={16} color={t.color["text.primary"]} />
          </Pressable>
        )}
        <Pressable onPress={onClose} hitSlop={8} style={s.iconBtn}>
          <X size={16} color={t.color["text.primary"]} />
        </Pressable>
      </View>

      {menuOpen && isWholesale && isRoaster && (
        <View style={s.menuCard}>
          <Pressable style={s.menuItem} onPress={() => setStatus("responded")}>
            <Check size={14} color={t.color["text.primary"]} />
            <Text style={s.menuText}>Mark as replied</Text>
          </Pressable>
          <Pressable style={s.menuItem} onPress={() => setStatus("archived")}>
            <Archive size={14} color={t.color["text.primary"]} />
            <Text style={s.menuText}>Archive</Text>
          </Pressable>
          {thread?.status !== "open" && (
            <Pressable style={s.menuItem} onPress={() => setStatus("open")}>
              <RotateCcw size={14} color={t.color["text.primary"]} />
              <Text style={s.menuText}>Reopen</Text>
            </Pressable>
          )}
        </View>
      )}

      {hasContext && (
        <>
          <Pressable onPress={() => setDetailsOpen((v) => !v)} style={s.detailsToggle}>
            <Text style={s.detailsToggleText}>{detailsOpen ? "Hide details" : "Details"}</Text>
            {detailsOpen
              ? <ChevronUp size={12} color={t.color["text.muted"]} />
              : <ChevronDown size={12} color={t.color["text.muted"]} />}
          </Pressable>

          {detailsOpen && thread && (
            <View style={s.detailsWrap}>
              <View style={s.contextRow}>
                {(thread.cafe_monthly_volume_kg != null
                  || thread.cafe_procurement_note
                  || thread.cafe_open_to_new_roasters === 1) && (
                  <View style={s.contextCol}>
                    <Text style={s.contextLabel}>From the café</Text>
                    {thread.cafe_monthly_volume_kg != null && (
                      <Text style={s.contextValue}>{thread.cafe_monthly_volume_kg} kg/month</Text>
                    )}
                    {thread.cafe_open_to_new_roasters === 1 && (
                      <Text style={s.contextChip}>Open to new roasters</Text>
                    )}
                    {thread.cafe_procurement_note && (
                      <Text style={s.contextNote} numberOfLines={4}>
                        {thread.cafe_procurement_note}
                      </Text>
                    )}
                  </View>
                )}
                {(thread.wholesale_note || thread.wholesale_minimum_kg != null) && (
                  <View style={s.contextCol}>
                    <View style={s.contextLabelRow}>
                      <Package size={10} color="#351101" strokeWidth={1.8} />
                      <Text style={s.contextLabel}>From the roaster</Text>
                    </View>
                    {thread.wholesale_minimum_kg != null && (
                      <Text style={s.contextValue}>min {thread.wholesale_minimum_kg} kg</Text>
                    )}
                    {thread.wholesale_note && (
                      <Text style={s.contextNote} numberOfLines={4}>{thread.wholesale_note}</Text>
                    )}
                  </View>
                )}
              </View>
              {thread.note && (
                <View style={s.initialNote}>
                  <Text style={s.contextLabel}>Inquiry</Text>
                  <Text style={s.contextNote}>{thread.note}</Text>
                </View>
              )}
            </View>
          )}
        </>
      )}

      <ScrollView
        ref={scrollRef}
        style={s.messages}
        contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 10, gap: 7 }}
        showsVerticalScrollIndicator={false}
      >
        {loading && messages.length === 0 ? (
          <ActivityIndicator size="small" color="#D798DA" style={{ marginTop: 18 }} />
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
                      size={20}
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
          {sending ? <ActivityIndicator size="small" color="#FAF8F0" /> : <Send size={13} color="#FAF8F0" />}
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
    gap: 8,
    paddingHorizontal: 10, paddingTop: 10, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: "#EDE8E1",
  } as any,
  title: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.primary"] },
  subtitleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 2, flexWrap: "wrap" } as any,
  subtitle: { fontFamily: t.font["body.medium"], fontSize: 10, color: t.color["text.muted"], maxWidth: 160 } as any,
  statusChip: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 } as any,
  statusChipOpen: { backgroundColor: "rgba(215,152,218,0.18)" } as any,
  statusChipReplied: { backgroundColor: "rgba(78,156,104,0.18)" } as any,
  statusChipArchived: { backgroundColor: "rgba(53,17,1,0.08)" } as any,
  statusChipText: {
    fontFamily: t.font["body.semibold"], fontSize: 8,
    color: "#351101", letterSpacing: 0.5, textTransform: "uppercase",
  } as any,
  iconBtn: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: "rgba(53,17,1,0.06)",
    alignItems: "center", justifyContent: "center",
  } as any,
  avatarFb: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: t.color["text.primary"],
    alignItems: "center", justifyContent: "center",
  } as any,
  avatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 12, color: "#FAF8F0" },
  avatarFbSmall: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: t.color["text.primary"],
    alignItems: "center", justifyContent: "center",
  } as any,
  avatarLetterSmall: { fontFamily: t.font["body.semibold"], fontSize: 9, color: "#FAF8F0" },
  menuCard: {
    position: "absolute",
    top: 48, right: 40,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    paddingVertical: 4,
    minWidth: 160,
    ...cardShadow,
    shadowOpacity: 0.2,
    zIndex: 20,
  } as any,
  menuItem: {
    flexDirection: "row", alignItems: "center", gap: 9,
    paddingHorizontal: 11, paddingVertical: 8,
  } as any,
  menuText: { fontFamily: t.font["body.medium"], fontSize: 12, color: t.color["text.primary"] },
  detailsToggle: {
    flexDirection: "row", alignItems: "center", gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 12, paddingVertical: 5,
  } as any,
  detailsToggleText: {
    fontFamily: t.font["body.semibold"], fontSize: 9.5,
    color: t.color["text.muted"], letterSpacing: 0.4, textTransform: "uppercase",
  } as any,
  detailsWrap: {
    paddingHorizontal: 12, paddingBottom: 8,
    borderBottomWidth: 1, borderBottomColor: "#EDE8E1",
    gap: 8,
  } as any,
  contextRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 } as any,
  contextCol: {
    flex: 1, minWidth: 130,
    backgroundColor: "#EFE9DB",
    borderRadius: 7,
    padding: 8,
    gap: 3,
  } as any,
  contextLabelRow: { flexDirection: "row", alignItems: "center", gap: 5 } as any,
  contextLabel: {
    fontFamily: t.font["body.semibold"], fontSize: 9,
    color: "#351101", letterSpacing: 0.5, textTransform: "uppercase",
  } as any,
  contextValue: { fontFamily: t.font["body.semibold"], fontSize: 11.5, color: t.color["text.primary"] },
  contextChip: {
    alignSelf: "flex-start",
    fontFamily: t.font["body.medium"], fontSize: 9,
    color: "#351101", letterSpacing: 0.3,
    backgroundColor: "rgba(53,17,1,0.1)",
    paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4,
  } as any,
  contextNote: {
    fontFamily: t.font["body.regular"], fontSize: 11,
    color: t.color["text.primary"], lineHeight: 15,
  },
  initialNote: {
    backgroundColor: "rgba(53,17,1,0.04)",
    borderRadius: 7, padding: 8, gap: 3,
  } as any,
  messages: { flex: 1 } as any,
  emptyText: {
    fontFamily: t.font["body.regular"], fontSize: 12,
    color: t.color["text.muted"], textAlign: "center", paddingVertical: 26,
    paddingHorizontal: 14,
  } as any,
  bubbleRow: { flexDirection: "row", alignItems: "flex-end", gap: 5 } as any,
  bubbleRowSelf: { justifyContent: "flex-end" } as any,
  bubbleRowOther: { justifyContent: "flex-start" } as any,
  bubble: {
    maxWidth: "82%",
    paddingHorizontal: 9, paddingVertical: 6,
    borderRadius: 11,
    gap: 2,
  } as any,
  bubbleSelf: { backgroundColor: t.color["text.primary"], borderBottomRightRadius: 3 } as any,
  bubbleOther: { backgroundColor: "#EFE9DB", borderBottomLeftRadius: 3 } as any,
  bubbleName: {
    fontFamily: t.font["body.semibold"], fontSize: 9,
    color: "rgba(53,17,1,0.7)", letterSpacing: 0.3,
  } as any,
  bubbleText: {
    fontFamily: t.font["body.regular"], fontSize: 12,
    color: t.color["text.primary"], lineHeight: 17,
  },
  bubbleTextSelf: { color: "#FAF8F0" } as any,
  bubbleTime: { fontFamily: t.font["body.regular"], fontSize: 8, color: t.color["text.muted"] } as any,
  bubbleTimeSelf: { color: "rgba(250,248,240,0.55)" } as any,
  error: {
    fontFamily: t.font["body.medium"], fontSize: 10,
    color: "#B5393C", textAlign: "center", paddingVertical: 3,
  } as any,
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 6,
    paddingHorizontal: 10, paddingVertical: 9,
    borderTopWidth: 1, borderTopColor: "#EDE8E1",
  } as any,
  input: {
    flex: 1,
    fontFamily: t.font["body.regular"], fontSize: 12,
    color: t.color["text.primary"],
    backgroundColor: "rgba(53,17,1,0.04)",
    borderWidth: 1, borderColor: "rgba(53,17,1,0.1)",
    borderRadius: 8,
    paddingHorizontal: 9, paddingVertical: 6,
    maxHeight: 80, minHeight: 30,
    textAlignVertical: "top",
  } as any,
  sendBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: t.color["text.primary"],
    alignItems: "center", justifyContent: "center",
  } as any,
  sendBtnDisabled: { opacity: 0.4 } as any,
});
