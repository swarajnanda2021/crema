/**
 * RecycleBinModal — every hard delete the signed-in user has
 * performed, grouped by entity type, with Restore + permanent-Delete
 * per row. Opens from the ProfileDropdown "Recycle bin" item.
 *
 * Backend contract: GET /api/trash returns an array of
 * `{ id, entity_type, entity_id, payload, label, deleted_at }`.
 * Restore POSTs /api/trash/{id}/restore; permanent delete DELETEs
 * /api/trash/{id}. Both return envelope-wrapped `{ ok: true }`.
 */

import { useEffect, useState, useCallback } from "react";
import {
  View, Text, Pressable, Modal, ScrollView,
  StyleSheet, Platform, ActivityIndicator,
} from "react-native";
import { X, Undo2, Trash2 } from "lucide-react-native";
import { t, makeStyles } from "../tokens/useTokens";
import { apiFetchRaw } from "../api/client";

interface TrashEntry {
  id: number;
  entity_type: string;
  entity_id: string;
  label: string | null;
  deleted_at: string;
  payload: Record<string, any>;
}

interface Props {
  visible: boolean;
  onClose: () => void;
}

// Human-readable section labels for each entity_type. The backend
// sends back raw registry names; keep the map here so the copy lives
// near the UI.
const SECTION_LABELS: Record<string, string> = {
  posts: "Posts",
  post_comments: "Comments",
  tasting_notes: "Tasting notes",
  shelf_entries: "Shelf entries",
  cafe_menu_items: "Café menu items",
  brew_methods: "Brew recipes",
  roaster_products: "Products",
};

// Order sections appear in the modal. Anything not in the list falls
// through to the end.
const SECTION_ORDER = [
  "posts", "post_comments", "tasting_notes",
  "shelf_entries", "cafe_menu_items", "brew_methods", "roaster_products",
];

function timeAgo(iso: string): string {
  try {
    const d = Date.now() - new Date(iso).getTime();
    const m = Math.floor(d / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.floor(h / 24);
    if (days < 30) return `${days}d ago`;
    return new Date(iso).toLocaleDateString("en-IN", { month: "short", day: "numeric" });
  } catch { return ""; }
}

export default function RecycleBinModal({ visible, onClose }: Props) {
  const [entries, setEntries] = useState<TrashEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const s = useStyles();

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const raw = await apiFetchRaw<any>("/trash");
      const data = raw?.data ?? raw;
      setEntries(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setErrorMsg(e?.message || "Failed to load bin");
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { if (visible) load(); }, [visible, load]);

  const handleRestore = async (id: number) => {
    if (busyId !== null) return;
    setBusyId(id);
    setErrorMsg(null);
    try {
      await apiFetchRaw(`/trash/${id}/restore`, { method: "POST" });
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (e: any) {
      setErrorMsg(e?.message || "Restore failed");
    } finally {
      setBusyId(null);
    }
  };

  const handlePurge = async (id: number) => {
    if (busyId !== null) return;
    setBusyId(id);
    setErrorMsg(null);
    try {
      await apiFetchRaw(`/trash/${id}`, { method: "DELETE" });
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (e: any) {
      setErrorMsg(e?.message || "Delete failed");
    } finally {
      setBusyId(null);
    }
  };

  const handleEmpty = async () => {
    if (busyId !== null) return;
    if (entries.length === 0) return;
    setBusyId(-1);
    setErrorMsg(null);
    try {
      await apiFetchRaw("/trash", { method: "DELETE" });
      setEntries([]);
    } catch (e: any) {
      setErrorMsg(e?.message || "Empty bin failed");
    } finally {
      setBusyId(null);
    }
  };

  // Bucket entries by entity_type in SECTION_ORDER order.
  const grouped: Array<[string, TrashEntry[]]> = [];
  const byType = new Map<string, TrashEntry[]>();
  for (const entry of entries) {
    const bucket = byType.get(entry.entity_type) || [];
    bucket.push(entry);
    byType.set(entry.entity_type, bucket);
  }
  for (const key of SECTION_ORDER) {
    const bucket = byType.get(key);
    if (bucket && bucket.length) grouped.push([key, bucket]);
  }
  for (const [key, bucket] of byType.entries()) {
    if (!SECTION_ORDER.includes(key)) grouped.push([key, bucket]);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={s.overlayWrap}>
        <Pressable style={s.overlayBg} onPress={onClose} />
        <View style={s.card}>
          <View style={s.header}>
            <View style={{ flex: 1 }}>
              <Text style={s.title}>Recycle bin</Text>
              <Text style={s.subtitle}>
                {loading ? "Loading…" : entries.length === 0 ? "Nothing here yet" : `${entries.length} item${entries.length === 1 ? "" : "s"}`}
              </Text>
            </View>
            {entries.length > 0 && !loading && (
              <Pressable onPress={handleEmpty} style={s.emptyBtn} disabled={busyId !== null}>
                <Text style={s.emptyBtnText}>Empty bin</Text>
              </Pressable>
            )}
            <Pressable onPress={onClose} style={s.closeBtn} hitSlop={8}>
              <X size={18} color={t.color["text.secondary"]} />
            </Pressable>
          </View>

          {errorMsg && (
            <View style={s.errorBanner}>
              <Text style={s.errorText}>{errorMsg}</Text>
            </View>
          )}

          <ScrollView
            style={s.scrollArea}
            contentContainerStyle={s.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {loading ? (
              <View style={s.loadingWrap}><ActivityIndicator size="small" color={t.color.accent} /></View>
            ) : entries.length === 0 ? (
              <Text style={s.emptyText}>
                Delete any post, comment, shelf entry, menu item, or product and it'll land here. Restore from the bin within 30 days.
              </Text>
            ) : (
              grouped.map(([entityType, bucket]) => (
                <View key={entityType} style={s.section}>
                  <Text style={s.sectionLabel}>{SECTION_LABELS[entityType] || entityType}</Text>
                  {bucket.map((entry) => (
                    <View key={entry.id} style={s.row}>
                      <View style={s.rowMain}>
                        <Text style={s.rowLabel} numberOfLines={2}>
                          {entry.label || `${entityType} · ${entry.entity_id}`}
                        </Text>
                        <Text style={s.rowMeta}>Deleted {timeAgo(entry.deleted_at)}</Text>
                      </View>
                      <View style={s.rowActions}>
                        <Pressable
                          onPress={() => handleRestore(entry.id)}
                          style={[s.restoreBtn, busyId === entry.id && s.busy]}
                          disabled={busyId !== null}
                          accessibilityLabel="Restore"
                        >
                          <Undo2 size={13} color={t.color["text.on-cta"]} strokeWidth={2} />
                          <Text style={s.restoreText}>Restore</Text>
                        </Pressable>
                        <Pressable
                          onPress={() => handlePurge(entry.id)}
                          style={[s.purgeBtn, busyId === entry.id && s.busy]}
                          disabled={busyId !== null}
                          accessibilityLabel="Delete forever"
                        >
                          <Trash2 size={14} color={t.color["text.primary"]} strokeWidth={1.8} />
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((t) => ({
  overlayWrap: {
    flex: 1, justifyContent: "center", alignItems: "center",
    ...(Platform.OS === "web" ? ({ backdropFilter: "blur(35px)", WebkitBackdropFilter: "blur(35px)" } as any) : {}),
  } as any,
  overlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: t.color.overlay } as any,
  card: {
    width: "90%", maxWidth: 680, backgroundColor: t.color.bg,
    borderRadius: t.radius.lg, overflow: "hidden",
    maxHeight: "85%", zIndex: 1,
  } as any,
  header: {
    flexDirection: "row", alignItems: "center",
    paddingHorizontal: 20, paddingVertical: 16,
    borderBottomWidth: 1, borderBottomColor: t.color["border.light"],
    gap: 10,
  } as any,
  title: {
    fontFamily: t.font.display, fontSize: 20,
    color: t.color["text.primary"], lineHeight: 26,
  },
  subtitle: {
    fontFamily: t.font["body.regular"], fontSize: 12,
    color: t.color["text.muted"], marginTop: 2,
  },
  emptyBtn: {
    paddingHorizontal: 10, paddingVertical: 6,
    borderRadius: 14, borderWidth: 1, borderColor: t.color["border.light"],
  } as any,
  emptyBtnText: {
    fontFamily: t.font["body.medium"], fontSize: 11,
    color: t.color["text.secondary"], letterSpacing: 0.3,
  } as any,
  closeBtn: { padding: 4 },
  errorBanner: {
    paddingHorizontal: 20, paddingVertical: 10,
    backgroundColor: "rgba(220,80,80,0.08)",
    borderBottomWidth: 1, borderBottomColor: "rgba(220,80,80,0.18)",
  } as any,
  errorText: {
    fontFamily: t.font["body.medium"], fontSize: 12,
    color: "#B84A4A",
  } as any,
  scrollArea: { flex: 1, minHeight: 0 },
  scrollContent: { paddingVertical: 8 },
  loadingWrap: { paddingVertical: 40, alignItems: "center" } as any,
  emptyText: {
    fontFamily: t.font["body.regular"], fontSize: 13,
    color: t.color["text.muted"], textAlign: "center" as any,
    paddingHorizontal: 32, paddingVertical: 40, lineHeight: 19,
  } as any,
  section: { paddingTop: 10 } as any,
  sectionLabel: {
    fontFamily: t.font["body.semibold"], fontSize: 11,
    color: t.color["text.muted"], letterSpacing: 0.5,
    textTransform: "uppercase",
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 6,
  } as any,
  row: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 20, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: t.color["border.light"],
  } as any,
  rowMain: { flex: 1, minWidth: 0 },
  rowLabel: {
    fontFamily: t.font["body.medium"], fontSize: 13,
    color: t.color["text.primary"], lineHeight: 18,
  },
  rowMeta: {
    fontFamily: t.font["body.regular"], fontSize: 10,
    color: t.color["text.muted"], marginTop: 3,
  },
  rowActions: { flexDirection: "row", alignItems: "center", gap: 6 } as any,
  restoreBtn: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: t.color["text.primary"],
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
  } as any,
  restoreText: {
    fontFamily: t.font["body.semibold"], fontSize: 11,
    color: t.color["text.on-cta"], letterSpacing: 0.2,
  } as any,
  purgeBtn: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: t.color["card.info"],
    alignItems: "center", justifyContent: "center",
  } as any,
  busy: { opacity: 0.4 } as any,
}));
