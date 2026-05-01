/**
 * JobHistory — operational diagnostics surface for the admin Catalog
 * Ops tabs. Hosts:
 *
 *   * `<RecentEnrichmentRuns />` — bottom-of-tab collapsible that
 *     shows the live job indicator + the last 20 enrichment runs +
 *     the per-job proposal carousels + the undo confirmation modal.
 *     Rendered by RoastersPanel under the merged Roasters & Beans
 *     surface.
 *
 *   * `<JobHistory />` — the row list itself, exported so
 *     StandardizationPanel can reuse it for standardize jobs (no
 *     proposal carousels there, just rows + log links).
 *
 *   * `<JobLogModal />` — the full stdout/stderr viewer, also reused
 *     by StandardizationPanel.
 *
 *   * `parseResult`, `formatRelative` — pure helpers also imported by
 *     RoastersPanel + StandardizationPanel.
 *
 * Pulled out of the prior `ScraperPanel.tsx` when BEANS was merged
 * into Roasters & Beans. The browse-list shape that ScraperPanel
 * used to wrap these helpers is gone — RoastersPanel is now the
 * single browse surface for both lenses.
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
  Platform,
} from "react-native";
import {
  ChevronDown,
  ChevronRight,
  RotateCcw,
  Undo2,
  X,
} from "lucide-react-native";

import { t, makeStyles } from "../../tokens/useTokens";
import { apiFetchRaw } from "../../api/client";
import { useResource } from "../../resources/useResource";
import type { CatalogJob } from "../../resources/types";
import JobProposalsCarousel from "./JobProposalsCarousel";

// ── RecentEnrichmentRuns ────────────────────────────────────────────────
// Owns the JobHistory + JobLogModal + UndoConfirmModal stack. Auto-
// expands when a live job is in flight so the admin doesn't have to
// hunt for the progress strip.

export function RecentEnrichmentRuns() {
  const jobs = useResource<CatalogJob>("jobs", { limit: 50 });
  const [expanded, setExpanded] = useState(false);
  const [logModalJob, setLogModalJob] = useState<CatalogJob | null>(null);
  const [undoTarget, setUndoTarget] = useState<CatalogJob | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoResult, setUndoResult] = useState<string | null>(null);
  const s = useStyles();

  const liveJob = useMemo(
    () => (jobs.data || []).find(
      (j) =>
        (j.kind as any) === "scrape" &&
        (j.status === "queued" || j.status === "running"),
    ),
    [jobs.data],
  );

  // Auto-expand whenever a job goes live so the admin sees progress.
  useEffect(() => {
    if (liveJob) setExpanded(true);
  }, [liveJob?.id]);

  // Poll while a job is running so the body reflects fresh log_tail
  // + status without a manual refetch.
  useEffect(() => {
    if (!liveJob) return;
    const id = setInterval(() => {
      jobs.refetch();
    }, 2000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveJob?.id]);

  const scrapeJobs = useMemo(
    () =>
      (jobs.data || [])
        .filter((j) => (j.kind as any) === "scrape" || (j.kind as any) === "manual_sold_out")
        .slice(0, 20),
    [jobs.data],
  );

  return (
    <View style={s.recentBlock}>
      <Pressable
        onPress={() => setExpanded((v) => !v)}
        style={({ pressed }) => [s.recentHead, pressed && s.iconBtnPressed]}
        accessibilityRole="button"
        accessibilityLabel={
          expanded ? "Collapse recent enrichment runs" : "Expand recent enrichment runs"
        }
      >
        {expanded ? (
          <ChevronDown size={t.size["icon.sm"]} color={t.color["text.secondary"]} />
        ) : (
          <ChevronRight size={t.size["icon.sm"]} color={t.color["text.secondary"]} />
        )}
        <Text style={s.recentTitle}>Recent enrichment runs ({scrapeJobs.length})</Text>
        {liveJob ? (
          <View style={s.liveBadge}>
            <View style={s.livePulse} />
            <Text style={s.liveBadgeText}>
              {liveJob.status === "queued" ? "queued" : "running"}
            </Text>
          </View>
        ) : null}
      </Pressable>
      {expanded ? (
        <View style={s.recentBody}>
          <JobHistory
            jobs={scrapeJobs}
            loading={jobs.loading}
            onTap={setLogModalJob}
            onUndo={(job) => {
              setUndoResult(null);
              setUndoTarget(job);
            }}
            onProposalsChanged={() => jobs.refetch()}
          />
        </View>
      ) : null}

      <JobLogModal job={logModalJob} onClose={() => setLogModalJob(null)} />
      <UndoConfirmModal
        job={undoTarget}
        busy={undoBusy}
        result={undoResult}
        onClose={() => {
          setUndoTarget(null);
          setUndoResult(null);
        }}
        onConfirm={async (job) => {
          setUndoBusy(true);
          setUndoResult(null);
          try {
            const res: any = await apiFetchRaw(
              `/admin/scrape/jobs/${job.id}/undo`,
              { method: "POST" },
            );
            const data = (res?.data ?? res) || {};
            const reverted = data.reverted ?? 0;
            const skipped = data.skipped ?? 0;
            setUndoResult(
              `Reverted ${reverted} change${reverted === 1 ? "" : "s"}` +
                (skipped > 0 ? ` · ${skipped} skipped (no captured prev state)` : "")
            );
            await jobs.refetch();
          } catch (e: any) {
            setUndoResult(`Undo failed: ${e?.message || "unknown error"}`);
          } finally {
            setUndoBusy(false);
          }
        }}
      />
    </View>
  );
}

// ── JobHistory ──────────────────────────────────────────────────────────
// Row list. Reused by StandardizationPanel for standardize jobs (no
// onUndo / onProposalsChanged passed there).

export function JobHistory({
  jobs,
  loading,
  onTap,
  onUndo,
  onProposalsChanged,
}: {
  jobs: CatalogJob[];
  loading: boolean;
  onTap: (job: CatalogJob) => void;
  onUndo?: (job: CatalogJob) => void;
  onProposalsChanged?: () => void;
}) {
  // Auto-expand the most recent succeeded enrichment that still has
  // pending proposals so the admin lands on what needs review.
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [autoExpandedId, setAutoExpandedId] = useState<number | null>(null);
  const s = useStyles();

  useEffect(() => {
    if (autoExpandedId !== null) return;
    const candidate = jobs.find(
      (j) => ((j.kind as any) === "scrape" || (j.kind as any) === "manual_sold_out") && j.status === "succeeded",
    );
    if (candidate) {
      setExpanded(new Set([candidate.id]));
      setAutoExpandedId(candidate.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs.length === 0]);

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading && jobs.length === 0) {
    return (
      <View style={s.emptyBlock}>
        <ActivityIndicator size="small" color={t.color["text.primary"]} />
      </View>
    );
  }
  if (jobs.length === 0) {
    return <Text style={s.emptyText}>Nothing here yet.</Text>;
  }
  return (
    <View style={s.list}>
      {jobs.map((job) => {
        const isExpandable =
          ((job.kind as any) === "scrape" || (job.kind as any) === "manual_sold_out") &&
          job.status === "succeeded";
        const isOpen = isExpandable && expanded.has(job.id);
        return (
          <View key={job.id} style={s.jobCard}>
            <View style={s.jobRow}>
              <Pressable
                onPress={() => (isExpandable ? toggle(job.id) : onTap(job))}
                style={({ pressed }) => [s.jobRowInner, pressed && s.jobRowPressed]}
                accessibilityLabel={
                  isExpandable
                    ? isOpen
                      ? `Collapse run ${job.id}`
                      : `Expand run ${job.id}`
                    : `View log for run ${job.id}`
                }
              >
                {isExpandable ? (
                  isOpen ? (
                    <ChevronDown size={t.size["icon.sm"]} color={t.color["text.primary"]} />
                  ) : (
                    <ChevronRight size={t.size["icon.sm"]} color={t.color["text.primary"]} />
                  )
                ) : null}
                <View style={s.rowMain}>
                  <Text style={s.rowName}>
                    #{job.id} · {jobLabel(job.kind)} · {jobStatusLabel(job.status)}
                  </Text>
                  <Text style={s.rowSub}>
                    {job.started_at ? `Started ${formatRelative(job.started_at)}` : "Queued"}
                    {job.finished_at ? ` · finished ${formatRelative(job.finished_at)}` : ""}
                  </Text>
                  {job.error_message ? (
                    <Text style={s.rowMetaError} numberOfLines={1}>
                      {job.error_message}
                    </Text>
                  ) : (
                    <Text style={s.rowMeta} numberOfLines={1}>
                      {summarizeJob(job)}
                    </Text>
                  )}
                </View>
              </Pressable>
              <View style={s.rowActions}>
                <Pressable
                  onPress={() => onTap(job)}
                  style={({ pressed }) => [s.linkBtn, pressed && s.linkBtnPressed]}
                  accessibilityLabel={`View log for run ${job.id}`}
                >
                  <Text style={s.linkBtnText}>Log</Text>
                </Pressable>
                {onUndo && isExpandable ? (
                  <Pressable
                    onPress={() => onUndo(job)}
                    style={({ pressed }) => [s.undoBtn, pressed && s.iconBtnPressed]}
                    accessibilityLabel={`Undo run ${job.id}`}
                  >
                    <Undo2 size={14} color={t.color["text.primary"]} strokeWidth={1.8} />
                    <Text style={s.undoBtnText}>Undo</Text>
                  </Pressable>
                ) : null}
              </View>
            </View>
            {isOpen ? (
              <JobProposalsCarousel jobId={job.id} onChanged={onProposalsChanged} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

// ── Job log modal ───────────────────────────────────────────────────────

export function JobLogModal({
  job,
  onClose,
}: {
  job: CatalogJob | null;
  onClose: () => void;
}) {
  const s = useStyles();
  return (
    <Modal
      visible={!!job}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={s.overlayWrap}>
        <Pressable style={s.overlayBg} onPress={onClose} />
        <View style={s.modal}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>
              {job ? `Run #${job.id} · ${jobLabel(job.kind)}` : ""}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={t.size["icon.lg"]} color={t.color["text.primary"]} />
            </Pressable>
          </View>
          <ScrollView style={s.modalBody} contentContainerStyle={{ padding: t.spacing.xl }}>
            {job?.error_message ? (
              <Text style={s.errorText}>{job.error_message}</Text>
            ) : null}
            <Text style={s.logText} selectable>
              {job?.log_tail || "(no log captured)"}
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ── Undo confirmation modal ─────────────────────────────────────────────

function UndoConfirmModal({
  job,
  busy,
  result,
  onClose,
  onConfirm,
}: {
  job: CatalogJob | null;
  busy: boolean;
  result: string | null;
  onClose: () => void;
  onConfirm: (job: CatalogJob) => Promise<void> | void;
}) {
  const s = useStyles();
  return (
    <Modal
      visible={!!job}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={s.overlayWrap}>
        <Pressable style={s.overlayBg} onPress={onClose} />
        <View style={s.confirmCard}>
          <View style={s.modalHeader}>
            <Text style={s.modalTitle}>
              {job ? `Undo run #${job.id}?` : "Undo"}
            </Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={t.size["icon.lg"]} color={t.color["text.primary"]} />
            </Pressable>
          </View>
          <View style={s.confirmBody}>
            <Text style={s.confirmText}>
              This reverses every approved change from this run. New rows
              get deleted (unless a roaster has since claimed them);
              refreshes replay the prior state where it was captured;
              sold-out flags flip back to available.
            </Text>
            {job && (job.kind as any) === "scrape" ? (
              <Text style={s.confirmSubtle}>
                Backfilled prior runs may not have a captured prev-state
                for refreshes — those entries are skipped.
              </Text>
            ) : null}
            {result ? <Text style={s.confirmResult}>{result}</Text> : null}
            <View style={s.confirmActions}>
              <Pressable
                onPress={onClose}
                style={({ pressed }) => [s.linkBtn, pressed && s.linkBtnPressed]}
              >
                <Text style={s.linkBtnText}>{result ? "Close" : "Cancel"}</Text>
              </Pressable>
              {!result ? (
                <Pressable
                  onPress={() => job && onConfirm(job)}
                  disabled={busy}
                  style={({ pressed }) => [
                    s.cta,
                    busy && s.ctaDisabled,
                    pressed && !busy && s.ctaPressed,
                  ]}
                >
                  {busy ? (
                    <ActivityIndicator size="small" color={t.color["text.on-cta"]} />
                  ) : (
                    <RotateCcw
                      size={t.size["icon.sm"]}
                      color={t.color["text.on-cta"]}
                      strokeWidth={2}
                    />
                  )}
                  <Text style={s.ctaText}>Confirm undo</Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Helpers (re-exported for StandardizationPanel + RoastersPanel) ─────

export function parseResult(raw: any): Record<string, any> {
  if (!raw) return {};
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) || {};
    } catch {
      return {};
    }
  }
  if (typeof raw === "object") return raw;
  return {};
}

export function formatRelative(iso: string): string {
  const ms = Date.parse(iso);
  if (!ms) return iso;
  const diff = Math.max(0, Date.now() - ms);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function jobLabel(kind: CatalogJob["kind"]): string {
  if ((kind as any) === "scrape") return "Enrichment";
  if (kind === "geolocate") return "Classify";
  if (kind === "tree_validate") return "Tree";
  if ((kind as any) === "manual_sold_out") return "Manual sold-out";
  return kind;
}

function jobStatusLabel(status: CatalogJob["status"]): string {
  if (status === "succeeded") return "succeeded";
  if (status === "failed") return "failed";
  if (status === "running") return "running";
  return "queued";
}

function summarizeJob(job: CatalogJob): string {
  const r = parseResult(job.result_summary);
  if ((job.kind as any) === "scrape") {
    return `${r.scraped ?? 0} fetched · ${r.new_products_total ?? 0} new · ${r.updated_total ?? 0} updated · ${r.missing_total ?? 0} missing`;
  }
  if (job.kind === "geolocate") {
    return `${r.unclassified_input ?? 0} input · ${r.classified ?? 0} classified · ${r.null_resolved ?? 0} null`;
  }
  return "—";
}

// ── Styles ─────────────────────────────────────────────────────────────

const useStyles = makeStyles((t) => ({
  emptyBlock: {
    alignItems: "center",
    paddingVertical: t.spacing["2xl"],
  } as any,
  emptyText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.muted"],
    textAlign: "center",
    paddingVertical: t.spacing["2xl"],
  } as any,

  // Recent enrichment runs collapsible
  recentBlock: {
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    overflow: "hidden",
  } as any,
  recentHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
    flexWrap: "wrap",
  } as any,
  recentTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  recentBody: {
    borderTopWidth: 1,
    borderTopColor: t.color["border.light"],
    padding: t.spacing.lg,
  } as any,
  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    marginLeft: "auto" as any,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: 2,
    borderRadius: t.radius.full,
    backgroundColor: t.color["card.info"],
  } as any,
  livePulse: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.color["accent.cta"],
  } as any,
  liveBadgeText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.primary"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // JobHistory rows
  list: { gap: t.spacing.sm },
  jobCard: {
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    overflow: "hidden",
  } as any,
  jobRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
  },
  jobRowInner: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
  } as any,
  jobRowPressed: {
    opacity: 0.7,
  } as any,
  rowMain: { flex: 1, gap: 2 } as any,
  rowActions: {
    flexDirection: "row",
    gap: t.spacing.sm,
  },
  rowName: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
  },
  rowSub: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
  },
  rowMeta: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.secondary"],
  },
  rowMetaError: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["accent.cta"],
  },
  iconBtnPressed: { opacity: 0.7 } as any,

  // Plain-text link-style button
  linkBtn: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
  } as any,
  linkBtnPressed: { opacity: 0.6 } as any,
  linkBtnText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  undoBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    backgroundColor: t.color["card.info"],
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.full,
  } as any,
  undoBtnText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.primary"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // Confirmation modal for undo
  confirmCard: {
    backgroundColor: t.color.bg,
    borderRadius: t.radius.lg,
    width: "92%",
    maxWidth: 480,
    overflow: "hidden",
    zIndex: 1,
  } as any,
  confirmBody: {
    padding: t.spacing.xl,
    gap: t.spacing.md,
  } as any,
  confirmText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.secondary"],
    lineHeight: t.lineHeight.relaxed,
  },
  confirmSubtle: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
  },
  confirmResult: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    backgroundColor: t.color["card.info"],
    padding: t.spacing.md,
    borderRadius: t.radius.sm,
  } as any,
  confirmActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: t.spacing.md,
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    backgroundColor: t.color["text.primary"],
    paddingHorizontal: t.spacing["2xl"],
    paddingVertical: t.spacing.lg,
    borderRadius: t.radius.md,
    minHeight: 56,
    shadowColor: t.color.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
  } as any,
  ctaDisabled: { opacity: 0.5 } as any,
  ctaPressed: {
    backgroundColor: t.color["card.back"],
    transform: [{ scale: 0.97 }],
  } as any,
  ctaText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.on-cta"],
  },

  // Job log modal
  overlayWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    ...(Platform.OS === "web"
      ? ({
          backdropFilter: "blur(35px)",
          WebkitBackdropFilter: "blur(35px)",
        } as any)
      : {}),
  } as any,
  overlayBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: t.color.overlay,
  } as any,
  modal: {
    backgroundColor: t.color.bg,
    borderRadius: t.radius.lg,
    width: "92%",
    maxWidth: 720,
    minHeight: 280,
    maxHeight: "85%",
    overflow: "hidden",
    zIndex: 1,
    flexDirection: "column",
  } as any,
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.md + 2,
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
  },
  modalTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.lg"],
    color: t.color["text.primary"],
    flex: 1,
    paddingRight: t.spacing.md,
  },
  modalBody: { flex: 1 } as any,
  logText: {
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "ui-monospace, monospace",
    }),
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
    lineHeight: t.lineHeight.base,
  } as any,
  errorText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["accent.cta"],
  },
}));
