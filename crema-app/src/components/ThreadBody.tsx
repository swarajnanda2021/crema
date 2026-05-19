/**
 * ThreadBody — generic chat thread surface.
 *
 * Phase 1 has only direct_message threads (café surfaces deferred).
 * Polls every 5s while mounted. Marks read on mount + on each new
 * inbound message.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, Pressable, StyleSheet, Modal, Alert,
  TextInput, ActivityIndicator, ScrollView,
  Keyboard, Platform, KeyboardEvent,
} from "react-native";
import { Image } from "expo-image";
import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import {
  Send, ArrowLeft, Camera, Plus,
  CornerUpLeft, Copy as CopyIcon, Trash2, AlertOctagon, Pin, X as XIcon,
} from "lucide-react-native";
import { useRouter } from "expo-router";
import { t, cardShadow, makeStyles } from "../tokens/useTokens";
import { apiFetchRaw, apiUpload, resolveUploadUrl } from "../api/client";
import { useAuth } from "../hooks/useAuth";
import { useRoasterArticles } from "../hooks/useRoasterArticles";
import { timeAgo, CroppedAvatar } from "./primitives";
import { showToast } from "./shell/Toast";
import { warn as hapticWarn, tap as hapticTap } from "../utils/haptics";
import { parseArticleShareUrl } from "../utils/articleShare";
import {
  TOPIC_LABELS,
  formatArticleDate,
  estimateReadingTime,
} from "../utils/articleMeta";
import type { RoasterArticle } from "../resources/types";

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
  // Long-press reply: when set, this message quotes another. The
  // joined `reply_to_*` fields are the parent message snapshot
  // (see GET /direct-threads/{id}/thread). Null fields = no reply.
  reply_to_message_id?: number | null;
  reply_to_body?: string | null;
  reply_to_image_url?: string | null;
  reply_to_display_name?: string | null;
  reply_to_username?: string | null;
  // Image attachments — set when the user sends a photo via the
  // composer's camera or plus (gallery) button. Image-only messages
  // have body="" + image_url=<path>; captioned photos have both.
  image_url?: string | null;
}

interface PinnedMessage {
  id: number;
  thread_id: number;
  user_id: number;
  body: string;
  created_at: string;
  display_name: string;
  username: string;
}

const POLL_MS = 5000;

/**
 * ArticleBubbleBody — editorial info block rendered INSIDE the chat
 * bubble when a message body matches the article share URL. Same
 * shape the JOURNALS row uses (tag · date / title / byline / excerpt
 * / reading time) so a shared article reads as the same editorial
 * preview wherever it shows up.
 *
 * Text color is constant `text.on-cta` (Espresso) — the bubble bg
 * is either `accent.cta` (pink, constant) for self or `tag.bg`
 * (beige in light / translucent cream in dark) for other; Espresso
 * holds contrast against pink and beige in light, while in dark
 * mode the translucent-cream tag.bg lifts the bubble enough above
 * the dark page bg that Espresso text would lose contrast — so
 * the OTHER bubble swaps to `text.primary` (mode-flipping) and
 * gets the Crema White treatment in dark mode. The styles below
 * encode that split: `*OnPink` variants for the self bubble
 * (constant Espresso), the unsuffixed variants for the other
 * bubble (mode-flipping).
 *
 * Cache miss (the article isn't in `RoasterArticlesProvider` yet —
 * could be unpublished, or outside the 500-article cap) falls back
 * to a simple "Shared article" headline + the URL text. Tapping
 * still routes to the reader, which fetches the full row on mount.
 */
function ArticleBubbleBody({
  article,
  fallbackUrl,
  self,
  onOpen,
}: {
  article: RoasterArticle | null;
  fallbackUrl: string;
  self: boolean;
  onOpen: () => void;
}) {
  const s = useStyles();
  // Self bubble (pink, constant) → Espresso text via `text.on-cta`
  // (also constant). Other bubble (`tag.bg`: beige in light /
  // translucent cream in dark) → `text.primary`, which flips
  // Espresso ↔ Crema White so the editorial info stays readable in
  // both modes — same contrast pairing the regular text bubble
  // already uses.
  //
  // The "Read article" CTA pill flips to suit each bubble: the self
  // bubble already uses pink, so its CTA is an Espresso pill (the
  // brand's other constant); the other bubble uses tag.bg, so its
  // CTA is the canonical Crema-pink CTA pill.
  const titleStyle = self ? s.articleTitleOnPink : s.articleTitle;
  const bylineStyle = self ? s.articleBylineOnPink : s.articleByline;
  const excerptStyle = self ? s.articleExcerptOnPink : s.articleExcerpt;
  const metaStyle = self ? s.articleMetaOnPink : s.articleMeta;
  const ctaStyle = self ? s.articleCtaOnPink : s.articleCta;
  const ctaLabelStyle = self ? s.articleCtaLabelOnPink : s.articleCtaLabel;
  if (!article) {
    return (
      <View style={s.articleBlock}>
        <Text style={titleStyle} numberOfLines={2}>Shared article</Text>
        <Text style={metaStyle} numberOfLines={1} ellipsizeMode="middle">
          {fallbackUrl}
        </Text>
        <Pressable onPress={onOpen} style={ctaStyle} accessibilityRole="button">
          <Text style={ctaLabelStyle}>Read article →</Text>
        </Pressable>
      </View>
    );
  }
  const tagLabel = article.topic_category
    ? TOPIC_LABELS[article.topic_category] || null
    : null;
  const readingTime = estimateReadingTime(article.word_count);
  return (
    <View testID={`chat-article-unfurl-${article.id}`} style={s.articleBlock}>
      {tagLabel ? (
        <View style={s.articleMetaRow}>
          <Text style={metaStyle}>{tagLabel}</Text>
        </View>
      ) : null}
      <Text style={titleStyle} numberOfLines={3}>
        {article.title}
      </Text>
      {article.roaster_name ? (
        <Text style={bylineStyle} numberOfLines={1}>
          By {article.roaster_name}
        </Text>
      ) : null}
      {article.excerpt ? (
        <Text style={excerptStyle}>{article.excerpt}</Text>
      ) : null}
      {readingTime ? (
        <Text style={metaStyle}>{readingTime}</Text>
      ) : null}
      <Pressable onPress={onOpen} style={ctaStyle} accessibilityRole="button">
        <Text style={ctaLabelStyle}>Read article →</Text>
      </Pressable>
    </View>
  );
}


// Generic URL detection — returns a non-article URL when the body is
// exactly a URL (so a typed sentence containing a URL inline doesn't
// collapse to a preview card). Article URLs are filtered out so the
// existing editorial-article unfurl handles them.
const _GENERIC_URL_PATTERN = /^\s*(https?:\/\/[^\s]+)\s*$/i;
function parseGenericUrl(body: string | null | undefined): string | null {
  if (!body) return null;
  if (parseArticleShareUrl(body) != null) return null;
  const m = body.match(_GENERIC_URL_PATTERN);
  return m ? m[1] : null;
}

// In-memory cache keyed by URL — avoids refetching /link-preview as
// the chat polls + re-renders. Survives mounts/unmounts of the
// thread; cleared on app reload.
const _linkPreviewCache: Map<string, {
  title?: string;
  description?: string;
  image_url?: string;
  domain?: string;
}> = new Map();

// MobileFooter is a sibling of the chat surface at the root layout.
// When the iOS keyboard pops, its reported height (`endCoordinates.height`)
// includes the footer's space (it spans from keyboard top to screen
// bottom). We subtract the footer height so the composer lands flush
// with the keyboard top, not 71-px above it.
const FOOTER_HEIGHT = 71;

export default function ThreadBody({ kind, id, onBack, onClose }: Props) {
  const { user } = useAuth();
  const router = useRouter();
  const articleCache = useRoasterArticles();
  const [thread, setThread] = useState<any>(null);
  // Manual keyboard tracking — `<KeyboardAvoidingView>` measures its
  // own frame to compute the overlap, but inside this nested layout
  // (Stack → (tabs)/_layout → MessagesDropdown card → ThreadBody) the
  // measure is unreliable. Listening directly to keyboard events and
  // applying paddingBottom ourselves is the simplest, deterministic
  // path.
  const [keyboardPad, setKeyboardPad] = useState(0);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [pinnedMessage, setPinnedMessage] = useState<PinnedMessage | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Long-press menu — populated when the user long-presses a bubble.
  // Renders the floating ChatMessageMenu modal with Reply / Copy /
  // Delete for you / Report / Pin (or Unpin).
  const [menuMessage, setMenuMessage] = useState<ThreadMessage | null>(null);
  // Active reply target — set when the user picks Reply from the
  // menu. The composer paints an indicator above the input until
  // sent or cancelled; the next send carries `reply_to_message_id`.
  const [replyTo, setReplyTo] = useState<ThreadMessage | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const pollRef = useRef<any>(null);
  const lastMessageCount = useRef(0);
  const inputRef = useRef<TextInput>(null);
  const s = useStyles();

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
      setPinnedMessage(data?.thread?.pinned_message ?? null);
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

  // Keyboard avoidance — listen for show/hide events and apply
  // padding to the chat surface so the composer sits flush with the
  // keyboard top. iOS uses `keyboardWillShow/Hide` (animated, fires
  // before the keyboard moves so the layout transition reads as one
  // motion); Android uses `keyboardDidShow/Hide` (the only events
  // it surfaces). On web, neither event fires — paddingBottom stays
  // 0 and the browser handles input visibility itself.
  useEffect(() => {
    if (Platform.OS === "web") return;
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const onShow = (e: KeyboardEvent) => {
      const h = e.endCoordinates?.height ?? 0;
      // Subtract the footer height — the keyboard's reported height
      // spans from its top to the screen bottom and the footer
      // already paints inside that band. Subtract the bottom safe-
      // inset too because the footer's own 71 px includes it; if
      // we subtract footerHeight alone we'd double-count.
      const pad = Math.max(0, h - FOOTER_HEIGHT);
      setKeyboardPad(pad);
      // Scroll to bottom on keyboard show so the latest message
      // stays visible above the composer.
      requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }));
    };
    const onHide = () => setKeyboardPad(0);
    const showSub = Keyboard.addListener(showEvt, onShow);
    const hideSub = Keyboard.addListener(hideEvt, onHide);
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

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
      const payload: any = { body: text };
      if (replyTo) payload.reply_to_message_id = replyTo.id;
      const raw = await apiFetchRaw<any>(postUrl, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const msg = raw?.data ?? raw;
      setMessages((prev) => [...prev, msg]);
      setDraft("");
      setReplyTo(null);
    } catch (e: any) {
      setError(e?.message || "Couldn't send. Try again?");
    } finally {
      setSending(false);
    }
  }, [draft, postUrl, sending, replyTo]);

  // ── Image attachments (camera + gallery) ──────────────────────
  // Pick an image from the device camera or photo library, upload
  // to /api/upload/image?purpose=dm, then send a DM with image_url
  // populated. Body is empty for image-only messages; the backend
  // accepts (body OR image_url). Reuses the same multipart upload
  // pattern as the post composer (ImageUploadModal).
  const pickAndSendImage = useCallback(async (source: "camera" | "gallery") => {
    if (sending) return;
    try {
      // Permissions — camera needs the request; gallery is open.
      if (source === "camera") {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) {
          showToast("Camera permission denied");
          return;
        }
      }
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({ quality: 0.8, allowsEditing: false })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ImagePicker.MediaTypeOptions.Images,
              quality: 0.8,
              allowsEditing: false,
            });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];

      setSending(true);
      // Build the multipart body — web reads asset.uri as a blob;
      // native uses the file URI directly with the RN-friendly
      // {uri, name, type} shape.
      const filename = (asset.uri.split("/").pop() || `photo_${Date.now()}.jpg`)
        .replace(/[^a-zA-Z0-9._-]/g, "_");
      const formData = new FormData();
      if (Platform.OS === "web") {
        const fetched = await fetch(asset.uri);
        const blob = await fetched.blob();
        formData.append("file", blob, filename);
      } else {
        const ext = (filename.match(/\.([a-z0-9]+)$/i)?.[1] || "jpg").toLowerCase();
        const mime = asset.mimeType || `image/${ext === "jpg" ? "jpeg" : ext}`;
        formData.append("file", { uri: asset.uri, name: filename, type: mime } as any);
      }

      const upRaw = await apiUpload<{ url: string }>(
        "/upload/image?purpose=dm",
        formData,
      );
      const uploadedPath = (upRaw as any)?.data?.url ?? (upRaw as any)?.url;
      if (!uploadedPath) {
        showToast("Upload failed — try again");
        return;
      }

      const payload: any = { body: "", image_url: uploadedPath };
      if (replyTo) payload.reply_to_message_id = replyTo.id;
      const raw = await apiFetchRaw<any>(postUrl, {
        method: "POST",
        body: JSON.stringify(payload),
      });
      const msg = raw?.data ?? raw;
      setMessages((prev) => [...prev, msg]);
      setReplyTo(null);
    } catch (e: any) {
      console.warn("Image send failed:", e);
      showToast("Couldn't send image");
    } finally {
      setSending(false);
    }
  }, [sending, postUrl, replyTo]);

  // ── Long-press menu actions ───────────────────────────────────
  const closeMenu = useCallback(() => setMenuMessage(null), []);

  const onLongPressMessage = useCallback((m: ThreadMessage) => {
    hapticWarn();
    setMenuMessage(m);
  }, []);

  const onPickReply = useCallback(() => {
    if (!menuMessage) return;
    setReplyTo(menuMessage);
    setMenuMessage(null);
    // Pop the keyboard so the user can type their reply immediately.
    setTimeout(() => inputRef.current?.focus(), 200);
  }, [menuMessage]);

  const onPickCopy = useCallback(async () => {
    if (!menuMessage) return;
    try {
      await Clipboard.setStringAsync(menuMessage.body);
      showToast("Copied to clipboard");
    } catch {
      showToast("Couldn't copy");
    }
    setMenuMessage(null);
  }, [menuMessage]);

  const onPickDelete = useCallback(async () => {
    const m = menuMessage;
    if (!m) return;
    setMenuMessage(null);
    // Optimistic remove. If the server rejects, the next poll will
    // reconcile (the message reappears) — same pattern as the
    // thread-level delete.
    setMessages((prev) => prev.filter((row) => row.id !== m.id));
    try {
      await apiFetchRaw(`/direct-messages/${m.id}`, { method: "DELETE" });
      showToast("Deleted for you");
    } catch {
      showToast("Couldn't delete — try again");
      fetchThread({ silent: true });
    }
  }, [menuMessage, fetchThread]);

  const onPickReport = useCallback(() => {
    const m = menuMessage;
    if (!m) return;
    setMenuMessage(null);
    Alert.alert(
      "Report message?",
      "We'll review this message. The other person won't be notified you reported it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Report",
          style: "destructive",
          onPress: async () => {
            try {
              await apiFetchRaw("/direct-message-reports", {
                method: "POST",
                body: JSON.stringify({ message_id: m.id }),
              });
              showToast("Reported");
            } catch {
              showToast("Couldn't send report");
            }
          },
        },
      ],
    );
  }, [menuMessage]);

  const onPickPin = useCallback(async () => {
    const m = menuMessage;
    if (!m) return;
    setMenuMessage(null);
    const isAlreadyPinned = pinnedMessage?.id === m.id;
    const targetId = isAlreadyPinned ? null : m.id;
    // Optimistic: paint the new pin (or clear) immediately.
    setPinnedMessage(
      targetId == null
        ? null
        : ({
            id: m.id,
            thread_id: m.id /* not used by banner */,
            user_id: m.user_id,
            body: m.body,
            created_at: m.created_at,
            display_name: m.display_name,
            username: m.username,
          } as PinnedMessage),
    );
    try {
      await apiFetchRaw(`/direct-threads/${id}/pin`, {
        method: "POST",
        body: JSON.stringify({ message_id: targetId }),
      });
      showToast(isAlreadyPinned ? "Unpinned" : "Pinned");
    } catch {
      showToast("Couldn't update pin");
      fetchThread({ silent: true });
    }
  }, [menuMessage, pinnedMessage, id, fetchThread]);

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

  // Manual keyboard avoidance — the chat surface gets `paddingBottom`
  // equal to the visible keyboard height (minus the footer band the
  // keyboard already covers) so the composer lands flush with the
  // keyboard top while the keyboard is open. `KeyboardAvoidingView`'s
  // own measure is unreliable inside the nested (Stack → (tabs) →
  // dropdown card → here) layout; the explicit listener-driven pad
  // is the deterministic path.
  return (
    <View testID="chat-thread" style={[s.root, keyboardPad > 0 && { paddingBottom: keyboardPad }]}>
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
            size={36}
          />
        ) : (
          <View style={s.avatarFb}>
            <Text style={s.avatarLetter}>{(counterparty.name || "?")[0].toUpperCase()}</Text>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.title} numberOfLines={1}>{counterparty.name}</Text>
        </View>
      </View>

      {/* Pinned-message banner — sits above the message list, visible
         to both parties. Tap scrolls to the pinned message; the
         message's own long-press menu clears the pin. When the
         pinned message body is exactly the article share URL, the
         banner renders the article TITLE instead of the raw URL —
         the URL is opaque to the reader, the title is the actual
         content the sender meant to surface. */}
      {(() => {
        if (!pinnedMessage) return null;
        const sharedArticleId = parseArticleShareUrl(pinnedMessage.body);
        const sharedArticle = sharedArticleId
          ? articleCache.getById(sharedArticleId)
          : null;
        const previewText =
          sharedArticleId && sharedArticle?.title
            ? sharedArticle.title
            : sharedArticleId
              ? "Shared article"
              : pinnedMessage.body;
        return (
          <Pressable
            onPress={() => {
              hapticTap();
              if (sharedArticleId) {
                router.push(`/article/${sharedArticleId}` as any);
                return;
              }
              scrollRef.current?.scrollTo({ y: 0, animated: true });
            }}
            style={s.pinBanner}
            accessibilityRole="button"
            accessibilityLabel="Open pinned message"
          >
            <Pin size={14} color={t.color["text.primary"]} strokeWidth={2} />
            <View style={s.pinBannerBody}>
              <Text style={s.pinBannerLabel} numberOfLines={1}>
                Pinned · {pinnedMessage.display_name}
              </Text>
              <Text style={s.pinBannerText} numberOfLines={1} ellipsizeMode="tail">
                {previewText}
              </Text>
            </View>
          </Pressable>
        );
      })()}

      <ScrollView
        ref={scrollRef}
        style={s.messages}
        contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 10, gap: 7 }}
        showsVerticalScrollIndicator={false}
      >
        {loading && messages.length === 0 ? (
          <ActivityIndicator size="small" color={t.color.accent} style={{ marginTop: 18 }} />
        ) : messages.length === 0 ? (
          <Text style={s.emptyText}>Say hi 👋 — {counterparty.name} is waiting to hear from you.</Text>
        ) : (
          messages.map((m) => {
            const self = m.user_id === user?.id;
            // Detect-on-render: when a message body is exactly the
            // canonical article share URL, swap the body content for
            // an inline editorial block (tag · date · title · byline
            // · excerpt · reading time) wrapped in the same self/other
            // bubble chrome. Detection happens at render time (not on
            // send) so no schema migration is needed — every existing
            // message stays plain text and any pasted URL automatically
            // unfurls.
            const sharedArticleId = parseArticleShareUrl(m.body);
            const sharedArticle = sharedArticleId
              ? articleCache.getById(sharedArticleId)
              : null;
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
                      size={24}
                    />
                  ) : (
                    <View style={s.avatarFbSmall}>
                      <Text style={s.avatarLetterSmall}>
                        {(m.display_name || "?")[0].toUpperCase()}
                      </Text>
                    </View>
                  )
                )}
                {sharedArticleId ? (
                  <Pressable
                    onPress={() => router.push(`/article/${sharedArticleId}` as any)}
                    onLongPress={() => onLongPressMessage(m)}
                    delayLongPress={350}
                    style={[
                      s.bubble,
                      s.articleBubble,
                      self ? s.bubbleSelf : s.bubbleOther,
                    ]}
                    accessibilityRole="link"
                    accessibilityLabel={
                      sharedArticle?.title
                        ? `Open article: ${sharedArticle.title}`
                        : "Open shared article"
                    }
                  >
                    {m.reply_to_message_id ? (
                      <ReplyQuote message={m} self={self} />
                    ) : null}
                    <ArticleBubbleBody
                      article={sharedArticle}
                      fallbackUrl={m.body.trim()}
                      self={self}
                      onOpen={() => router.push(`/article/${sharedArticleId}` as any)}
                    />
                    <Text style={[s.bubbleTime, self && s.bubbleTimeSelf]}>
                      {timeAgo(m.created_at)}
                    </Text>
                  </Pressable>
                ) : m.image_url ? (
                  <Pressable
                    onLongPress={() => onLongPressMessage(m)}
                    delayLongPress={350}
                    style={[s.bubble, s.imageBubble, self ? s.bubbleSelf : s.bubbleOther]}
                  >
                    {m.reply_to_message_id ? (
                      <ReplyQuote message={m} self={self} />
                    ) : null}
                    <View style={s.imageBubbleImageWrap}>
                      <Image
                        source={{ uri: resolveUploadUrl(m.image_url) || m.image_url }}
                        style={s.imageBubbleImage}
                        contentFit="cover"
                        transition={200}
                      />
                    </View>
                    {m.body ? (
                      <Text style={[s.bubbleText, self && s.bubbleTextSelf, s.imageBubbleCaption]}>
                        {m.body}
                      </Text>
                    ) : null}
                    <Text style={[s.bubbleTime, self && s.bubbleTimeSelf]}>
                      {timeAgo(m.created_at)}
                    </Text>
                  </Pressable>
                ) : parseGenericUrl(m.body) ? (
                  <Pressable
                    onLongPress={() => onLongPressMessage(m)}
                    delayLongPress={350}
                    style={[s.bubble, s.articleBubble, self ? s.bubbleSelf : s.bubbleOther]}
                  >
                    {m.reply_to_message_id ? (
                      <ReplyQuote message={m} self={self} />
                    ) : null}
                    <UrlPreviewBubbleBody url={parseGenericUrl(m.body)!} self={self} />
                    <Text style={[s.bubbleTime, self && s.bubbleTimeSelf]}>
                      {timeAgo(m.created_at)}
                    </Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onLongPress={() => onLongPressMessage(m)}
                    delayLongPress={350}
                    style={[s.bubble, self ? s.bubbleSelf : s.bubbleOther]}
                  >
                    {m.reply_to_message_id ? (
                      <ReplyQuote message={m} self={self} />
                    ) : null}
                    <Text style={[s.bubbleText, self && s.bubbleTextSelf]}>{m.body}</Text>
                    <Text style={[s.bubbleTime, self && s.bubbleTimeSelf]}>
                      {timeAgo(m.created_at)}
                    </Text>
                  </Pressable>
                )}
              </View>
            );
          })
        )}
      </ScrollView>

      {error && <Text style={s.error}>{error}</Text>}

      {/* Reply indicator — visible while a reply target is set; the
         next send carries `reply_to_message_id`. The X clears the
         reply. */}
      {replyTo ? (
        <View style={s.replyIndicator}>
          <View style={s.replyIndicatorBar} />
          <View style={s.replyIndicatorBody}>
            <Text style={s.replyIndicatorLabel}>
              Replying to {replyTo.display_name}
            </Text>
            <Text style={s.replyIndicatorText} numberOfLines={1} ellipsizeMode="tail">
              {replyTo.body}
            </Text>
          </View>
          <Pressable
            onPress={() => setReplyTo(null)}
            hitSlop={6}
            style={s.replyIndicatorCancel}
            accessibilityLabel="Cancel reply"
          >
            <XIcon size={14} color={t.color["text.primary"]} />
          </Pressable>
        </View>
      ) : null}

      <View style={s.composer}>
        {/* Single thin pill — camera left, text middle, send/plus
           right (the right icon swaps on draft state, IG-style:
           empty → Plus for attachments, typed → pink Send).
           Camera + Plus are stubs for now; image upload + further
           attachments arrive in a follow-up. */}
        <View style={s.composerPill}>
          <Pressable
            onPress={() => pickAndSendImage("camera")}
            hitSlop={4}
            style={s.composerIcon}
            accessibilityRole="button"
            accessibilityLabel="Take a photo"
          >
            <Camera size={18} color={t.color["text.primary"]} strokeWidth={1.75} />
          </Pressable>
          <TextInput
            testID="thread-compose-input"
            ref={inputRef}
            style={s.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={`Message ${counterparty.name}…`}
            placeholderTextColor={t.color["text.muted"]}
            multiline
            maxLength={2000}
            editable={!sending}
            onSubmitEditing={send}
          />
          {draft.trim() ? (
            <Pressable
              testID="thread-send-btn"
              onPress={send}
              disabled={sending}
              style={[s.composerSendBtn, sending && { opacity: 0.5 }]}
              accessibilityLabel="Send message"
              accessibilityRole="button"
            >
              {sending ? (
                <ActivityIndicator size="small" color={t.color["text.on-cta"]} />
              ) : (
                <Send size={16} color={t.color["text.on-cta"]} strokeWidth={2.2} />
              )}
            </Pressable>
          ) : (
            <Pressable
              onPress={() => pickAndSendImage("gallery")}
              hitSlop={4}
              style={s.composerIcon}
              accessibilityRole="button"
              accessibilityLabel="Pick a photo from gallery"
            >
              <Plus size={18} color={t.color["text.primary"]} strokeWidth={1.75} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Long-press action sheet — Reply / Copy / Delete for you /
         Report / Pin (or Unpin if the message is already pinned).
         Mounted as a centered modal with a tappable backdrop. */}
      <ChatMessageMenu
        message={menuMessage}
        isPinned={!!(menuMessage && pinnedMessage?.id === menuMessage.id)}
        onClose={closeMenu}
        onReply={onPickReply}
        onCopy={onPickCopy}
        onDelete={onPickDelete}
        onReport={onPickReport}
        onPin={onPickPin}
      />
    </View>
  );
}

/**
 * UrlPreviewBubbleBody — generic URL preview rendered inside the
 * chat bubble, similar in shape to the article unfurl but for
 * arbitrary links. Hits `/api/link-preview` lazily on mount, caches
 * by URL across the app's session.
 *
 * Visual: the same editorial body the article unfurl uses (small
 * domain row, title, optional description), but with the link's
 * Open Graph data instead of an article record. Tapping the bubble
 * opens the URL in the system browser.
 *
 * Self bubble (pink): Espresso text via `text.on-cta`. Other bubble
 * (tag.bg): `text.primary` (Espresso ↔ Crema White flipping).
 */
function UrlPreviewBubbleBody({
  url,
  self,
}: {
  url: string;
  self: boolean;
}) {
  const s = useStyles();
  const [data, setData] = useState<any>(_linkPreviewCache.get(url) ?? null);
  const [loading, setLoading] = useState(!_linkPreviewCache.has(url));

  useEffect(() => {
    if (_linkPreviewCache.has(url)) {
      setData(_linkPreviewCache.get(url));
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    apiFetchRaw<any>(`/link-preview?url=${encodeURIComponent(url)}`)
      .then((raw) => {
        if (cancelled) return;
        const d = raw?.data ?? raw;
        _linkPreviewCache.set(url, d);
        setData(d);
      })
      .catch(() => {
        if (cancelled) return;
        const fallback = { title: "", description: "", image_url: "", domain: hostFromUrl(url) };
        _linkPreviewCache.set(url, fallback);
        setData(fallback);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [url]);

  const titleStyle = self ? s.articleTitleOnPink : s.articleTitle;
  const metaStyle = self ? s.articleMetaOnPink : s.articleMeta;
  const excerptStyle = self ? s.articleExcerptOnPink : s.articleExcerpt;
  const ctaStyle = self ? s.articleCtaOnPink : s.articleCta;
  const ctaLabelStyle = self ? s.articleCtaLabelOnPink : s.articleCtaLabel;

  const title = data?.title || hostFromUrl(url) || "Link";
  const domain = data?.domain || hostFromUrl(url);
  const description = data?.description || "";

  const openLink = () => {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.open(url, "_blank");
    } else {
      // Native: defer to system. expo-linking would be cleaner but
      // imports are limited here; the parent bubble has its own
      // tap path that calls openExternal in a similar context.
      // For now, the existing openExternal helper would do — kept
      // simple so this preview is purely a render.
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { Linking } = require("react-native");
        Linking.openURL(url).catch(() => {});
      } catch {}
    }
  };

  return (
    <View style={s.articleBlock}>
      {domain ? (
        <View style={s.articleMetaRow}>
          <Text style={metaStyle}>{domain}</Text>
        </View>
      ) : null}
      {loading && !data ? (
        <Text style={titleStyle} numberOfLines={2}>Loading preview…</Text>
      ) : (
        <Text style={titleStyle} numberOfLines={3}>
          {title}
        </Text>
      )}
      {description ? (
        <Text style={excerptStyle} numberOfLines={3}>{description}</Text>
      ) : null}
      <Pressable onPress={openLink} style={ctaStyle} accessibilityRole="link">
        <Text style={ctaLabelStyle}>Open link →</Text>
      </Pressable>
    </View>
  );
}

function hostFromUrl(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0] || url;
  }
}


// ── Sub-components ───────────────────────────────────────────────

/** Long-press action sheet — Reply / Copy / Delete for you / Report
 *  / Pin (or Unpin). Mirrors the WhatsApp / Telegram "tap on a
 *  message → menu" pattern: centered modal with a backdrop, vertical
 *  list of icon+label rows. Report uses Crema pink (the brand's only
 *  warning-adjacent color — DESIGN_LANGUAGE.md "no fourth color"
 *  rule blocks red/coral).
 */
function ChatMessageMenu({
  message,
  isPinned,
  onClose,
  onReply,
  onCopy,
  onDelete,
  onReport,
  onPin,
}: {
  message: ThreadMessage | null;
  isPinned: boolean;
  onClose: () => void;
  onReply: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onReport: () => void;
  onPin: () => void;
}) {
  const s = useStyles();
  const visible = !!message;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={s.menuBackdrop} onPress={onClose}>
        <View style={s.menuCard}>
          <MenuRow
            icon={<CornerUpLeft size={20} color={t.color["text.primary"]} strokeWidth={1.75} />}
            label="Reply"
            onPress={onReply}
          />
          <MenuRow
            icon={<CopyIcon size={20} color={t.color["text.primary"]} strokeWidth={1.75} />}
            label="Copy"
            onPress={onCopy}
          />
          <MenuRow
            icon={<Trash2 size={20} color={t.color["text.primary"]} strokeWidth={1.75} />}
            label="Delete for you"
            onPress={onDelete}
          />
          <MenuRow
            icon={<AlertOctagon size={20} color={t.color["accent.cta"]} strokeWidth={1.75} />}
            label="Report"
            onPress={onReport}
            destructive
          />
          <MenuRow
            icon={<Pin size={20} color={t.color["text.primary"]} strokeWidth={1.75} />}
            label={isPinned ? "Unpin" : "Pin"}
            onPress={onPin}
            isLast
          />
        </View>
      </Pressable>
    </Modal>
  );
}

function MenuRow({
  icon,
  label,
  onPress,
  destructive,
  isLast,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
  destructive?: boolean;
  isLast?: boolean;
}) {
  const s = useStyles();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.menuRow,
        !isLast && s.menuRowDivider,
        pressed && s.menuRowPressed,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <View style={s.menuRowIcon}>{icon}</View>
      <Text style={[s.menuRowLabel, destructive && s.menuRowLabelDestructive]}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Inline reply quote rendered inside the bubble, above the body.
 *  Mirrors WhatsApp's reply visual: a slim left bar + sender name +
 *  truncated original body, all colored to match the bubble's text
 *  rule (Espresso on pink, mode-flipping text.primary on tag.bg).
 */
function ReplyQuote({
  message,
  self,
}: {
  message: ThreadMessage;
  self: boolean;
}) {
  const s = useStyles();
  const senderStyle = self ? s.replyQuoteSenderOnPink : s.replyQuoteSender;
  const bodyStyle = self ? s.replyQuoteBodyOnPink : s.replyQuoteBody;
  const barStyle = self ? s.replyQuoteBarOnPink : s.replyQuoteBar;
  return (
    <View style={s.replyQuote}>
      <View style={barStyle} />
      <View style={s.replyQuoteText}>
        <Text style={senderStyle} numberOfLines={1}>
          {message.reply_to_display_name || message.reply_to_username || "User"}
        </Text>
        <Text style={bodyStyle} numberOfLines={2}>
          {message.reply_to_body}
        </Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  root: { flex: 1, backgroundColor: t.color.bg } as any,
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
    paddingHorizontal: t.spacing.lg, paddingTop: t.spacing.md, paddingBottom: t.spacing.md,
    borderBottomWidth: 1, borderBottomColor: t.color["border.light"],
  } as any,
  title: { fontFamily: t.font["body.semibold"], fontSize: t.size["font.lg"], color: t.color["text.primary"] },
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
  avatarLetter: { fontFamily: t.font["body.semibold"], fontSize: t.size["font.md"], color: t.color.bg },
  avatarFbSmall: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: t.color["text.primary"],
    alignItems: "center", justifyContent: "center",
  } as any,
  avatarLetterSmall: { fontFamily: t.font["body.semibold"], fontSize: t.size["font.sm"], color: t.color.bg },
  messages: { flex: 1 } as any,
  emptyText: {
    fontFamily: t.font["body.regular"], fontSize: t.size["font.md"],
    color: t.color["text.muted"], textAlign: "center", paddingVertical: t.spacing["3xl"],
    paddingHorizontal: t.spacing.lg,
  } as any,
  bubbleRow: { flexDirection: "row", alignItems: "flex-end", gap: t.spacing.sm } as any,
  bubbleRowSelf: { justifyContent: "flex-end" } as any,
  bubbleRowOther: { justifyContent: "flex-start" } as any,
  // Bubble sizing matches the feed's mobile rhythm — same 15-pt body
  // text and tight inset / radius proportions used by the post cards.
  // The bubble's maxWidth keeps long messages within ~80% of the
  // viewport so the corner-knot visual reads correctly.
  bubble: {
    maxWidth: "78%" as any,
    paddingHorizontal: t.spacing.md, paddingVertical: t.spacing.sm,
    borderRadius: t.radius.lg,
    gap: 2,
  } as any,
  // Self-sent messages take the brand's "I-took-this-action" color
  // (Crema pink, constant in both modes), pairing with the constant
  // Espresso `text.on-cta` for body text and a 70%-Espresso time
  // stamp. Other-party messages take the brand's neutral tinted
  // surface (`tag.bg`: beige in light / translucent cream in dark)
  // — the only mode-flipping "soft surface" the palette ships, so
  // the bubble reads as a distinct lift on the page bg in both
  // modes without introducing a fourth color. Body text uses
  // `text.primary` (Espresso → Crema White) so it always contrasts
  // the tag.bg in either mode. Sender display name dropped — color
  // alone signals the side, the avatar to the left identifies the
  // sender for screen readers.
  bubbleSelf: { backgroundColor: t.color["accent.cta"], borderBottomRightRadius: t.radius.xs } as any,
  bubbleOther: { backgroundColor: t.color["tag.bg"], borderBottomLeftRadius: t.radius.xs } as any,
  bubbleText: {
    fontFamily: t.font["body.regular"], fontSize: t.size["font.md"],
    color: t.color["text.primary"], lineHeight: 20,
  },
  bubbleTextSelf: { color: t.color["text.on-cta"] } as any,
  bubbleTime: { fontFamily: t.font["body.regular"], fontSize: t.size["font.xs"], color: t.color["text.muted"] } as any,
  bubbleTimeSelf: { color: "rgba(53,17,1,0.7)" } as any,
  // Article-share bubble — sits inside the same `bubble` chrome as
  // a regular text message (so it inherits the self/other bg). Wider
  // maxWidth (88%) than a text bubble because the editorial info
  // block (tag/date · title · byline · excerpt · reading time)
  // wants room to read; tighter inner padding so the title + body
  // don't crowd the bubble corners.
  articleBubble: {
    maxWidth: "88%" as any,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.md,
  } as any,
  // Image bubble — same self/other bg chrome as text bubbles, but
  // with a tighter inner padding around the photo. The photo
  // itself fills the bubble width and uses an aspect-fit container
  // so the bubble grows proportionally to the photo.
  imageBubble: {
    maxWidth: "78%" as any,
    paddingHorizontal: 4,
    paddingVertical: 4,
    gap: 4,
  } as any,
  imageBubbleImageWrap: {
    width: "100%" as any,
    aspectRatio: 4 / 3,
    borderRadius: t.radius.md,
    overflow: "hidden",
    backgroundColor: t.color["card.info"],
  } as any,
  imageBubbleImage: {
    width: "100%" as any,
    height: "100%" as any,
  } as any,
  imageBubbleCaption: {
    paddingHorizontal: t.spacing.sm,
    paddingTop: 2,
  } as any,
  articleBlock: {
    gap: t.spacing.xs,
  } as any,
  // Editorial info text — colors are the same `text.on-cta` /
  // `text.muted` pair the rest of the bubble uses, so the article
  // info inherits the bubble's mode-aware contrast without any new
  // tokens. Title sits at `font.lg` (16) — one notch down from the
  // JOURNALS row's `font.xl` so it fits the bubble's tighter
  // horizontal footprint.
  articleMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
  } as any,
  // OTHER bubble (tag.bg) — text.primary flips Espresso ↔ Crema
  // White so the article info reads in both modes against beige
  // (light) and the translucent-cream-on-dark bubble (dark).
  articleMeta: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    opacity: 0.65,
    letterSpacing: 0.2,
  } as any,
  articleTitle: {
    fontFamily: t.font.display,
    fontSize: t.size["font.lg"],
    lineHeight: 22,
    color: t.color["text.primary"],
  } as any,
  articleByline: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    opacity: 0.8,
  } as any,
  articleExcerpt: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    lineHeight: 20,
    color: t.color["text.primary"],
    marginTop: t.spacing.xs,
  } as any,
  // SELF bubble (pink, constant) — text.on-cta is constant Espresso,
  // which holds contrast against pink in both modes.
  articleMetaOnPink: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.on-cta"],
    opacity: 0.7,
    letterSpacing: 0.2,
  } as any,
  articleTitleOnPink: {
    fontFamily: t.font.display,
    fontSize: t.size["font.lg"],
    lineHeight: 22,
    color: t.color["text.on-cta"],
  } as any,
  articleBylineOnPink: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.on-cta"],
    opacity: 0.85,
  } as any,
  articleExcerptOnPink: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    lineHeight: 20,
    color: t.color["text.on-cta"],
    marginTop: t.spacing.xs,
  } as any,
  // "Read article →" CTA pill — sits below the reading-time line,
  // before the message timestamp. The pill makes the tap affordance
  // explicit (the entire bubble is also tappable, but a long bubble
  // with title + body + excerpt benefits from a clear "go" target).
  // Self bubble (pink) → Espresso pill with constant Crema White
  // text — Espresso is the only constant brand color that contrasts
  // pink. Other bubble (tag.bg) → canonical Crema-pink CTA + Espresso
  // text, the same pill style used by the article reader's "Read
  // the original" button.
  articleCta: {
    alignSelf: "flex-start" as any,
    flexDirection: "row" as any,
    alignItems: "center" as any,
    backgroundColor: t.color["accent.cta"],
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.xs + 2,
    borderRadius: t.radius.full,
    marginTop: t.spacing.sm,
  } as any,
  articleCtaOnPink: {
    alignSelf: "flex-start" as any,
    flexDirection: "row" as any,
    alignItems: "center" as any,
    backgroundColor: t.color["text.on-cta"],
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.xs + 2,
    borderRadius: t.radius.full,
    marginTop: t.spacing.sm,
  } as any,
  articleCtaLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.on-cta"],
    letterSpacing: 0.4,
  } as any,
  articleCtaLabelOnPink: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.on-dark"],
    letterSpacing: 0.4,
  } as any,
  error: {
    fontFamily: t.font["body.medium"], fontSize: 10,
    color: t.color["accent.cta"], textAlign: "center", paddingVertical: 3,
  } as any,
  // Composer strip — tight padding around a single thin pill that
  // hosts the camera (left), TextInput (middle), and a state-
  // swapping right icon (Plus when empty, pink Send when typing).
  // Inspired by IG's chat composer: pill-shaped, icons baked in,
  // minimal vertical footprint so the messages list keeps as much
  // space as possible.
  composer: {
    flexDirection: "row",
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: t.color["border.light"],
  } as any,
  // Pill geometry — height LOCKED at 46 so the semicircular caps at
  // each end have a known, fixed radius (23). The math for the
  // camera / plus / send buttons to land concentric with those
  // semicircles depends on the pill staying this exact height
  // regardless of the input's content size:
  //
  //   semicircleCenterX = pillLeft + pillHeight/2 = pillLeft + 23
  //   buttonCenterX     = pillLeft + borderL(1) + padL(4) + buttonW/2(18)
  //                     = pillLeft + 23 ✓
  //
  // For this to hold, the input must NOT push the pill taller than
  // 46 (no minHeight, no paddingVertical, no maxHeight that
  // exceeds the available 44-px content area). The TextInput
  // scrolls internally for multi-line text; the pill itself
  // never grows — that's the trade-off for keeping the buttons
  // concentric.
  composerPill: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    backgroundColor: "rgba(53,17,1,0.04)",
    borderWidth: 1,
    borderColor: t.color.border,
    borderRadius: t.radius.full,
    paddingHorizontal: 4,
    height: 46,
  } as any,
  // 36×36 circular tap target. With pill height 46, border 1, and
  // pill paddingHorizontal 4: button center = pill outer edge + 23
  // = the semicircle's center of curvature. Concentric in both
  // axes (vertical centering via the pill's alignItems: "center").
  composerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: t.color.border,
    alignItems: "center",
    justifyContent: "center",
  } as any,
  // Send button — same 36×36 footprint as the camera / plus so the
  // RIGHT semicircle math mirrors the left exactly. Smaller visual
  // weight comes from the icon size (16 vs 18) + the pink fill,
  // not from a smaller hit target.
  composerSendBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: t.color["accent.cta"],
    borderWidth: 1,
    borderColor: t.color.border,
    alignItems: "center",
    justifyContent: "center",
  } as any,
  // Pill-internal TextInput — no minHeight / maxHeight / vertical
  // padding of its own (the pill provides the 46-px chrome and
  // alignItems: "center" vertically centers the input within it).
  // Multiline still works but the input scrolls internally instead
  // of growing the pill — that's deliberate so the buttons stay
  // concentric with the semicircles.
  input: {
    flex: 1,
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
    paddingHorizontal: t.spacing.xs,
    paddingVertical: 0,
    textAlignVertical: "center",
  } as any,

  // ── Pinned-message banner ─────────────────────────────────
  pinBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
    backgroundColor: t.color["tag.bg"],
  } as any,
  pinBannerBody: { flex: 1, gap: 1 } as any,
  pinBannerLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.primary"],
    letterSpacing: 0.3,
  } as any,
  pinBannerText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
  } as any,

  // ── Reply indicator (above composer) ──────────────────────
  replyIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: t.color["border.light"],
    backgroundColor: t.color["tag.bg"],
  } as any,
  replyIndicatorBar: {
    width: 3,
    alignSelf: "stretch",
    backgroundColor: t.color["accent.cta"],
    borderRadius: 2,
  } as any,
  replyIndicatorBody: { flex: 1, gap: 1 } as any,
  replyIndicatorLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.primary"],
    letterSpacing: 0.3,
  } as any,
  replyIndicatorText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
  } as any,
  replyIndicatorCancel: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  } as any,

  // ── Reply quote (inside bubble) ───────────────────────────
  replyQuote: {
    flexDirection: "row",
    gap: t.spacing.sm,
    paddingBottom: t.spacing.xs,
    marginBottom: t.spacing.xs,
    opacity: 0.92,
  } as any,
  // OTHER bubble (tag.bg) — text.primary flips Espresso ↔ Crema
  // White; bar uses accent.cta for a small color accent that holds
  // contrast in both modes.
  replyQuoteBar: {
    width: 3,
    alignSelf: "stretch",
    backgroundColor: t.color["accent.cta"],
    borderRadius: 2,
  } as any,
  replyQuoteSender: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.primary"],
    letterSpacing: 0.3,
  } as any,
  replyQuoteBody: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.secondary"],
    lineHeight: 16,
  } as any,
  replyQuoteText: { flex: 1, gap: 1 } as any,
  // SELF bubble (pink, constant) — Espresso text via on-cta;
  // accent bar uses Espresso (the only constant brand color that
  // contrasts pink). The opacity drop on the body keeps the quote
  // muted relative to the new message body below.
  replyQuoteBarOnPink: {
    width: 3,
    alignSelf: "stretch",
    backgroundColor: t.color["text.on-cta"],
    borderRadius: 2,
    opacity: 0.6,
  } as any,
  replyQuoteSenderOnPink: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.on-cta"],
    letterSpacing: 0.3,
  } as any,
  replyQuoteBodyOnPink: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.on-cta"],
    opacity: 0.75,
    lineHeight: 16,
  } as any,

  // ── Long-press menu modal ─────────────────────────────────
  // Backdrop centers the card horizontally but anchors it slightly
  // higher than dead-center so it sits closer to the long-pressed
  // bubble (better reachable on mobile).
  menuBackdrop: {
    flex: 1,
    backgroundColor: t.color.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: t.spacing.xl,
  } as any,
  // Menu card width — narrower than a full-width sheet so it reads
  // as a popover rather than a modal. ~60% of typical mobile width
  // (was 320, now 192) per the user's "shorten by 40%" directive,
  // floored at 180 so the longest label ("Delete for you") still
  // fits comfortably on one line.
  menuCard: {
    backgroundColor: t.color["card.front"],
    borderRadius: t.radius.xl,
    width: 192,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: t.color.border,
  } as any,
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.lg,
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.md,
  } as any,
  menuRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
  } as any,
  menuRowPressed: {
    backgroundColor: t.color.flash,
  } as any,
  menuRowIcon: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  } as any,
  menuRowLabel: {
    flex: 1,
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
  } as any,
  menuRowLabelDestructive: {
    color: t.color["accent.cta"],
  } as any,
}));
