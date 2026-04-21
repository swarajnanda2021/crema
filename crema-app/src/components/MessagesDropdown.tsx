/**
 * MessagesDropdown — navbar inbox that holds both the thread list and
 * the active conversation inside one small floating card.
 *
 * Two view modes, swap in place:
 *   - list: scrolling inbox of threads (wholesale + DM, merged)
 *   - thread: the generic ThreadBody rendered with a back-arrow that
 *     returns to the list
 *
 * Non-blocking by design:
 *   - No full-viewport backdrop, so the site stays scrollable and
 *     clickable underneath. (The old backdrop was the reason every
 *     navbar popover froze site interaction.)
 *   - Outside-click dismissal via a document listener on web — clicks
 *     anywhere outside the card close the dropdown. Disarmed for
 *     150ms after open so the opening click doesn't instantly close
 *     the panel.
 *   - On native there's no document listener, so it's expected that
 *     users close via the X or via the Messages icon toggling.
 *
 * Surfaces fetch errors (/my-threads) so "no conversations yet"
 * isn't ambiguous with a silent auth/transport failure.
 */

import { useEffect, useRef, useState } from "react";
import {
  View, Text, Pressable, ScrollView, StyleSheet, Platform, ActivityIndicator, Alert,
} from "react-native";
import { Plus, Archive, BellOff, Trash2 } from "lucide-react-native";
import { t, cardShadow } from "../tokens/useTokens";
import { apiFetchRaw } from "../api/client";
import { CroppedAvatar, timeAgo } from "./primitives";
import { useInquiryInbox, InboxRow } from "../hooks/useInquiryInbox";
import { useAuth } from "../hooks/useAuth";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { onChromeScroll } from "../utils/chromeScroll";
import ThreadBody, { ThreadKind } from "./ThreadBody";
import NewMessagePicker from "./NewMessagePicker";
import SwipeableRow, { SwipeAction } from "./SwipeableRow";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** When set, the dropdown opens directly into the thread view for
   *  this descriptor (used by NotificationsDropdown → wholesale_inquiry
   *  / inquiry_reply / direct_message taps). */
  initialThread?: { kind: ThreadKind; id: number } | null;
  /** Full-viewport mode for the mobile Messages tab screen. */
  fullScreen?: boolean;
}

// Normalise an InboxRow into the uniform shape the list row expects.
function rowPresenter(row: InboxRow, currentUserId?: number) {
  if (row.kind === "wholesale_inquiry") {
    // Counterparty depends on perspective: roasters see the café,
    // cafés see the roaster. Last-message ownership is independent.
    return {
      id: row.inquiry_id!,
      avatarUrl: row.cafe_logo_url || row.roaster_logo_url || null,
      cropX: row.cafe_logo_crop_x ?? null,
      cropY: row.cafe_logo_crop_y ?? null,
      zoom: row.cafe_logo_zoom ?? null,
      name: row.cafe_name || row.roaster_name || "Thread",
      subline: row.product_name || null,
      preview: row.last_message || row.inquiry_note || "Conversation started",
      time: row.last_message_at || row.opened_at || row.sort_at,
      unread: row.unread_count,
      sentByMe: row.last_message_user_id === currentUserId,
    };
  }
  return {
    id: row.thread_id!,
    avatarUrl: row.other_avatar_url || null,
    cropX: row.other_avatar_crop_x ?? null,
    cropY: row.other_avatar_crop_y ?? null,
    zoom: row.other_avatar_zoom ?? null,
    name: row.other_display_name || row.other_username || "User",
    subline: null as string | null,
    preview: row.last_message || "Conversation started",
    time: row.last_message_at || row.sort_at,
    unread: row.unread_count,
    sentByMe: row.last_message_user_id === currentUserId,
  };
}

// For wholesale perspective where the viewer is a roaster, the
// counterparty is the café (already covered above because we prefer
// cafe_name / cafe_logo first). For wholesale perspective where the
// viewer is a café, the counterparty is the roaster — rowPresenter
// falls back to roaster_name / roaster_logo. This works because the
// backend's /my-threads scopes what the viewer sees.

// §2.15 — business users see the inbox split into tabs. The tab
// discriminator is the `kind` field for active threads and `status`
// for archive. Regular users see a single flat list (no tabs).
type InboxTab = "business" | "non_business" | "archive";

function threadTab(row: InboxRow): InboxTab {
  if (row.kind === "wholesale_inquiry" && row.status === "archived") return "archive";
  if (row.kind === "wholesale_inquiry") return "business";
  return "non_business";
}

export default function MessagesDropdown({ visible, onClose, initialThread, fullScreen }: Props) {
  const { user } = useAuth();
  const { threads, totalUnread, loading, error, refresh, markRead } = useInquiryInbox(visible);
  const { isMobile } = useBreakpoint();
  const [activeThread, setActiveThread] = useState<{ kind: ThreadKind; id: number } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const cardRef = useRef<any>(null);

  /** Build the Archive / Mute / Delete action set for a given inbox
   *  row. Archive for wholesale_inquiry hits the existing
   *  respond-with-status endpoint (roasters only); everything else
   *  surfaces a "Coming soon" alert until the DM-side backend lands. */
  const buildActions = (row: InboxRow): SwipeAction[] => {
    const commingSoon = (feature: string) =>
      Alert.alert("Coming soon", `${feature} isn't wired up yet for this thread.`);
    const ICON = t.color.bg;
    return [
      {
        key: "archive",
        label: "Archive",
        background: t.color["text.primary"],
        icon: <Archive size={18} color={ICON} strokeWidth={2} />,
        onPress: async () => {
          if (row.kind === "wholesale_inquiry" && user?.account_type === "roaster") {
            try {
              await apiFetchRaw(`/wholesale-inquiries/${row.inquiry_id}/respond`, {
                method: "POST",
                body: JSON.stringify({ status: "archived" }),
              });
              refresh();
            } catch (e) {
              Alert.alert("Archive failed", String(e));
            }
          } else {
            commingSoon("Archive");
          }
        },
      },
      {
        key: "mute",
        label: "Mute",
        background: "#A09580",
        icon: <BellOff size={18} color={ICON} strokeWidth={2} />,
        onPress: () => commingSoon("Mute"),
      },
      {
        key: "delete",
        label: "Delete",
        background: "#B5393C",
        icon: <Trash2 size={18} color={ICON} strokeWidth={2} />,
        onPress: () => commingSoon("Delete"),
      },
    ];
  };

  // Tab routing (business users only). Default to Business on open —
  // that's the wholesale-lead feed they'll check most often.
  const isBusiness = user?.account_type === "cafe" || user?.account_type === "roaster";
  const [tab, setTab] = useState<InboxTab>("business");

  // Sync initialThread when the caller pushes one (e.g. notification
  // tap). Clearing on close is handled below.
  useEffect(() => {
    if (visible && initialThread) setActiveThread(initialThread);
  }, [visible, initialThread]);

  useEffect(() => {
    if (visible) {
      refresh();
      const h = setTimeout(() => setReady(true), 50);
      return () => { clearTimeout(h); setReady(false); };
    } else {
      setReady(false);
      // Reset thread state after the dropdown visually fades out.
      const h = setTimeout(() => setActiveThread(null), 180);
      return () => clearTimeout(h);
    }
  }, [visible, refresh]);

  // Outside-click dismissal (web only). Armed after 150ms so the
  // opening click doesn't immediately close. Ignores clicks inside
  // the card or on the navbar (to keep icon-toggle working).
  useEffect(() => {
    if (!visible || Platform.OS !== "web" || fullScreen) return;
    let armed = false;
    const armTimer = setTimeout(() => { armed = true; }, 150);
    const handler = (e: MouseEvent) => {
      if (!armed) return;
      const card = cardRef.current as any;
      const target = e.target as Node;
      if (card && typeof card.contains === "function" && card.contains(target)) return;
      // Also skip clicks on anything inside the navbar — those
      // buttons have their own close/toggle logic.
      const navbar = (typeof document !== "undefined")
        ? document.querySelector('[data-role="navbar"]') : null;
      if (navbar && (navbar as any).contains && (navbar as any).contains(target)) return;
      onClose();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("click", handler);
    }
    return () => {
      clearTimeout(armTimer);
      if (typeof document !== "undefined") {
        document.removeEventListener("click", handler);
      }
    };
  }, [visible, onClose]);

  if (!visible || !user) return null;

  const handleRow = (row: InboxRow) => {
    if (row.unread_count > 0) markRead(row);
    const id = row.kind === "wholesale_inquiry" ? row.inquiry_id! : row.thread_id!;
    setActiveThread({ kind: row.kind, id });
  };

  const backToList = () => {
    setActiveThread(null);
    refresh();
  };

  const cardPositionStyle = fullScreen
    ? { flex: 1, width: "100%" as any }
    : Platform.OS === "web"
      ? { position: "fixed" as any, top: 72, right: 90, zIndex: 9999 }
      : { position: "absolute" as any, top: 8, right: 40, zIndex: 9999 };

  const sizeStyle = fullScreen ? null : activeThread ? s.cardThread : s.cardList;
  const cardOverrides = fullScreen
    ? { width: "100%" as any, height: "100%" as any, maxHeight: undefined, borderRadius: 0, shadowOpacity: 0, elevation: 0, backgroundColor: t.color.bg }
    : null;

  return (
    <View
      ref={cardRef}
      style={[s.card, cardPositionStyle, sizeStyle, cardOverrides, !ready && !fullScreen && { opacity: 0 }]}
      pointerEvents="box-none"
    >
      {activeThread ? (
        <ThreadBody
          kind={activeThread.kind}
          id={activeThread.id}
          onBack={backToList}
          onClose={onClose}
        />
      ) : pickerOpen ? (
        <NewMessagePicker
          onClose={() => setPickerOpen(false)}
          onPick={(threadId) => {
            setPickerOpen(false);
            setActiveThread({ kind: "direct_message", id: threadId });
          }}
        />
      ) : (
        <>
          <View style={s.header}>
            <Text style={s.headerTitle}>Messages</Text>
            {totalUnread > 0 && <Text style={s.headerUnread}>{totalUnread} unread</Text>}
          </View>
          <View style={s.divider} />

          {/* Tabs (business only). Regular users skip this strip. Each
             tab carries its own unread count — mirrors §2.4
             Activity/Business notification tabs. */}
          {isBusiness && (
            <>
              <View style={s.tabRow}>
                {(["business", "non_business", "archive"] as InboxTab[]).map((key) => {
                  const active = key === tab;
                  const label = key === "business" ? "Business"
                    : key === "non_business" ? "Non-business"
                    : "Archive";
                  const unread = threads
                    .filter((r) => threadTab(r) === key)
                    .reduce((n, r) => n + (r.unread_count || 0), 0);
                  return (
                    <Pressable key={key} onPress={() => setTab(key)} style={[s.tab, active && s.tabActive]}>
                      <Text style={[s.tabLabel, active && s.tabLabelActive]}>{label}</Text>
                      {unread > 0 && <Text style={s.tabUnread}>{unread}</Text>}
                    </Pressable>
                  );
                })}
              </View>
              <View style={s.divider} />
            </>
          )}

          <ScrollView
            style={s.list}
            showsVerticalScrollIndicator={false}
            onScroll={fullScreen ? onChromeScroll : undefined}
            scrollEventThrottle={fullScreen ? 16 : undefined}
          >
            {(() => {
              // Filter once per render; cheap enough for small inboxes.
              const visibleThreads = isBusiness ? threads.filter((r) => threadTab(r) === tab) : threads;
              if (loading && threads.length === 0) {
                return <ActivityIndicator size="small" color="#D798DA" style={{ paddingVertical: 24 }} />;
              }
              if (error) {
                return (
                  <View style={{ paddingVertical: 18, alignItems: "center", gap: 8 }}>
                    <Text style={s.errorText}>{error}</Text>
                    <Pressable onPress={refresh} hitSlop={6}>
                      <Text style={s.retryText}>Retry</Text>
                    </Pressable>
                  </View>
                );
              }
              if (visibleThreads.length === 0) {
                const emptyText = !isBusiness
                  ? "No conversations yet. Tap the Message button on anyone's profile to start a chat."
                  : tab === "business"
                    ? "No wholesale inquiries in this tab yet."
                    : tab === "non_business"
                      ? "No direct messages yet."
                      : "No archived threads.";
                return <Text style={s.empty}>{emptyText}</Text>;
              }
              return visibleThreads.map((row, idx) => {
                const pres = rowPresenter(row, user?.id);
                return (
                  <View key={`${row.kind}:${pres.id}`}>
                    {idx > 0 && <View style={s.itemDivider} />}
                    <SwipeableRow actions={buildActions(row)}>
                    <Pressable
                      onPress={() => handleRow(row)}
                      style={({ pressed }: any) => [
                        s.item,
                        isMobile && s.itemTall,
                        pres.unread > 0 && s.itemUnread,
                        pressed && s.itemHover,
                      ]}
                    >
                      {pres.avatarUrl ? (
                        <CroppedAvatar
                          url={pres.avatarUrl}
                          cropX={pres.cropX ?? undefined}
                          cropY={pres.cropY ?? undefined}
                          zoom={pres.zoom ?? undefined}
                          size={isMobile ? 44 : 32}
                        />
                      ) : (
                        <View style={[s.avatarFb, isMobile && s.avatarFbTall]}>
                          <Text style={s.avatarLetter}>{(pres.name || "?")[0].toUpperCase()}</Text>
                        </View>
                      )}
                      <View style={s.itemContent}>
                        <View style={s.itemTopRow}>
                          <Text style={s.itemName} numberOfLines={1}>{pres.name}</Text>
                          <Text style={s.itemTime}>{pres.time ? timeAgo(pres.time) : ""}</Text>
                        </View>
                        {pres.subline && (
                          <Text style={s.itemSubline} numberOfLines={1}>{pres.subline}</Text>
                        )}
                        <Text
                          style={[s.itemPreview, pres.unread > 0 && s.itemPreviewUnread]}
                          numberOfLines={1}
                        >
                          {pres.sentByMe ? "You: " : ""}{pres.preview}
                        </Text>
                      </View>
                      {pres.unread > 0 && (
                        <View style={s.unreadDot}>
                          <Text style={s.unreadDotText}>{pres.unread}</Text>
                        </View>
                      )}
                    </Pressable>
                    </SwipeableRow>
                  </View>
                );
              });
            })()}
          </ScrollView>
          {/* Compose new message — same visual language as the
             feed's FAB (same size, same offset from bottom-right,
             same dark fill, same drop shadow). Users already know
             this "+" shape from the feed; reusing it here means
             zero relearning. */}
          <Pressable
            onPress={() => setPickerOpen(true)}
            style={s.newFab}
            accessibilityLabel="New message"
            accessibilityRole="button"
          >
            <Plus size={22} color={t.color["text.on-dark"]} strokeWidth={2.5} />
          </Pressable>
        </>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    overflow: "hidden",
    ...cardShadow,
    shadowOpacity: 0.15,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  } as any,
  // List mode is compact. Thread mode is a touch bigger but still far
  // from viewport-swallowing — keeps the chat usable without feeling
  // like a page takeover.
  cardList: { width: 340, maxHeight: 440 } as any,
  cardThread: { width: 400, height: 540 } as any,

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
  } as any,
  headerTitle: { fontFamily: t.font["body.semibold"], fontSize: 15, color: "#351101" },
  headerUnread: { fontFamily: t.font["body.medium"], fontSize: 10.5, color: "#D798DA" },
  // Compose-new-message FAB — cloned verbatim from the feed's FAB
  // (see (tabs)/index.tsx s.fab) so users learn one "+" shape for
  // "start a new thing" across the app.
  newFab: {
    position: "absolute",
    bottom: 28,
    right: 28,
    width: t.size["fab.size"],
    height: t.size["fab.size"],
    borderRadius: t.size["fab.size"] / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.color["text.primary"],
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 10,
  } as any,
  divider: { height: 1, backgroundColor: "#EDE8E1", marginHorizontal: 12 },

  // Tab strip (business users, §2.15). Small enough to fit three
  // labels inside the 340px card without wrapping.
  tabRow: {
    flexDirection: "row",
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 4,
    gap: 4,
  } as any,
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 6,
    borderRadius: 8,
  } as any,
  tabActive: { backgroundColor: "rgba(215,152,218,0.12)" } as any,
  tabLabel: { fontFamily: t.font["body.medium"], fontSize: 11, color: "#A09580", letterSpacing: 0.2 },
  tabLabelActive: { color: "#351101", fontFamily: t.font["body.semibold"] } as any,
  tabUnread: {
    fontFamily: t.font["body.semibold"], fontSize: 9,
    color: "#FFFFFF",
    backgroundColor: "#D798DA",
    paddingHorizontal: 5, paddingVertical: 1,
    borderRadius: 6,
    overflow: "hidden",
  } as any,
  list: { maxHeight: 380 } as any,

  empty: {
    fontFamily: t.font["body.regular"], fontSize: 11.5,
    color: "#A09580", textAlign: "center",
    paddingVertical: 22, paddingHorizontal: 18, lineHeight: 16,
  } as any,
  errorText: {
    fontFamily: t.font["body.regular"], fontSize: 11.5,
    color: "#B5393C", textAlign: "center", paddingHorizontal: 18,
  } as any,
  retryText: {
    fontFamily: t.font["body.semibold"], fontSize: 11,
    color: "#351101", paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: "#EFE9DB", borderRadius: 8,
  } as any,

  item: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 14, paddingVertical: 9,
  } as any,
  // Mobile: ~1.5× the resting height — bigger paddingVertical +
  // bigger avatar so the row reads as a clearly thumb-sized target.
  // Row height ≈ 44 (avatar) + 2 × 16 (padding) ≈ 76 px, up from
  // the ≈50 px desktop row.
  itemTall: { paddingVertical: 16, gap: 12 } as any,
  avatarFbTall: { width: 44, height: 44, borderRadius: 22 } as any,
  itemUnread: { backgroundColor: "rgba(215,152,218,0.06)" },
  itemHover: { backgroundColor: "rgba(215,152,218,0.12)" },
  itemDivider: { height: 1, backgroundColor: "rgba(237,232,225,0.5)", marginHorizontal: 14 },
  itemContent: { flex: 1, gap: 1 } as any,
  itemTopRow: {
    flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8,
  } as any,
  itemName: { fontFamily: t.font["body.semibold"], fontSize: 12, color: "#351101", flex: 1 },
  itemTime: { fontFamily: t.font["body.regular"], fontSize: 9.5, color: "#A09580" },
  itemSubline: {
    fontFamily: t.font["body.medium"], fontSize: 9.5,
    color: "#684F44", letterSpacing: 0.2,
  } as any,
  itemPreview: {
    fontFamily: t.font["body.regular"], fontSize: 11,
    color: "#684F44", lineHeight: 15,
  } as any,
  itemPreviewUnread: { color: "#351101", fontFamily: t.font["body.medium"] } as any,
  unreadDot: {
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: "#D798DA",
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 4,
    alignSelf: "center",
  } as any,
  unreadDotText: {
    fontFamily: t.font["body.semibold"], fontSize: 9,
    color: "#FFFFFF", letterSpacing: 0.2,
  } as any,
  avatarFb: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: "#351101",
    alignItems: "center", justifyContent: "center",
  } as any,
  avatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 12, color: "#FAF8F0" },
});
