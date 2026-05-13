/**
 * MessagesDropdown — navbar inbox that holds both the thread list and
 * the active conversation inside one small floating card.
 *
 * Two view modes, swap in place:
 *   - list: scrolling inbox of DM threads
 *   - thread: the generic ThreadBody rendered with a back-arrow that
 *     returns to the list
 *
 * Inbox tabs: Inbox / Archive. Archive is session-scoped until the
 * DM-archive backend ships (§2.40.8); the inline Archive swipe action
 * toggles a row between the two tabs.
 */

import { useEffect, useRef, useState } from "react";
import {
  View, Text, Pressable, ScrollView, StyleSheet, Platform, ActivityIndicator, Alert,
} from "react-native";
import { Plus, Archive, BellOff, Trash2 } from "lucide-react-native";
import { t, cardShadow, makeStyles } from "../tokens/useTokens";
import { CroppedAvatar, timeAgo, HapticPressable } from "./primitives";
import { useDirectInbox, InboxRow } from "../hooks/useDirectInbox";
import { useAuth } from "../hooks/useAuth";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { onChromeScroll } from "../utils/chromeScroll";
import { apiFetchRaw } from "../api/client";
import { showToast } from "./shell/Toast";
import ThreadBody, { ThreadKind } from "./ThreadBody";
import NewMessagePicker from "./NewMessagePicker";
import SwipeableRow, { SwipeAction } from "./SwipeableRow";

interface Props {
  visible: boolean;
  onClose: () => void;
  /** When set, the dropdown opens directly into the thread view for
   *  this descriptor (used by NotificationsDropdown → direct_message taps). */
  initialThread?: { kind: ThreadKind; id: number } | null;
  /** Full-viewport mode for the mobile Messages tab screen. */
  fullScreen?: boolean;
}

function rowPresenter(row: InboxRow, currentUserId?: number) {
  return {
    id: row.thread_id,
    avatarUrl: row.other_avatar_url || null,
    cropX: row.other_avatar_crop_x ?? null,
    cropY: row.other_avatar_crop_y ?? null,
    zoom: row.other_avatar_zoom ?? null,
    name: row.other_display_name || row.other_username || "User",
    preview: row.last_message || "Conversation started",
    time: row.last_message_at || row.sort_at,
    unread: row.unread_count,
    sentByMe: row.last_message_user_id === currentUserId,
  };
}

type InboxTab = "inbox" | "archive";

export default function MessagesDropdown({ visible, onClose, initialThread, fullScreen }: Props) {
  const { user } = useAuth();
  const { threads, totalUnread, loading, error, refresh, markRead } = useDirectInbox(visible);
  const { isMobile } = useBreakpoint();
  const [activeThread, setActiveThread] = useState<{ kind: ThreadKind; id: number } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const cardRef = useRef<any>(null);
  const s = useStyles();

  const [tab, setTab] = useState<InboxTab>("inbox");
  // Local archive store. Session-scoped until §2.40.8 lands the
  // DM-archive backend. Key format: `direct_message:${thread_id}`.
  const [localArchivedKeys, setLocalArchivedKeys] = useState<Set<string>>(new Set());
  const rowKey = (r: InboxRow) => `direct_message:${r.thread_id}`;

  // Locally-deleted thread ids. Filtered out client-side at render
  // so the row vanishes optimistically; the next /my-threads poll
  // confirms (the server-side filter on `user_a_deleted_at` /
  // `user_b_deleted_at` keeps it gone unless the other party sends
  // a new message).
  const [deletedKeys, setDeletedKeys] = useState<Set<number>>(new Set());

  /** Build the Archive / Mute / Delete action set for a given inbox
   *  row. Archive toggles a row between Inbox and Archive tabs;
   *  Delete calls DELETE /direct-threads/{id} (per-party "delete
   *  for me" — the other side keeps the thread); Mute is still
   *  "Coming soon" pending the §2.40.8 backend. */
  const buildActions = (row: InboxRow): SwipeAction[] => {
    const commingSoon = (feature: string) =>
      Alert.alert("Coming soon", `${feature} isn't wired up yet for this thread.`);
    const ICON = t.color.bg;
    return [
      {
        key: "archive",
        label: localArchivedKeys.has(rowKey(row)) ? "Unarchive" : "Archive",
        background: t.color["text.primary"],
        icon: <Archive size={18} color={ICON} strokeWidth={2} />,
        onPress: () => {
          const key = rowKey(row);
          setLocalArchivedKeys((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          });
        },
      },
      {
        key: "mute",
        label: "Mute",
        background: t.color["text.muted"],
        icon: <BellOff size={18} color={ICON} strokeWidth={2} />,
        onPress: () => commingSoon("Mute"),
      },
      {
        key: "delete",
        label: "Delete",
        background: t.color["accent.cta"],
        icon: <Trash2 size={18} color={ICON} strokeWidth={2} />,
        onPress: () => {
          // Optimistic remove — keeps the swipe feeling responsive.
          // Server stamps `user_{a|b}_deleted_at`; the next refresh
          // will keep the row hidden via the /my-threads filter.
          const id = row.thread_id;
          setDeletedKeys((prev) => new Set(prev).add(id));
          (async () => {
            try {
              await apiFetchRaw(`/direct-threads/${id}`, { method: "DELETE" });
              showToast("Chat deleted");
              refresh();
            } catch (e) {
              // Roll back on failure so the row reappears and the
              // user can retry.
              setDeletedKeys((prev) => {
                const next = new Set(prev);
                next.delete(id);
                return next;
              });
              showToast("Couldn't delete — try again");
            }
          })();
        },
      },
    ];
  };

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

  // Outside-click dismissal (web only).
  useEffect(() => {
    if (!visible || Platform.OS !== "web" || fullScreen) return;
    let armed = false;
    const armTimer = setTimeout(() => { armed = true; }, 150);
    const handler = (e: MouseEvent) => {
      if (!armed) return;
      const card = cardRef.current as any;
      const target = e.target as Node;
      if (card && typeof card.contains === "function" && card.contains(target)) return;
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
    setActiveThread({ kind: "direct_message", id: row.thread_id });
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

          {/* Inbox / Archive tabs. Local archive store backs the split
             until §2.40.8 lands the DM-archive backend. */}
          <View style={s.tabRow}>
            {(["inbox", "archive"] as InboxTab[]).map((key) => {
              const active = key === tab;
              const label = key === "inbox" ? "Inbox" : "Archive";
              const unread = threads
                .filter((r) => (key === "archive" ? localArchivedKeys.has(rowKey(r)) : !localArchivedKeys.has(rowKey(r))))
                .reduce((n, r) => n + (r.unread_count || 0), 0);
              return (
                <HapticPressable haptic="select" key={key} onPress={() => setTab(key)} style={[s.tab, active && s.tabActive]}>
                  <Text style={[s.tabLabel, active && s.tabLabelActive]}>{label}</Text>
                  {unread > 0 && <Text style={s.tabUnread}>{unread}</Text>}
                </HapticPressable>
              );
            })}
          </View>
          <View style={s.divider} />

          <ScrollView
            style={[s.list, fullScreen && s.listFullScreen]}
            contentContainerStyle={fullScreen ? s.listContentFullScreen : undefined}
            showsVerticalScrollIndicator={false}
            onScroll={fullScreen ? onChromeScroll : undefined}
            scrollEventThrottle={fullScreen ? 16 : undefined}
          >
            {(() => {
              const visibleThreads = threads
                .filter((r) => !deletedKeys.has(r.thread_id))
                .filter((r) =>
                  tab === "archive"
                    ? localArchivedKeys.has(rowKey(r))
                    : !localArchivedKeys.has(rowKey(r)),
                );
              if (loading && threads.length === 0) {
                return <ActivityIndicator size="small" color={t.color.accent} style={{ paddingVertical: 24 }} />;
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
                const emptyText = tab === "archive"
                  ? "No archived conversations yet. Swipe on a chat to archive it."
                  : "No conversations yet. Tap the Message button on anyone's profile to start a chat.";
                return <Text style={s.empty}>{emptyText}</Text>;
              }
              return visibleThreads.map((row, idx) => {
                const pres = rowPresenter(row, user?.id);
                return (
                  <View key={`direct_message:${pres.id}`}>
                    {idx > 0 && <View style={s.itemDivider} />}
                    <SwipeableRow actions={buildActions(row)}>
                    <Pressable
                      testID={`thread-row-${row.other_username || row.other_display_name || row.thread_id}`}
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
                          size={isMobile ? 48 : 36}
                        />
                      ) : (
                        <View style={[s.avatarFb, isMobile && s.avatarFbTall]}>
                          <Text style={[s.avatarLetter, isMobile && s.avatarLetterTall]}>
                            {(pres.name || "?")[0].toUpperCase()}
                          </Text>
                        </View>
                      )}
                      <View style={s.itemContent}>
                        <View style={s.itemTopRow}>
                          <Text style={[s.itemName, isMobile && s.itemNameMobile]} numberOfLines={1}>
                            {pres.name}
                          </Text>
                          <Text style={[s.itemTime, isMobile && s.itemTimeMobile]}>
                            {pres.time ? timeAgo(pres.time) : ""}
                          </Text>
                        </View>
                        <Text
                          style={[
                            s.itemPreview,
                            isMobile && s.itemPreviewMobile,
                            pres.unread > 0 && s.itemPreviewUnread,
                          ]}
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
          {/* Compose new message — same FAB shape as the feed. */}
          <Pressable
            onPress={() => setPickerOpen(true)}
            style={s.newFab}
            accessibilityLabel="New message"
            accessibilityRole="button"
          >
            <Plus size={22} color={t.color["text.on-cta"]} strokeWidth={2.5} />
          </Pressable>
        </>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  card: {
    backgroundColor: t.color["card.front"],
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: t.shadow.card.color,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 12,
  } as any,
  cardList: { width: 340, maxHeight: 440 } as any,
  cardThread: { width: 400, height: 540 } as any,

  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
  } as any,
  headerTitle: { fontFamily: t.font["body.semibold"], fontSize: 15, color: t.color["text.primary"] },
  headerUnread: { fontFamily: t.font["body.medium"], fontSize: 10.5, color: t.color.accent },
  newFab: {
    position: "absolute",
    bottom: 28,
    right: 28,
    width: t.size["fab.size"],
    height: t.size["fab.size"],
    borderRadius: t.size["fab.size"] / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: t.color["accent.cta"],
    shadowColor: t.shadow.card.color,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
    zIndex: 10,
  } as any,
  divider: { height: 1, backgroundColor: t.color["border.light"], marginHorizontal: 12 },

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
  tabActive: { backgroundColor: t.color.flash } as any,
  tabLabel: { fontFamily: t.font["body.medium"], fontSize: 11, color: t.color["text.muted"], letterSpacing: 0.2 },
  tabLabelActive: { color: t.color["text.primary"], fontFamily: t.font["body.semibold"] } as any,
  tabUnread: {
    fontFamily: t.font["body.semibold"], fontSize: 9,
    color: t.color["text.on-cta"],
    backgroundColor: t.color.accent,
    paddingHorizontal: 5, paddingVertical: 1,
    borderRadius: 6,
    overflow: "hidden",
  } as any,
  list: { maxHeight: 380 } as any,
  listFullScreen: { flex: 1, maxHeight: undefined } as any,
  listContentFullScreen: { paddingBottom: t.spacing["4xl"] } as any,

  empty: {
    fontFamily: t.font["body.regular"], fontSize: 11.5,
    color: t.color["text.muted"], textAlign: "center",
    paddingVertical: 22, paddingHorizontal: 18, lineHeight: 16,
  } as any,
  errorText: {
    fontFamily: t.font["body.regular"], fontSize: 11.5,
    color: t.color["accent.cta"], textAlign: "center", paddingHorizontal: 18,
  } as any,
  retryText: {
    fontFamily: t.font["body.semibold"], fontSize: 11,
    color: t.color["text.primary"], paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: t.color["card.info"], borderRadius: 8,
  } as any,

  item: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 14, paddingVertical: 9,
  } as any,
  // Mobile inbox row — sized to match the feed's mobile rhythm so a
  // DM list reads as part of the same density (PostCard mobile uses
  // 15-pt names, 14-pt subtitles, 45-px feed avatars). Avatar 48 +
  // generous gap mirrors the feed; vertical padding 14 + the
  // 4-px-spaced name/preview rows give the same breathing room as
  // the feed post cards.
  itemTall: { paddingHorizontal: t.spacing.lg, paddingVertical: 14, gap: t.spacing.md } as any,
  avatarFbTall: { width: 48, height: 48, borderRadius: 24 } as any,
  avatarLetterTall: { fontSize: 18 } as any,
  itemUnread: { backgroundColor: "rgba(215,152,218,0.06)" },
  itemHover: { backgroundColor: t.color.flash },
  itemDivider: { height: 1, backgroundColor: t.color["border.light"], marginHorizontal: 14, opacity: 0.5 },
  itemContent: { flex: 1, gap: 2 } as any,
  itemTopRow: {
    flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8,
  } as any,
  itemName: { fontFamily: t.font["body.semibold"], fontSize: 12, color: t.color["text.primary"], flex: 1 },
  itemNameMobile: { fontSize: 15 } as any,
  itemTime: { fontFamily: t.font["body.regular"], fontSize: 9.5, color: t.color["text.muted"] },
  itemTimeMobile: { fontSize: 13, fontFamily: t.font["body.medium"] } as any,
  itemPreview: {
    fontFamily: t.font["body.regular"], fontSize: 11,
    color: t.color["text.secondary"], lineHeight: 15,
  } as any,
  itemPreviewMobile: { fontSize: 14, lineHeight: 19 } as any,
  itemPreviewUnread: { color: t.color["text.primary"], fontFamily: t.font["body.medium"] } as any,
  unreadDot: {
    minWidth: 16, height: 16, borderRadius: 8,
    backgroundColor: t.color.accent,
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 4,
    alignSelf: "center",
  } as any,
  unreadDotText: {
    fontFamily: t.font["body.semibold"], fontSize: 9,
    color: t.color["text.on-cta"], letterSpacing: 0.2,
  } as any,
  // Identity surface — see NotificationsDropdown avatarFallback.
  avatarFb: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: t.color["text.primary"],
    alignItems: "center", justifyContent: "center",
  } as any,
  avatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 12, color: t.color["text.on-dark"] },
}));
