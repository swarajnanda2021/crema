/**
 * Flavor Schema Manager — admin section inside Catalog Ops >
 * Standardization. Lists every row in `sca_tree_versions`, lets the
 * admin upload a new schema (paste JSON), activate any schema, and see
 * the stale-address banner that prompts a Standardization Tasting
 * re-run after activation.
 *
 * Schema shape (`single_tier`):
 *   {
 *     "kind": "single_tier",
 *     "version": "crema_v3_n10",
 *     "label": "10-sector consumer wheel",
 *     "notes": "...",
 *     "sectors": [{ "name": "Chocolate", "absorbs": ["dark chocolate", ...] }, ...]
 *   }
 *
 * The Discover wheel reads whichever schema is active via
 * `GET /api/sca/tree`; flipping active here changes the wheel on the
 * next focus on the BEANS Flavor surface.
 */
import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  Modal,
  ScrollView,
  TextInput,
  Platform,
} from "react-native";
import { CheckCircle2, Plus, Upload, X } from "lucide-react-native";
import { t, makeStyles } from "../../tokens/useTokens";
import { apiFetchRaw } from "../../api/client";
import { tap as hapticTap, commit as hapticCommit } from "../../utils/haptics";

interface SchemaRow {
  id: number;
  uploaded_at: string;
  uploaded_by: string | null;
  is_active: boolean;
  notes: string | null;
  kind: string | null;
  version: string | null;
  label: string | null;
  sector_count: number;
  sector_names: string[];
}

interface ListPayload {
  schemas: SchemaRow[];
  active_id: number | null;
  stale_address_count: number;
  classified_address_count: number;
}

export default function FlavorSchemaManager({ onAfterActivate }: { onAfterActivate?: () => void }) {
  const [data, setData] = useState<ListPayload | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const s = useStyles();

  const refresh = async () => {
    try {
      const res: any = await apiFetchRaw("/admin/flavor-schemas");
      const payload = (res?.data ?? res) as ListPayload;
      setData(payload);
      setLoadErr(null);
    } catch (e: any) {
      setLoadErr(e?.message || "Failed to load flavor schemas");
    }
  };

  useEffect(() => { refresh(); }, []);

  const activate = async (schema_id: number) => {
    if (busy) return;
    hapticCommit();
    setBusy(true);
    try {
      await apiFetchRaw(`/admin/flavor-schemas/${schema_id}/activate`, { method: "POST" });
      await refresh();
      onAfterActivate?.();
    } finally {
      setBusy(false);
    }
  };

  const stale = data?.stale_address_count ?? 0;
  const classified = data?.classified_address_count ?? 0;
  const activeRow = useMemo(
    () => data?.schemas.find((r) => r.is_active) ?? null,
    [data],
  );

  return (
    <View style={s.wrap}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>FLAVOR SCHEMAS</Text>
          <Text style={s.blurb}>
            Single-tier schemas drive the consumer Discover Flavor wheel.
            One row is active at a time; flipping active reshapes the
            wheel on next focus.
          </Text>
        </View>
        <Pressable
          onPress={() => { hapticTap(); setUploadOpen(true); }}
          style={s.uploadBtn}
          accessibilityRole="button"
          accessibilityLabel="Upload flavor schema"
        >
          <Plus size={16} color={t.color["text.on-cta"]} strokeWidth={2.25} />
          <Text style={s.uploadBtnText}>Upload</Text>
        </Pressable>
      </View>

      {loadErr ? <Text style={s.errorText}>{loadErr}</Text> : null}

      {/* Stale-address banner — visible whenever any classified
          addresses exist that the active schema doesn't cover. */}
      {activeRow && stale > 0 ? (
        <View style={s.staleBanner}>
          <Text style={s.staleBannerText}>
            {stale} of {classified} classified tags are stale against{" "}
            <Text style={s.staleBannerBold}>{activeRow.label || activeRow.version}</Text>.
            {"\n"}Run Standardization → Tasting to re-classify against the
            new sectors.
          </Text>
        </View>
      ) : null}

      {/* Schema list */}
      {!data ? (
        <ActivityIndicator color={t.color["text.primary"]} style={{ marginVertical: 24 }} />
      ) : data.schemas.length === 0 ? (
        <Text style={s.emptyText}>No schemas yet — upload one to begin.</Text>
      ) : (
        <View style={{ gap: 12 }}>
          {data.schemas.map((row) => (
            <SchemaCard
              key={row.id}
              row={row}
              busy={busy}
              onActivate={() => activate(row.id)}
            />
          ))}
        </View>
      )}

      {uploadOpen ? (
        <UploadModal
          onClose={() => setUploadOpen(false)}
          onUploaded={() => { setUploadOpen(false); refresh(); }}
        />
      ) : null}
    </View>
  );
}

function SchemaCard({
  row, busy, onActivate,
}: { row: SchemaRow; busy: boolean; onActivate: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const fmtDate = formatStamp(row.uploaded_at);
  const s = useStyles();
  return (
    <View style={[s.card, row.is_active && s.cardActive]}>
      <View style={s.cardHead}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={s.cardTitle}>{row.label || row.version || `Schema #${row.id}`}</Text>
            {row.is_active ? (
              <View style={s.activeBadge}>
                <CheckCircle2 size={12} color={t.color["text.on-cta"]} strokeWidth={2.5} />
                <Text style={s.activeBadgeText}>ACTIVE</Text>
              </View>
            ) : null}
          </View>
          <Text style={s.cardSub}>
            {row.sector_count} sectors · {row.kind || "?"} · uploaded {fmtDate}
            {row.uploaded_by ? ` by ${row.uploaded_by}` : ""}
          </Text>
        </View>
        {!row.is_active ? (
          <Pressable
            onPress={onActivate}
            disabled={busy}
            style={[s.activateBtn, busy && { opacity: 0.5 }]}
            accessibilityRole="button"
            accessibilityLabel={`Activate ${row.label || row.version}`}
          >
            <Text style={s.activateBtnText}>Activate</Text>
          </Pressable>
        ) : null}
      </View>
      {row.notes ? <Text style={s.cardNotes}>{row.notes}</Text> : null}
      <Pressable onPress={() => setExpanded((v) => !v)} style={s.expander}>
        <Text style={s.expanderText}>
          {expanded ? "Hide" : "Show"} sector list
        </Text>
      </Pressable>
      {expanded ? (
        <View style={s.sectorList}>
          {row.sector_names.map((nm, i) => (
            <View key={`${nm}-${i}`} style={s.sectorChip}>
              <Text style={s.sectorChipText}>{nm}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function UploadModal({
  onClose, onUploaded,
}: { onClose: () => void; onUploaded: () => void }) {
  const [text, setText] = useState("");
  const [notes, setNotes] = useState("");
  const [activate, setActivate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const s = useStyles();

  const submit = async () => {
    if (submitting) return;
    setErr(null);
    setSubmitting(true);
    try {
      await apiFetchRaw("/admin/flavor-schemas", {
        method: "POST",
        body: JSON.stringify({ tree_json: text, notes, activate }),
      });
      onUploaded();
    } catch (e: any) {
      setErr(e?.message || "Upload failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal animationType="fade" transparent visible onRequestClose={onClose}>
      <View style={s.modalScrim}>
        <View style={s.modalCard}>
          <View style={s.modalHead}>
            <Text style={s.modalTitle}>Upload flavor schema</Text>
            <Pressable onPress={onClose} accessibilityLabel="Close">
              <X size={20} color={t.color["text.primary"]} strokeWidth={2} />
            </Pressable>
          </View>
          <Text style={s.modalBlurb}>
            Paste a single-tier schema JSON. Required fields: kind
            (must be "single_tier"), version, label, sectors[]. Each
            sector needs name + absorbs[].
          </Text>
          <TextInput
            value={text}
            onChangeText={setText}
            multiline
            placeholder='{"kind":"single_tier","version":"crema_v4_n12","label":"...","sectors":[...]}'
            placeholderTextColor={t.color["text.muted"]}
            style={s.codeInput}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={s.fieldLabel}>Notes (optional)</Text>
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="e.g. A/B variant: drops Wine, splits Berry"
            placeholderTextColor={t.color["text.muted"]}
            style={s.notesInput}
          />
          <Pressable
            onPress={() => { hapticTap(); setActivate((v) => !v); }}
            style={s.toggleRow}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: activate }}
          >
            <View style={[s.checkbox, activate && s.checkboxOn]} />
            <Text style={s.toggleText}>Activate immediately on upload</Text>
          </Pressable>
          {err ? <Text style={s.errorText}>{err}</Text> : null}
          <View style={s.modalFoot}>
            <Pressable onPress={onClose} style={s.cancelBtn}>
              <Text style={s.cancelBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              onPress={submit}
              disabled={submitting || !text.trim()}
              style={[s.submitBtn, (submitting || !text.trim()) && { opacity: 0.5 }]}
            >
              <Upload size={14} color={t.color["text.on-cta"]} strokeWidth={2.25} />
              <Text style={s.submitBtnText}>
                {submitting ? "Uploading…" : "Upload schema"}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function formatStamp(iso: string): string {
  if (!iso) return "?";
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles((t) => ({
  wrap: {
    gap: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  title: {
    fontFamily: t.font["body.semibold"],
    fontSize: 12,
    color: t.color["text.muted"],
    letterSpacing: 1.4,
    marginBottom: 4,
  },
  blurb: {
    fontFamily: t.font["body.regular"],
    fontSize: 13,
    color: t.color["text.secondary"],
    lineHeight: 18,
  },
  uploadBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: t.color["text.primary"],
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  uploadBtnText: {
    fontFamily: t.font["body.semibold"],
    fontSize: 12,
    color: t.color["text.on-cta"],
    letterSpacing: 0.4,
  },
  staleBanner: {
    backgroundColor: t.color["accent.soft"],
    borderLeftWidth: 3,
    borderLeftColor: t.color.accent,
    padding: 12,
    borderRadius: 6,
  },
  staleBannerText: {
    fontFamily: t.font["body.regular"],
    fontSize: 12,
    color: t.color["text.primary"],
    lineHeight: 17,
  },
  staleBannerBold: {
    fontFamily: t.font["body.semibold"],
  },
  errorText: {
    fontFamily: t.font["body.regular"],
    fontSize: 12,
    color: "#A33",
    marginTop: 4,
  },
  emptyText: {
    fontFamily: t.font["body.regular"],
    fontSize: 13,
    color: t.color["text.muted"],
    marginVertical: 16,
    textAlign: "center",
  },
  card: {
    borderWidth: 1,
    borderColor: t.color["accent.soft"],
    borderRadius: 8,
    padding: 12,
    backgroundColor: t.color.bg,
    gap: 6,
  },
  cardActive: {
    borderColor: t.color.accent,
    borderWidth: 1.5,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
  },
  cardTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: 14,
    color: t.color["text.primary"],
  },
  cardSub: {
    fontFamily: t.font["body.regular"],
    fontSize: 11,
    color: t.color["text.muted"],
    marginTop: 2,
  },
  cardNotes: {
    fontFamily: t.font["body.regular"],
    fontSize: 12,
    color: t.color["text.secondary"],
    fontStyle: "italic",
  },
  activeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: t.color.accent,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
  },
  activeBadgeText: {
    fontFamily: t.font["body.semibold"],
    fontSize: 9,
    color: t.color["text.on-cta"],
    letterSpacing: 0.6,
  },
  activateBtn: {
    backgroundColor: t.color["accent.soft"],
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  activateBtnText: {
    fontFamily: t.font["body.semibold"],
    fontSize: 11,
    color: t.color["text.primary"],
    letterSpacing: 0.4,
  },
  expander: {
    paddingVertical: 4,
  },
  expanderText: {
    fontFamily: t.font["body.semibold"],
    fontSize: 11,
    color: t.color["text.muted"],
    letterSpacing: 0.4,
  },
  sectorList: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 4,
  },
  sectorChip: {
    backgroundColor: t.color["accent.soft"],
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  sectorChipText: {
    fontFamily: t.font["body.semibold"],
    fontSize: 11,
    color: t.color["text.primary"],
  },
  modalScrim: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 560,
    backgroundColor: t.color.bg,
    borderRadius: 12,
    padding: 16,
    gap: 10,
  },
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
  },
  modalTitle: {
    fontFamily: t.font.display,
    fontSize: 20,
    color: t.color["text.primary"],
    flex: 1,
  },
  modalBlurb: {
    fontFamily: t.font["body.regular"],
    fontSize: 12,
    color: t.color["text.secondary"],
    lineHeight: 17,
  },
  codeInput: {
    minHeight: 200,
    borderWidth: 1,
    borderColor: t.color["accent.soft"],
    borderRadius: 6,
    padding: 10,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) as any,
    fontSize: 11,
    color: t.color["text.primary"],
    textAlignVertical: "top",
  },
  fieldLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: 11,
    color: t.color["text.muted"],
    letterSpacing: 0.4,
    marginTop: 4,
  },
  notesInput: {
    borderWidth: 1,
    borderColor: t.color["accent.soft"],
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontFamily: t.font["body.regular"],
    fontSize: 13,
    color: t.color["text.primary"],
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  checkbox: {
    width: 16,
    height: 16,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: t.color["text.primary"],
    backgroundColor: t.color.bg,
  },
  checkboxOn: {
    backgroundColor: t.color.accent,
    borderColor: t.color.accent,
  },
  toggleText: {
    fontFamily: t.font["body.regular"],
    fontSize: 13,
    color: t.color["text.primary"],
  },
  modalFoot: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
    marginTop: 8,
  },
  cancelBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
  },
  cancelBtnText: {
    fontFamily: t.font["body.semibold"],
    fontSize: 13,
    color: t.color["text.muted"],
  },
  submitBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: t.color["text.primary"],
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
  },
  submitBtnText: {
    fontFamily: t.font["body.semibold"],
    fontSize: 13,
    color: t.color["text.on-cta"],
  },
}));
