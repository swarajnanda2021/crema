/**
 * ContactCrema — the catalog-only support widget.
 *
 * A floating message button (bottom-right) that opens a chat with Crema
 * (the site admin) ALONE — no peer-to-peer messaging. For feedback or
 * roaster-join inquiries. Logged-in users get the chat; logged-out users
 * get a sign-in prompt. Unread Crema replies show as a badge on the
 * button. Hidden on /auth and for the admin account (who reads + replies
 * from the Inbox tab on the Crema profile instead).
 *
 * Backend: GET /support/my-thread, GET /support/my-unread,
 * POST /support/messages. Mounted once at the root layout (in the
 * chrome-excluding relative wrapper, where the old create-post FAB sat).
 */
import { useState, useEffect, useCallback, useRef } from "react";
import {
  View, Text, Pressable, TextInput, ScrollView, StyleSheet,
} from "react-native";
import { useRouter, usePathname } from "expo-router";
import { MessageCircle, Send, X } from "lucide-react-native";
import { t } from "../tokens/useTokens";
import { useAuth } from "../hooks/useAuth";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { apiFetchRaw } from "../api/client";

interface Msg {
  id: number | string;
  sender: "user" | "admin";
  body: string;
  created_at?: string;
}

export default function ContactCrema() {
  const { user } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { isMobile } = useBreakpoint();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<any>(null);

  // Badge poll (while closed): how many Crema replies the user hasn't
  // seen. Skipped when logged out (no thread) or for the admin (they use
  // the Inbox tab).
  const isAdmin = user?.username === "crema";
  const enabled = !!user && !isAdmin;

  useEffect(() => {
    if (!enabled) { setUnread(0); return; }
    let alive = true;
    const poll = async () => {
      try {
        const r: any = await apiFetchRaw("/support/my-unread");
        const d = r?.data ?? r;
        if (alive) setUnread(d?.unread ?? 0);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 20000);
    return () => { alive = false; clearInterval(id); };
  }, [enabled]);

  const loadThread = useCallback(async () => {
    try {
      const r: any = await apiFetchRaw("/support/my-thread");
      const d = r?.data ?? r;
      setMessages(Array.isArray(d?.messages) ? d.messages : []);
      setUnread(0);
    } catch {}
  }, []);

  // Load + poll for replies while the panel is open.
  useEffect(() => {
    if (!open || !user || isAdmin) return;
    loadThread();
    const id = setInterval(loadThread, 6000);
    return () => clearInterval(id);
  }, [open, user, isAdmin, loadThread]);

  // Keep the latest message in view.
  useEffect(() => {
    if (open) requestAnimationFrame(() => scrollRef.current?.scrollToEnd?.({ animated: true }));
  }, [messages, open]);

  const send = async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    // Optimistic echo so the bubble appears immediately.
    setMessages((m) => [...m, { id: `tmp-${m.length}-${body.length}`, sender: "user", body }]);
    try {
      await apiFetchRaw("/support/messages", {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      await loadThread();
    } catch {
      // Leave the optimistic bubble; a reopen will reconcile from server.
    } finally {
      setSending(false);
    }
  };

  // Hidden on the sign-in screen and for the admin account.
  if (pathname?.startsWith("/auth")) return null;
  if (isAdmin) return null;

  return (
    <>
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={[s.fab, { right: isMobile ? 16 : 28 }]}
        accessibilityLabel="Message Crema"
        accessibilityRole="button"
      >
        {open ? (
          <X size={22} color={t.color["text.on-cta"]} strokeWidth={2.2} />
        ) : (
          <MessageCircle size={22} color={t.color["text.on-cta"]} strokeWidth={2.2} />
        )}
        {!open && unread > 0 && (
          <View style={s.fabBadge}>
            <Text style={s.fabBadgeText}>{unread > 9 ? "9+" : unread}</Text>
          </View>
        )}
      </Pressable>

      {open && (
        <View
          style={[
            s.panel,
            isMobile
              ? { left: 12, right: 12, maxHeight: "70%" as any }
              : { right: 28, width: 360, maxHeight: 520 },
          ]}
        >
          <View style={s.header}>
            <Text style={s.title}>Message Crema</Text>
            <Pressable onPress={() => setOpen(false)} hitSlop={10} accessibilityLabel="Close">
              <X size={18} color={t.color["text.primary"]} strokeWidth={1.75} />
            </Pressable>
          </View>
          <View style={s.divider} />

          {!user ? (
            <View style={s.signedOut}>
              <Text style={s.signedOutText}>
                Sign in to message us — questions, feedback, or want to list your roastery?
              </Text>
              <Pressable
                style={s.signInBtn}
                onPress={() => { setOpen(false); router.push("/auth"); }}
              >
                <Text style={s.signInBtnText}>Sign in</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <ScrollView
                ref={scrollRef}
                style={s.body}
                contentContainerStyle={s.bodyContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                {messages.length === 0 ? (
                  <Text style={s.prompt}>
                    Questions, feedback, or want to list your roastery? Send us a
                    message — we read every one.
                  </Text>
                ) : (
                  messages.map((m) => (
                    <View
                      key={m.id}
                      style={[s.bubbleRow, m.sender === "user" ? s.rowMine : s.rowTheirs]}
                    >
                      <View style={[s.bubble, m.sender === "user" ? s.bubbleMine : s.bubbleTheirs]}>
                        <Text style={m.sender === "user" ? s.bubbleTextMine : s.bubbleTextTheirs}>
                          {m.body}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </ScrollView>

              <View style={s.composer}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Write a message…"
                  placeholderTextColor={t.color["text.muted"]}
                  style={s.input}
                  multiline
                />
                <Pressable
                  onPress={send}
                  disabled={!draft.trim() || sending}
                  style={[s.sendBtn, (!draft.trim() || sending) && s.sendBtnDisabled]}
                  accessibilityLabel="Send"
                >
                  <Send size={18} color={t.color["text.on-cta"]} strokeWidth={2} />
                </Pressable>
              </View>
            </>
          )}
        </View>
      )}
    </>
  );
}

const s = StyleSheet.create({
  fab: {
    position: "absolute",
    bottom: 28,
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: t.color["accent.cta"],
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 6,
  } as any,
  fabBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    backgroundColor: t.color["text.primary"],
    alignItems: "center",
    justifyContent: "center",
  } as any,
  fabBadgeText: {
    fontFamily: t.font["body.semibold"],
    fontSize: 10,
    color: t.color.bg,
  },
  panel: {
    position: "absolute",
    bottom: 92,
    backgroundColor: t.color["card.front"],
    borderRadius: 14,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: t.color.border,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.18,
    shadowRadius: 24,
    elevation: 12,
  } as any,
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
  } as any,
  title: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
  } as any,
  divider: { height: 1, backgroundColor: t.color.divider, marginHorizontal: 0 },

  signedOut: { padding: 20, gap: 14, alignItems: "flex-start" } as any,
  signedOutText: {
    fontFamily: t.font["body.regular"],
    fontSize: 13,
    color: t.color["text.secondary"],
    lineHeight: 19,
  } as any,
  signInBtn: {
    backgroundColor: t.color["accent.cta"],
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
  } as any,
  signInBtnText: {
    fontFamily: t.font["body.semibold"],
    fontSize: 13,
    color: t.color["text.on-cta"],
  } as any,

  body: { flexGrow: 0 } as any,
  bodyContent: { padding: 14, gap: 8 } as any,
  prompt: {
    fontFamily: t.font["body.regular"],
    fontSize: 12.5,
    color: t.color["text.muted"],
    lineHeight: 18,
    paddingVertical: 16,
    paddingHorizontal: 6,
  } as any,
  bubbleRow: { flexDirection: "row" } as any,
  rowMine: { justifyContent: "flex-end" } as any,
  rowTheirs: { justifyContent: "flex-start" } as any,
  bubble: {
    maxWidth: "82%" as any,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  } as any,
  bubbleMine: { backgroundColor: t.color["accent.cta"] } as any,
  bubbleTheirs: { backgroundColor: t.color["card.info"] } as any,
  bubbleTextMine: {
    fontFamily: t.font["body.regular"], fontSize: 13,
    color: t.color["text.on-cta"], lineHeight: 18,
  } as any,
  bubbleTextTheirs: {
    fontFamily: t.font["body.regular"], fontSize: 13,
    color: t.color["text.primary"], lineHeight: 18,
  } as any,

  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: t.color.divider,
  } as any,
  input: {
    flex: 1,
    maxHeight: 96,
    fontFamily: t.font["body.regular"],
    fontSize: 13,
    color: t.color["text.primary"],
    backgroundColor: t.color["card.subtle"],
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  } as any,
  sendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.color["accent.cta"],
    alignItems: "center",
    justifyContent: "center",
  } as any,
  sendBtnDisabled: { opacity: 0.4 } as any,
});
