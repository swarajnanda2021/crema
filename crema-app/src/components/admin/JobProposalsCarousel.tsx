/**
 * JobProposalsCarousel — per-job rails of staged bean changes the
 * admin reviews after an enrichment run completes. Each scrape stages
 * its diff into `scrape_proposals` with `status='pending'`; nothing
 * lands in `products` without an explicit Add / Apply / Mark sold-out
 * / Mark available tap.
 *
 * Cards are landscape `CoffeeCard` (370 × 251, matching the Discover
 * tab on mobile) with a status caption underneath ("New" / "In catalog
 * · refresh" / "Returning" / "Missing — mark sold-out?") and a single
 * primary action button per change_type. Long-press any card →
 * `BeanDetailModal` so the admin can tally which of the ~13 enriched
 * fields actually came back filled for that bean.
 *
 * Lifted out of ScraperPanel so both the BEANS browse tab (job-history
 * collapsible) and the per-roaster Coffees section on the admin
 * roaster page can mount the same carousel.
 */

import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Platform,
  StyleSheet,
} from "react-native";
import {
  Check,
  PackageX,
  RefreshCw,
  RotateCcw,
  X,
} from "lucide-react-native";

import * as Haptics from "expo-haptics";

import { t, makeStyles } from "../../tokens/useTokens";
import { apiFetchRaw } from "../../api/client";
import CoffeeCard from "../CoffeeCard";
import BeanDetailModal from "./BeanDetailModal";
import type { ScrapeProposal } from "../../resources/types";

type ProposalKind = ScrapeProposal["change_type"];

const PROPOSAL_DEF: Record<
  ProposalKind,
  {
    caption: string;
    actionLabel: string;
    actionIcon: "check" | "sold-out" | "restore" | "refresh";
    tone: "positive" | "neutral" | "warn";
  }
> = {
  insert: {
    caption: "New",
    actionLabel: "Add",
    actionIcon: "check",
    tone: "positive",
  },
  update: {
    caption: "In catalog · refresh",
    actionLabel: "Apply refresh",
    actionIcon: "refresh",
    tone: "neutral",
  },
  restore_available: {
    caption: "Returning",
    actionLabel: "Mark available",
    actionIcon: "restore",
    tone: "positive",
  },
  mark_sold_out: {
    caption: "Missing — mark sold-out?",
    actionLabel: "Mark sold-out",
    actionIcon: "sold-out",
    tone: "warn",
  },
};

const PROPOSAL_ORDER: ProposalKind[] = [
  "insert",
  "update",
  "restore_available",
  "mark_sold_out",
];

export default function JobProposalsCarousel({
  jobId,
  onChanged,
}: {
  jobId: number;
  onChanged?: () => void;
}) {
  const [proposals, setProposals] = useState<ScrapeProposal[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyIds, setBusyIds] = useState<Set<number>>(new Set());
  const s = useStyles();
  // Surfaces approve/reject failures (and partial-skip warnings) to
  // the admin so a silent 500/401 doesn't make the bulk button look
  // like a dud. Cleared at the start of every action.
  const [actionError, setActionError] = useState<string | null>(null);

  const refetch = async () => {
    setLoading(true);
    try {
      // Pull pending + applied + rejected so the admin sees what's been
      // resolved for this job, not just the still-actionable ones.
      const res: any = await apiFetchRaw(
        `/admin/scrape/proposals?job_id=${jobId}&status=`,
      );
      const rows = (res?.data ?? res) as ScrapeProposal[];
      setProposals(Array.isArray(rows) ? rows : []);
    } catch {
      setProposals([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const setBusy = (ids: number[], busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      for (const i of ids) {
        if (busy) next.add(i);
        else next.delete(i);
      }
      return next;
    });
  };

  const approve = async (ids: number[]) => {
    if (ids.length === 0) return;
    setActionError(null);
    setBusy(ids, true);
    try {
      const res: any = await apiFetchRaw("/admin/scrape/proposals/approve", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      // Backend returns { applied, skipped }. Surface skipped > 0 as
      // a soft warning — those rows didn't move, the admin should
      // know rather than think it worked silently.
      const data = (res?.data ?? res) || {};
      const applied = data.applied ?? 0;
      const skipped = data.skipped ?? 0;
      if (applied === 0 && skipped > 0) {
        setActionError(
          `Backend skipped all ${skipped} proposal(s) — likely already applied or rejected. Carousel will refresh.`,
        );
      } else if (skipped > 0) {
        setActionError(
          `Applied ${applied}, skipped ${skipped}. Skipped rows were already resolved.`,
        );
      }
      await refetch();
      onChanged?.();
    } catch (err: any) {
      // Surface the error rather than swallow it — the prior silent
      // catch made bulk-apply look like a dud when the request 500'd
      // or 401'd. eslint-disable-next-line no-console
      console.warn("[approve] failed", ids, err?.message || err);
      setActionError(
        `Couldn't apply ${ids.length} proposal${ids.length === 1 ? "" : "s"}: ${err?.message || "unknown error"}`,
      );
    } finally {
      setBusy(ids, false);
    }
  };
  const reject = async (ids: number[]) => {
    if (ids.length === 0) return;
    setActionError(null);
    setBusy(ids, true);
    try {
      await apiFetchRaw("/admin/scrape/proposals/reject", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
      await refetch();
      onChanged?.();
    } catch (err: any) {
      // eslint-disable-next-line no-console
      console.warn("[reject] failed", ids, err?.message || err);
      setActionError(
        `Couldn't skip ${ids.length} proposal${ids.length === 1 ? "" : "s"}: ${err?.message || "unknown error"}`,
      );
    } finally {
      setBusy(ids, false);
    }
  };

  // Only render rows that still need admin action. The local refetch
  // pulls every status (pending + applied + rejected) so we can
  // recompute counts after Add-all / Skip-all without a stale
  // "all-statuses" snapshot, but the rails themselves should only
  // show what's still actionable — otherwise the just-approved cards
  // linger as a history rail and read as "Add all didn't actually do
  // anything." `pendingByKind` was already the right list; collapsing
  // `grouped` to it makes resolved rails disappear on the next render.
  const pendingByKind = useMemo(() => {
    const out: Record<ProposalKind, ScrapeProposal[]> = {
      insert: [],
      update: [],
      restore_available: [],
      mark_sold_out: [],
    };
    for (const p of proposals) {
      if (p.status === "pending") out[p.change_type].push(p);
    }
    return out;
  }, [proposals]);
  const grouped = pendingByKind;

  if (loading && proposals.length === 0) {
    return (
      <View style={s.emptyBlock}>
        <ActivityIndicator size="small" color={t.color["text.primary"]} />
      </View>
    );
  }
  if (proposals.length === 0) {
    return (
      <View style={s.body}>
        <Text style={s.emptyText}>No staged changes for this run.</Text>
      </View>
    );
  }

  const totalPending = proposals.filter((p) => p.status === "pending").length;

  return (
    <View style={s.body}>
      {totalPending > 0 ? (
        <Text style={s.queueSubtitle}>
          {totalPending} change{totalPending === 1 ? "" : "s"} waiting on you ·
          tap a card's button to apply just that one
        </Text>
      ) : (
        <Text style={s.queueSubtitle}>All changes from this run have been resolved.</Text>
      )}
      {actionError ? (
        <View style={s.actionErrorBanner}>
          <Text style={s.actionErrorText}>{actionError}</Text>
        </View>
      ) : null}
      {PROPOSAL_ORDER.map((kind) => {
        const items = grouped[kind];
        if (items.length === 0) return null;
        const def = PROPOSAL_DEF[kind];
        const pending = pendingByKind[kind];
        const dotColor =
          def.tone === "positive"
            ? t.color["accent.positive"]
            : def.tone === "warn"
            ? t.color["accent.cta"]
            : t.color["text.muted"];
        return (
          <View key={kind} style={s.railWrap}>
            <View style={s.railHead}>
              <View style={[s.railDot, { backgroundColor: dotColor }]} />
              <Text style={s.railTitle}>{def.caption}</Text>
              <Text style={s.railCount}>{items.length}</Text>
              {pending.length > 0 ? (
                <View style={s.bulkBtnRow}>
                  <Pressable
                    onPress={() => reject(pending.map((p) => p.id))}
                    disabled={busyIds.size > 0}
                    style={({ pressed }) => [s.linkBtn, pressed && s.linkBtnPressed]}
                  >
                    <Text style={s.linkBtnText}>Skip all</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => approve(pending.map((p) => p.id))}
                    disabled={busyIds.size > 0}
                    style={({ pressed }) => [
                      s.bulkApprove,
                      busyIds.size > 0 && s.ctaDisabled,
                      pressed && s.ctaPressed,
                    ]}
                  >
                    <Check size={t.size["icon.sm"]} color={t.color["text.on-cta"]} strokeWidth={2} />
                    <Text style={s.bulkApproveText}>
                      {def.actionLabel} all ({pending.length})
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={s.railScrollInner}
            >
              {items.map((p) => (
                <ProposalCard
                  key={p.id}
                  proposal={p}
                  busy={busyIds.has(p.id)}
                  onApprove={() => approve([p.id])}
                  onReject={() => reject([p.id])}
                />
              ))}
            </ScrollView>
          </View>
        );
      })}
    </View>
  );
}

function ProposalCard({
  proposal,
  busy,
  onApprove,
  onReject,
}: {
  proposal: ScrapeProposal;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const s = useStyles();
  const def = PROPOSAL_DEF[proposal.change_type];
  const coffee = proposal.proposed_state || proposal.prev_state || {};
  const status = proposal.status;
  const resolved = status !== "pending";
  const [detailOpen, setDetailOpen] = useState(false);
  const ActionIcon =
    def.actionIcon === "sold-out"
      ? PackageX
      : def.actionIcon === "restore"
      ? RotateCcw
      : def.actionIcon === "refresh"
      ? RefreshCw
      : Check;

  // Long-press → haptic + open the detail modal so the admin can
  // tally which of the ~13 enriched fields actually came back filled
  // for this bean. Tally use case = "did Sonnet manage to extract
  // process_raw / producer / brew_recommendation for this product?"
  const onLongPress = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    setDetailOpen(true);
  };

  // Status badge text — what happened to this proposal.
  let statusText: string | null = null;
  if (status === "applied") statusText = "Applied";
  else if (status === "rejected") statusText = "Skipped";
  else if (status === "reverted") statusText = "Reverted";

  return (
    <View style={s.cardSlot}>
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={350}
        style={({ pressed }) => [pressed && { opacity: 0.85 }]}
        accessibilityLabel={`Long-press to inspect ${(coffee as any).coffee_name || "bean"} fields`}
      >
        <CoffeeCard coffee={coffee} width={370} forceLandscape isOwner={false} />
      </Pressable>
      <Text style={s.cardCaption}>{def.caption}</Text>
      {resolved ? (
        <Text style={[s.cardStatusText, status === "applied" && s.cardStatusApplied]}>
          {statusText}
        </Text>
      ) : (
        <View style={s.cardActionRow}>
          <Pressable
            onPress={onReject}
            disabled={busy}
            style={({ pressed }) => [s.cardSecondaryBtn, pressed && s.iconBtnPressed]}
            accessibilityLabel="Skip this change"
          >
            <X size={14} color={t.color["text.primary"]} strokeWidth={2} />
            <Text style={s.cardSecondaryBtnText}>Skip</Text>
          </Pressable>
          <Pressable
            onPress={onApprove}
            disabled={busy}
            style={({ pressed }) => [
              s.cardPrimaryBtn,
              busy && s.ctaDisabled,
              pressed && s.ctaPressed,
            ]}
            accessibilityLabel={def.actionLabel}
          >
            {busy ? (
              <ActivityIndicator size="small" color={t.color["text.on-cta"]} />
            ) : (
              <ActionIcon size={14} color={t.color["text.on-cta"]} strokeWidth={2} />
            )}
            <Text style={s.cardPrimaryBtnText}>{def.actionLabel}</Text>
          </Pressable>
        </View>
      )}
      <BeanDetailModal
        proposal={proposal}
        visible={detailOpen}
        onClose={() => setDetailOpen(false)}
      />
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  body: {
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.lg,
    gap: t.spacing.lg,
    borderTopWidth: 1,
    borderTopColor: t.color["border.light"],
    backgroundColor: t.color.bg,
  } as any,
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
  queueSubtitle: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
  },
  // Approve / reject failure banner — sits between the queue
  // subtitle and the rails so it's right where the bulk buttons
  // were tapped. Pink-tinted card with prose, dismisses on next
  // action.
  actionErrorBanner: {
    backgroundColor: t.color["card.info"],
    borderWidth: 1,
    borderColor: t.color["accent.cta"],
    borderRadius: t.radius.sm,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
  } as any,
  actionErrorText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["accent.cta"],
    lineHeight: t.lineHeight.relaxed,
  } as any,

  // Per-change-type rail (one rail per kind, horizontal scroll within)
  railWrap: { gap: t.spacing.sm } as any,
  railHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    flexWrap: "wrap",
  },
  railDot: { width: 10, height: 10, borderRadius: 5 } as any,
  railTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
  },
  railCount: {
    fontFamily: t.font.display,
    fontSize: t.size["font.lg"],
    color: t.color["text.primary"],
    fontVariant: ["tabular-nums"],
  } as any,
  railScrollInner: {
    gap: t.spacing.lg,
    paddingVertical: t.spacing.sm,
    paddingRight: t.spacing.lg,
  } as any,

  // Bulk action buttons in the rail head ("Skip all" + "Approve all")
  bulkBtnRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    marginLeft: "auto" as any,
  },
  bulkApprove: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    backgroundColor: t.color.accent,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.full,
  } as any,
  bulkApproveText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.on-cta"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  // Per-card (landscape CoffeeCard at 370 wide + caption + actions)
  cardSlot: { gap: t.spacing.xs, alignItems: "flex-start", width: 370 } as any,
  cardCaption: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.xs"],
    color: t.color["text.secondary"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingTop: t.spacing.xs,
  },
  cardActionRow: {
    flexDirection: "row",
    gap: t.spacing.sm,
    width: "100%" as any,
    paddingTop: t.spacing.xs,
  },
  cardPrimaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xs,
    backgroundColor: t.color.accent,
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.md,
    minHeight: 36,
  } as any,
  cardPrimaryBtnText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.on-cta"],
  },
  cardSecondaryBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: t.spacing.xs,
    backgroundColor: t.color["card.info"],
    paddingVertical: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    borderRadius: t.radius.md,
    minHeight: 36,
  } as any,
  cardSecondaryBtnText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
  },
  cardStatusText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
    paddingTop: t.spacing.xs,
  },
  cardStatusApplied: {
    color: t.color["accent.positive"],
  },

  // Plain-text link-style button (used for "Skip all", etc.)
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

  ctaDisabled: { opacity: 0.5 } as any,
  ctaPressed: {
    backgroundColor: t.color["card.back"],
    transform: [{ scale: 0.97 }],
  } as any,
  iconBtnPressed: { opacity: 0.7 } as any,
}));
