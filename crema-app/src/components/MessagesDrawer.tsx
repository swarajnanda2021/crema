/**
 * MessagesDrawer — right-docked chat surface.
 *
 * One component, two view modes (master-detail):
 *   - list  → scrolling inbox of inquiry threads
 *   - thread → full conversation for a specific inquiry
 *
 * Desktop (viewport ≥ 900px): fixed panel anchored to the right edge,
 * 420px wide, no backdrop. The rest of the site stays scrollable and
 * interactive — a café can keep browsing a roaster's products while
 * chatting. Slides in/out with a 220ms eased transform.
 *
 * Mobile / narrow viewport (< 900px): falls back to a full-screen
 * Modal so it isn't trapped squeezing the narrow site content. Same
 * master-detail switching, full-bleed surface.
 *
 * The site's floating elements (post FAB, etc.) can end up visually
 * overlapped on the right edge when the drawer is open on desktop.
 * That's acceptable — the user is focused on the conversation, and
 * the drawer is dismissable from the Messages icon that opened it.
 */

import { useEffect, useRef, useState } from "react";
import {
  View, Text, Pressable, ScrollView, StyleSheet, Platform,
  ActivityIndicator, Animated, Easing, Modal, useWindowDimensions,
} from "react-native";
import { X } from "lucide-react-native";
import { t, cardShadow, NAVBAR_HEIGHT } from "../tokens/useTokens";
import { CroppedAvatar, timeAgo } from "./primitives";
import { useAuth } from "../hooks/useAuth";
import { useInquiryInbox, InquiryThreadRow } from "../hooks/useInquiryInbox";
import InquiryThreadBody from "./InquiryThreadBody";

interface Props {
  /** Drawer visibility (owned by the caller — typically Navbar). */
  open: boolean;
  /** When set, the drawer opens directly into this thread. Null opens
   *  into the list view. Changes propagate live (e.g. user taps a
   *  notification while the drawer is already open on the list). */
  initialInquiryId?: number | null;
  onClose: () => void;
}

const DRAWER_WIDTH = 420;
const MOBILE_BREAKPOINT = 900;

function counterpartyOf(row: InquiryThreadRow, perspective: "cafe" | "roaster" | "none") {
  if (perspective === "cafe") {
    return {
      name: row.roaster_name || row.roaster_slug?.replace(/-/g, " ") || "Roaster",
      logo: row.roaster_logo_url,
      cropX: null as number | null, cropY: null as number | null, zoom: null as number | null,
    };
  }
  return {
    name: row.cafe_name || row.cafe_slug?.replace(/-/g, " ") || "Café",
    logo: row.cafe_logo_url,
    cropX: row.cafe_logo_crop_x, cropY: row.cafe_logo_crop_y, zoom: row.cafe_logo_zoom,
  };
}

export default function MessagesDrawer({ open, initialInquiryId, onClose }: Props) {
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const isMobile = width < MOBILE_BREAKPOINT;

  const [activeInquiryId, setActiveInquiryId] = useState<number | null>(initialInquiryId ?? null);
  const { threads, totalUnread, perspective, loading, refresh, markRead } = useInquiryInbox(open);

  // Slide animation for the desktop drawer. Modal on mobile has its
  // own built-in slide via animationType="slide".
  const translateX = useRef(new Animated.Value(DRAWER_WIDTH)).current;
  useEffect(() => {
    if (isMobile) return;
    Animated.timing(translateX, {
      toValue: open ? 0 : DRAWER_WIDTH,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [open, isMobile, translateX]);

  // External trigger: an in-place thread change (e.g. notification
  // tapped while drawer already shows a different thread) snaps to
  // the new one. Opening fresh always honours initialInquiryId.
  useEffect(() => {
    if (!open) return;
    if (initialInquiryId != null) setActiveInquiryId(initialInquiryId);
  }, [open, initialInquiryId]);

  // Refresh the list on open so unread counts are fresh.
  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  // Visibility gate — regular user accounts don't have conversations
  // (for now). Render nothing rather than an empty drawer.
  const eligible = user?.account_type === "cafe" || user?.account_type === "roaster";
  if (!eligible) return null;

  const goToThread = (row: InquiryThreadRow) => {
    if (row.unread_count > 0) markRead(row.inquiry_id);
    setActiveInquiryId(row.inquiry_id);
  };

  const goBackToList = () => {
    setActiveInquiryId(null);
    refresh();
  };

  const handleClose = () => {
    onClose();
    // Defer resetting active thread until after the slide-out, so the
    // user doesn't see a list-flash on the way out.
    setTimeout(() => setActiveInquiryId(null), 260);
  };

  const body = activeInquiryId === null ? (
    <ListView
      threads={threads}
      totalUnread={totalUnread}
      perspective={perspective}
      loading={loading}
      onSelect={goToThread}
      onClose={handleClose}
      userId={user?.id}
    />
  ) : (
    <InquiryThreadBody
      inquiryId={activeInquiryId}
      onBack={goBackToList}
      onClose={handleClose}
    />
  );

  if (isMobile) {
    return (
      <Modal visible={open} transparent animationType="slide" onRequestClose={handleClose}>
        <View style={s.mobileWrap}>{body}</View>
      </Modal>
    );
  }

  // Desktop: fixed right-docked panel. No backdrop — site stays
  // scrollable and clickable to its left. The drawer sits below the
  // navbar (top offset = NAVBAR_HEIGHT) so the navbar stays usable.
  return (
    <Animated.View
      pointerEvents={open ? "auto" : "none"}
      style={[
        s.desktopDrawer,
        { transform: [{ translateX }] },
      ]}
    >
      {body}
    </Animated.View>
  );
}


// ── List view ──────────────────────────────────────────────────────────────

interface ListProps {
  threads: InquiryThreadRow[];
  totalUnread: number;
  perspective: "cafe" | "roaster" | "none";
  loading: boolean;
  onSelect: (row: InquiryThreadRow) => void;
  onClose: () => void;
  userId?: number;
}

function ListView({
  threads, totalUnread, perspective, loading, onSelect, onClose, userId,
}: ListProps) {
  return (
    <View style={{ flex: 1, backgroundColor: "#FFFFFF" }}>
      <View style={s.listHeader}>
        <View style={{ flex: 1 }}>
          <Text style={s.headerTitle}>Messages</Text>
          {totalUnread > 0 && (
            <Text style={s.headerSubtitle}>{totalUnread} unread</Text>
          )}
        </View>
        <Pressable onPress={onClose} hitSlop={8} style={s.iconBtn}>
          <X size={18} color={t.color["text.primary"]} />
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {loading && threads.length === 0 ? (
          <ActivityIndicator size="small" color="#D798DA" style={{ paddingVertical: 32 }} />
        ) : threads.length === 0 ? (
          <Text style={s.empty}>
            No conversations yet. Tap the wholesale chip on any coffee card to start one.
          </Text>
        ) : (
          threads.map((row, idx) => {
            const cp = counterpartyOf(row, perspective);
            const preview = row.last_message || row.inquiry_note || "Conversation started";
            const sentByMe = row.last_message_user_id === userId;
            const time = row.last_message_at || row.opened_at;
            return (
              <View key={row.inquiry_id}>
                {idx > 0 && <View style={s.itemDivider} />}
                <Pressable
                  onPress={() => onSelect(row)}
                  style={({ pressed }: any) => [
                    s.item,
                    row.unread_count > 0 && s.itemUnread,
                    pressed && s.itemHover,
                  ]}
                >
                  {cp.logo ? (
                    <CroppedAvatar
                      url={cp.logo}
                      cropX={cp.cropX ?? undefined}
                      cropY={cp.cropY ?? undefined}
                      zoom={cp.zoom ?? undefined}
                      size={38}
                    />
                  ) : (
                    <View style={s.avatarFb}>
                      <Text style={s.avatarLetter}>{(cp.name || "?")[0].toUpperCase()}</Text>
                    </View>
                  )}
                  <View style={s.itemContent}>
                    <View style={s.itemTopRow}>
                      <Text style={s.itemName} numberOfLines={1}>{cp.name}</Text>
                      <Text style={s.itemTime}>{timeAgo(time)}</Text>
                    </View>
                    {row.product_name && (
                      <Text style={s.itemProduct} numberOfLines={1}>{row.product_name}</Text>
                    )}
                    <Text
                      style={[s.itemPreview, row.unread_count > 0 && s.itemPreviewUnread]}
                      numberOfLines={2}
                    >
                      {sentByMe ? "You: " : ""}{preview}
                    </Text>
                  </View>
                  {row.unread_count > 0 && (
                    <View style={s.unreadDot}>
                      <Text style={s.unreadDotText}>{row.unread_count}</Text>
                    </View>
                  )}
                </Pressable>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}


const s = StyleSheet.create({
  // Desktop: fixed right-docked panel. On web, position: fixed is
  // essential so scrolling the page doesn't scroll the drawer.
  desktopDrawer: Platform.OS === "web" ? ({
    position: "fixed",
    top: NAVBAR_HEIGHT,
    right: 0, bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: "#FFFFFF",
    borderLeftWidth: 1,
    borderLeftColor: "#EDE8E1",
    zIndex: 9500, // under toasts/critical modals, over site content
    overflow: "hidden",
    ...cardShadow,
    shadowOpacity: 0.12,
    shadowRadius: 28,
    shadowOffset: { width: -8, height: 0 },
  } as any) : ({
    position: "absolute",
    top: NAVBAR_HEIGHT,
    right: 0, bottom: 0,
    width: DRAWER_WIDTH,
    backgroundColor: "#FFFFFF",
    borderLeftWidth: 1,
    borderLeftColor: "#EDE8E1",
    zIndex: 9500,
    overflow: "hidden",
    ...cardShadow,
    shadowOpacity: 0.12,
    shadowRadius: 28,
    shadowOffset: { width: -8, height: 0 },
  } as any),

  // Mobile: full-screen wrapper inside the Modal.
  mobileWrap: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  } as any,

  // List header + rows
  listHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: "#EDE8E1",
  } as any,
  headerTitle: {
    fontFamily: t.font["body.semibold"], fontSize: 17, color: t.color["text.primary"],
  },
  headerSubtitle: {
    fontFamily: t.font["body.medium"], fontSize: 11, color: "#D798DA", marginTop: 2,
  } as any,
  iconBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: "rgba(53,17,1,0.06)",
    alignItems: "center", justifyContent: "center",
  } as any,

  empty: {
    fontFamily: t.font["body.regular"],
    fontSize: 13,
    color: "#A09580",
    textAlign: "center",
    paddingVertical: 40,
    paddingHorizontal: 28,
    lineHeight: 19,
  } as any,
  item: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  } as any,
  itemUnread: { backgroundColor: "rgba(215,152,218,0.06)" },
  itemHover: { backgroundColor: "rgba(215,152,218,0.12)" },
  itemDivider: { height: 1, backgroundColor: "rgba(237,232,225,0.5)", marginHorizontal: 16 },
  itemContent: { flex: 1, gap: 2 } as any,
  itemTopRow: {
    flexDirection: "row", alignItems: "baseline",
    justifyContent: "space-between", gap: 8,
  } as any,
  itemName: { fontFamily: t.font["body.semibold"], fontSize: 13, color: "#351101", flex: 1 },
  itemTime: { fontFamily: t.font["body.regular"], fontSize: 10, color: "#A09580" },
  itemProduct: {
    fontFamily: t.font["body.medium"], fontSize: 10,
    color: "#684F44", letterSpacing: 0.2,
  } as any,
  itemPreview: {
    fontFamily: t.font["body.regular"], fontSize: 12,
    color: "#684F44", lineHeight: 17,
  } as any,
  itemPreviewUnread: { color: "#351101", fontFamily: t.font["body.medium"] } as any,
  unreadDot: {
    minWidth: 20, height: 20, borderRadius: 10,
    backgroundColor: "#D798DA",
    alignItems: "center", justifyContent: "center",
    paddingHorizontal: 6,
    alignSelf: "center",
  } as any,
  unreadDotText: {
    fontFamily: t.font["body.semibold"], fontSize: 10,
    color: "#FFFFFF", letterSpacing: 0.2,
  } as any,
  avatarFb: {
    width: 38, height: 38, borderRadius: 19,
    backgroundColor: "#351101",
    alignItems: "center", justifyContent: "center",
  } as any,
  avatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 14, color: "#FAF8F0" },
});
