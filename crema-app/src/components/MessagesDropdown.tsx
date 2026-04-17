/**
 * MessagesDropdown — navbar inbox panel.
 *
 * Currently powered by wholesale inquiry threads but the row shape is
 * chat-generic (avatar, counterparty name, last-message preview,
 * timestamp, unread dot) so user↔user DMs can slot in later without
 * restyling. Tapping a row opens the InquiryThreadModal for that
 * thread.
 *
 * Positioning mirrors NotificationsDropdown so both panels feel like
 * siblings in the navbar.
 */

import { useEffect, useState } from "react";
import { View, Text, Pressable, ScrollView, StyleSheet, Platform, ActivityIndicator } from "react-native";
import { t, cardShadow } from "../tokens/useTokens";
import { CroppedAvatar, timeAgo } from "./primitives";
import { useInquiryInbox, InquiryThreadRow } from "../hooks/useInquiryInbox";
import { useAuth } from "../hooks/useAuth";
import InquiryThreadModal from "./InquiryThreadModal";

interface Props {
  visible: boolean;
  onClose: () => void;
}

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

export default function MessagesDropdown({ visible, onClose }: Props) {
  const { user } = useAuth();
  const { threads, totalUnread, perspective, loading, refresh, markRead } = useInquiryInbox(true);
  const [ready, setReady] = useState(false);
  const [openInquiryId, setOpenInquiryId] = useState<number | null>(null);

  // Pop the ready flag a tick late so the backdrop fades in smoothly
  // instead of snapping in at mount (matches NotificationsDropdown).
  useEffect(() => {
    if (visible) {
      refresh();
      const h = setTimeout(() => setReady(true), 50);
      return () => { clearTimeout(h); setReady(false); };
    } else {
      setReady(false);
    }
  }, [visible, refresh]);

  const openThread = (row: InquiryThreadRow) => {
    if (row.unread_count > 0) markRead(row.inquiry_id);
    onClose();
    setOpenInquiryId(row.inquiry_id);
  };

  const cardFixedStyle = Platform.OS === "web"
    ? { position: "fixed" as any, top: 72, right: 90, zIndex: 9999 }
    : { position: "absolute" as any, top: 8, right: 40, zIndex: 9999 };

  // Visibility gate — only café + roaster accounts see Messages for
  // now. Regular users would get an empty list anyway since inquiries
  // are a B2B primitive.
  const eligible = user?.account_type === "cafe" || user?.account_type === "roaster";

  return (
    <>
      {/* Thread modal lives outside the dropdown's visibility gate so
         the conversation survives the dropdown closing. */}
      <InquiryThreadModal
        inquiryId={openInquiryId}
        onClose={() => { setOpenInquiryId(null); refresh(); }}
      />

      {visible && eligible && (
        <>
          {ready && (
            <Pressable
              onPress={onClose}
              style={[
                s.backdrop,
                Platform.OS === "web"
                  ? { position: "fixed" as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998 }
                  : { position: "absolute" as any, top: 0, left: 0, right: 0, bottom: 0, zIndex: 9998 },
              ]}
            />
          )}

          <View style={[s.card, cardFixedStyle]}>
            <View style={s.header}>
              <Text style={s.headerTitle}>Messages</Text>
              {totalUnread > 0 && (
                <Text style={s.unreadCountText}>{totalUnread} unread</Text>
              )}
            </View>
            <View style={s.divider} />

            <ScrollView style={s.list} showsVerticalScrollIndicator={false}>
              {loading && threads.length === 0 ? (
                <ActivityIndicator size="small" color="#D798DA" style={{ paddingVertical: 24 }} />
              ) : threads.length === 0 ? (
                <Text style={s.empty}>
                  No conversations yet. Tap the wholesale chip on any coffee card to start one.
                </Text>
              ) : (
                threads.map((row, idx) => {
                  const cp = counterpartyOf(row, perspective);
                  const preview = row.last_message || row.inquiry_note || "Conversation started";
                  const sentByMe = row.last_message_user_id === user?.id;
                  const time = row.last_message_at || row.opened_at;
                  return (
                    <View key={row.inquiry_id}>
                      {idx > 0 && <View style={s.itemDivider} />}
                      <Pressable
                        onPress={() => openThread(row)}
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
        </>
      )}
    </>
  );
}

const s = StyleSheet.create({
  backdrop: { backgroundColor: "transparent" },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    minWidth: 340,
    maxWidth: 400,
    maxHeight: 520,
    paddingVertical: 8,
    ...cardShadow,
    shadowOpacity: 0.15,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  } as any,
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerTitle: { fontFamily: t.font["body.semibold"], fontSize: 16, color: "#351101" },
  unreadCountText: { fontFamily: t.font["body.medium"], fontSize: 11, color: "#D798DA" },
  divider: { height: 1, backgroundColor: "#EDE8E1", marginHorizontal: 12 },
  list: { maxHeight: 440 },
  empty: {
    fontFamily: t.font["body.regular"],
    fontSize: 13,
    color: "#A09580",
    textAlign: "center",
    paddingVertical: 32,
    paddingHorizontal: 24,
    lineHeight: 19,
  } as any,
  item: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  } as any,
  itemUnread: { backgroundColor: "rgba(215,152,218,0.06)" },
  itemHover: { backgroundColor: "rgba(215,152,218,0.12)" },
  itemDivider: { height: 1, backgroundColor: "rgba(237,232,225,0.5)", marginHorizontal: 16 },
  itemContent: { flex: 1, gap: 2 } as any,
  itemTopRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 8 } as any,
  itemName: { fontFamily: t.font["body.semibold"], fontSize: 13, color: "#351101", flex: 1 },
  itemTime: { fontFamily: t.font["body.regular"], fontSize: 10, color: "#A09580" },
  itemProduct: { fontFamily: t.font["body.medium"], fontSize: 10, color: "#684F44", letterSpacing: 0.2 } as any,
  itemPreview: { fontFamily: t.font["body.regular"], fontSize: 12, color: "#684F44", lineHeight: 17 } as any,
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
    backgroundColor: "#351101", alignItems: "center", justifyContent: "center",
  } as any,
  avatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 14, color: "#FAF8F0" },
});
