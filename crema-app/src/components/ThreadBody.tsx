/**
 * ThreadBody — generic chat thread surface.
 *
 * Phase 1 has only direct_message threads (café surfaces deferred).
 * Polls every 5s while mounted. Marks read on mount + on each new
 * inbound message.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, Pressable, StyleSheet,
  TextInput, ActivityIndicator, ScrollView,
} from "react-native";
import { X, Send, ArrowLeft } from "lucide-react-native";
import { t, cardShadow } from "../tokens/useTokens";
import { apiFetchRaw } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { timeAgo, CroppedAvatar } from "./primitives";

export type ThreadKind = "direct_message";

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

export default function ThreadBody({ kind, id, onBack, onClose }: Props) {
  const { user } = useAuth();
  const [thread, setThread] = useState<any>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const pollRef = useRef<any>(null);
  const lastMessageCount = useRef(0);

  const fetchUrl = `/direct-threads/${id}/thread`;
  const postUrl = `/direct-threads/${id}/messages`;
  const readUrl = `/direct-threads/${id}/read`;

  const fetchThread = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true);
    setError(null);
    try {
      const raw = await apiFetchRaw<any>(fetchUrl);
      const data = raw?.data ?? raw;
      setThread(data?.thread ?? null);
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
    } catch (e: any) {
      if (!opts.silent) setError(e?.message || "Couldn't load this conversation.");
    } finally {
      if (!opts.silent) setLoading(false);
    }
  }, [fetchUrl]);

  const markRead = useCallback(async () => {
    try { await apiFetchRaw(readUrl, { method: "POST" }); } catch { /* silent */ }
  }, [readUrl]);

  useEffect(() => {
    fetchThread();
    markRead();
    pollRef.current = setInterval(() => fetchThread({ silent: true }), POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchThread, markRead]);

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
      const raw = await apiFetchRaw<any>(postUrl, {
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
  }, [draft, postUrl, sending]);

  const counterparty = useMemo(() => {
    if (!thread) return { name: "…", logo: null as string | null, cropX: null as number | null, cropY: null as number | null, zoom: null as number | null };
    const o = thread.other || {};
    return {
      name: o.display_name || o.username || "User",
      logo: o.avatar_url,
      cropX: o.avatar_crop_x,
      cropY: o.avatar_crop_y,
      zoom: o.avatar_zoom,
    };
  }, [thread]);

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
        </View>
        <Pressable onPress={onClose} hitSlop={8} style={s.iconBtn}>
          <X size={16} color={t.color["text.primary"]} />
        </Pressable>
      </View>

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
  root: { flex: 1, backgroundColor: t.color.bg } as any,
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10, paddingTop: 10, paddingBottom: 10,
    borderBottomWidth: 1, borderBottomColor: "#EDE8E1",
  } as any,
  title: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.primary"] },
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
    color: t.color["accent.cta"], textAlign: "center", paddingVertical: 3,
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
    paddingHorizontal: 9, paddingVertical: 8,
    maxHeight: 240, minHeight: 90,
    textAlignVertical: "top",
  } as any,
  sendBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: t.color["text.primary"],
    alignItems: "center", justifyContent: "center",
  } as any,
  sendBtnDisabled: { opacity: 0.4 } as any,
});
