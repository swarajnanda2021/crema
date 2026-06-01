/**
 * SupportInbox — the admin side of the Contact-Crema support chat.
 *
 * Lists every user's support thread (with an unread badge), and lets the
 * admin open a thread to read the conversation + reply. Rendered as the
 * "Inbox" tab on the Crema admin profile. Backend:
 * GET /admin/support/threads, GET /admin/support/threads/{id},
 * POST /admin/support/threads/{id}/reply.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, Pressable, TextInput, ScrollView, StyleSheet,
} from "react-native";
import { ChevronLeft, Send } from "lucide-react-native";
import { t } from "../../tokens/useTokens";
import { apiFetchRaw } from "../../api/client";

export default function SupportInbox() {
  const [threads, setThreads] = useState<any[]>([]);
  const [activeId, setActiveId] = useState<number | null>(null);
  const [active, setActive] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [reply, setReply] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<any>(null);

  const loadThreads = useCallback(async () => {
    try {
      const r: any = await apiFetchRaw("/admin/support/threads");
      const d = r?.data ?? r;
      setThreads(Array.isArray(d?.threads) ? d.threads : []);
    } catch {}
  }, []);

  useEffect(() => {
    loadThreads();
    const id = setInterval(loadThreads, 15000);
    return () => clearInterval(id);
  }, [loadThreads]);

  const openThread = useCallback(
    async (id: number) => {
      setActiveId(id);
      try {
        const r: any = await apiFetchRaw(`/admin/support/threads/${id}`);
        const d = r?.data ?? r;
        setActive(d?.thread ?? null);
        setMessages(Array.isArray(d?.messages) ? d.messages : []);
        loadThreads(); // server cleared this thread's admin-unread
      } catch {}
    },
    [loadThreads],
  );

  useEffect(() => {
    if (activeId != null) {
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd?.({ animated: true }));
    }
  }, [messages, activeId]);

  const send = async () => {
    const body = reply.trim();
    if (!body || sending || activeId == null) return;
    setSending(true);
    setReply("");
    setMessages((m) => [...m, { id: `tmp-${m.length}`, sender: "admin", body }]);
    try {
      await apiFetchRaw(`/admin/support/threads/${activeId}/reply`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      const r: any = await apiFetchRaw(`/admin/support/threads/${activeId}`);
      const d = r?.data ?? r;
      setMessages(Array.isArray(d?.messages) ? d.messages : []);
    } catch {
    } finally {
      setSending(false);
    }
  };

  // ── Thread view ──
  if (activeId != null) {
    return (
      <View style={s.wrap}>
        <View style={s.threadHeader}>
          <Pressable
            onPress={() => { setActiveId(null); setActive(null); setMessages([]); }}
            hitSlop={10}
            style={s.backBtn}
            accessibilityLabel="Back to inbox"
          >
            <ChevronLeft size={20} color={t.color["text.primary"]} />
          </Pressable>
          <Text style={s.threadName} numberOfLines={1}>
            {active?.display_name || active?.username || "User"}
          </Text>
        </View>
        <ScrollView ref={scrollRef} style={s.msgs} contentContainerStyle={s.msgsContent}>
          {messages.map((m) => (
            <View key={m.id} style={[s.bubbleRow, m.sender === "admin" ? s.rowMine : s.rowTheirs]}>
              <View style={[s.bubble, m.sender === "admin" ? s.bubbleMine : s.bubbleTheirs]}>
                <Text style={m.sender === "admin" ? s.bubbleTextMine : s.bubbleTextTheirs}>
                  {m.body}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
        <View style={s.composer}>
          <TextInput
            value={reply}
            onChangeText={setReply}
            placeholder="Reply to this person…"
            placeholderTextColor={t.color["text.muted"]}
            style={s.input}
            multiline
          />
          <Pressable
            onPress={send}
            disabled={!reply.trim() || sending}
            style={[s.sendBtn, (!reply.trim() || sending) && s.sendBtnDisabled]}
            accessibilityLabel="Send reply"
          >
            <Send size={18} color={t.color["text.on-cta"]} strokeWidth={2} />
          </Pressable>
        </View>
      </View>
    );
  }

  // ── Thread list ──
  return (
    <View style={s.wrap}>
      {threads.length === 0 ? (
        <Text style={s.empty}>
          No messages yet. Feedback and roaster-join inquiries will appear here.
        </Text>
      ) : (
        <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
          {threads.map((th) => (
            <Pressable
              key={th.id}
              onPress={() => openThread(th.id)}
              style={({ pressed }: any) => [s.threadRow, pressed && s.threadRowPressed]}
            >
              <View style={s.avatar}>
                <Text style={s.avatarLetter}>
                  {(th.display_name || th.username || "?")[0].toUpperCase()}
                </Text>
              </View>
              <View style={s.threadText}>
                <Text style={s.threadTitle} numberOfLines={1}>
                  {th.display_name || th.username}
                </Text>
                <Text style={s.threadPreview} numberOfLines={1}>
                  {th.last_sender === "admin" ? "You: " : ""}{th.last_body || ""}
                </Text>
              </View>
              {th.unread_admin > 0 && (
                <View style={s.unreadBadge}>
                  <Text style={s.unreadBadgeText}>{th.unread_admin}</Text>
                </View>
              )}
            </Pressable>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flex: 1, minHeight: 320 } as any,
  empty: {
    fontFamily: t.font["body.regular"],
    fontSize: 13,
    color: t.color["text.muted"],
    textAlign: "center",
    paddingVertical: 40,
    paddingHorizontal: 24,
    lineHeight: 19,
  } as any,

  list: { flex: 1 } as any,
  threadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: t.color.divider,
  } as any,
  threadRowPressed: { backgroundColor: "rgba(215,152,218,0.10)" } as any,
  avatar: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: t.color["text.primary"],
    alignItems: "center", justifyContent: "center",
  } as any,
  avatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 15, color: t.color.bg },
  threadText: { flex: 1, minWidth: 0 } as any,
  threadTitle: { fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.primary"] },
  threadPreview: { fontFamily: t.font["body.regular"], fontSize: 12, color: t.color["text.muted"], marginTop: 2 },
  unreadBadge: {
    minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6,
    backgroundColor: t.color["accent.cta"],
    alignItems: "center", justifyContent: "center",
  } as any,
  unreadBadgeText: { fontFamily: t.font["body.semibold"], fontSize: 11, color: t.color["text.on-cta"] },

  threadHeader: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 8, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: t.color.divider,
  } as any,
  backBtn: { padding: 4 } as any,
  threadName: { fontFamily: t.font["body.semibold"], fontSize: 15, color: t.color["text.primary"], flex: 1 } as any,

  msgs: { flexGrow: 0, maxHeight: 420 } as any,
  msgsContent: { padding: 14, gap: 8 } as any,
  bubbleRow: { flexDirection: "row" } as any,
  rowMine: { justifyContent: "flex-end" } as any,
  rowTheirs: { justifyContent: "flex-start" } as any,
  bubble: { maxWidth: "82%" as any, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 8 } as any,
  bubbleMine: { backgroundColor: t.color["accent.cta"] } as any,
  bubbleTheirs: { backgroundColor: t.color["card.info"] } as any,
  bubbleTextMine: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.on-cta"], lineHeight: 18 } as any,
  bubbleTextTheirs: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.primary"], lineHeight: 18 } as any,

  composer: {
    flexDirection: "row", alignItems: "flex-end", gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: t.color.divider,
  } as any,
  input: {
    flex: 1, maxHeight: 96,
    fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.primary"],
    backgroundColor: t.color["card.subtle"], borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8,
  } as any,
  sendBtn: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: t.color["accent.cta"],
    alignItems: "center", justifyContent: "center",
  } as any,
  sendBtnDisabled: { opacity: 0.4 } as any,
});
