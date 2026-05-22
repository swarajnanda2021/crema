/**
 * Catalog Ops · SWEEP ACTIVITY sub-tab.
 *
 * Retrospective + live view of recent roaster-refresh runs. The
 * operator opens this in the morning and sees, in one glance, what
 * the overnight sweep did:
 *
 *   • Top stats row — roasters processed, bios refreshed, products
 *     enriched, articles enriched, proposals held / rejected, total
 *     LLM calls, total wall time, and a live "X runs in flight" pill
 *     when scrapes / article_scrapes are still running.
 *   • Per-roaster list (sorted last_activity_at DESC) — RoasterLogo
 *     identity, status pill, all the per-roaster counters, and a
 *     compact first-error chip when something went sideways. Tap
 *     navigates to the existing /admin/refresh/[slug] page.
 *   • Recent failures section — top N error messages with copy CTA
 *     so the operator can paste a stack trace into a bug tracker.
 *
 * Polling: re-fetch every 30s while the panel is mounted (the parent
 * sub-tab carousel re-mounts on flip, so "mounted" == "active").
 *
 * Read-only — talks to GET /admin/sweep-summary; no writes.
 *
 * Mirrors RefreshCatalogPanel's structural moves: hero strip, top
 * stats row, section header, scrollable list. Every visual value
 * reads from `useTokens` (no inline hex, no magic numbers).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Activity, AlertTriangle, Copy } from "lucide-react-native";
import { useRouter } from "expo-router";

import { t, makeStyles } from "../../tokens/useTokens";
import { apiFetchRaw } from "../../api/client";
import RoasterLogo from "../primitives/RoasterLogo";
import { tap as hapticTap } from "../../utils/haptics";

// ── Wire shape — keep in sync with /admin/sweep-summary in
// routes/specific.py. The endpoint is the canonical source; this is
// the consumer view. Don't fan out — one composite payload, one
// component, one render path.

type SweepRoaster = {
  slug: string;
  name: string | null;
  logo_url: string | null;
  last_activity_at: string | null;
  status: "running" | "succeeded" | "failed" | "partial";
  products_new: number;
  products_updated: number;
  products_missing_to_sold_out: number;
  proposals_auto_approved: number;
  proposals_held: number;
  proposals_rejected: number;
  llm_jobs: number;
  errors_count: number;
  first_error: string | null;
  bio_refreshed: boolean;
  articles_enriched: number;
  products_enriched: number;
};

type SweepFailure = {
  slug: string | null;
  message: string;
  kind: string;
  job_id: number;
  at: string | null;
};

type SweepSummary = {
  since: string;
  now: string;
  totals: {
    roasters_processed: number;
    bios_refreshed: number;
    products_enriched: number;
    articles_enriched: number;
    proposals_auto_approved: number;
    proposals_held_for_review: number;
    proposals_auto_rejected: number;
    llm_calls: number;
    run_time_seconds: number;
    runs_in_flight: number;
  };
  roasters: SweepRoaster[];
  recent_failures: SweepFailure[];
};

const POLL_MS = 30_000;

// Window options the operator can flip between. Default 24h (the
// overnight sweep window). 6h is "just check the latest batch"; 72h
// is "give me the long weekend." More than that and the volume
// would swamp the screen, so we cap there.
type WindowKey = "6h" | "24h" | "72h";
const WINDOW_HOURS: Record<WindowKey, number> = { "6h": 6, "24h": 24, "72h": 72 };
const WINDOW_LABEL: Record<WindowKey, string> = {
  "6h": "Last 6h",
  "24h": "Last 24h",
  "72h": "Last 72h",
};

function sinceFromWindow(win: WindowKey): string {
  const ms = WINDOW_HOURS[win] * 60 * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

function fmtDuration(secs: number): string {
  if (!secs || secs < 1) return "0s";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.round(secs % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtRelative(iso: string | null, now: Date): string {
  if (!iso) return "—";
  const t0 = Date.parse(iso);
  if (!t0) return "—";
  const diff = Math.max(0, now.getTime() - t0);
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// Best-effort copy across web + native. expo-clipboard isn't a
// blocker — if the import fails (older runtimes), we fall back to
// the web Clipboard API and silently no-op on native.
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    // Dynamic import keeps this lazy — most operator sessions never
    // tap the copy button.
    const mod = await import("expo-clipboard");
    if (mod?.setStringAsync) {
      await mod.setStringAsync(text);
      return true;
    }
  } catch {
    // ignore — fall through to web
  }
  try {
    if (typeof navigator !== "undefined" && (navigator as any).clipboard?.writeText) {
      await (navigator as any).clipboard.writeText(text);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export default function SweepActivityPanel() {
  const router = useRouter();
  const s = useStyles();

  const [windowKey, setWindowKey] = useState<WindowKey>("24h");
  const [summary, setSummary] = useState<SweepSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copiedJobId, setCopiedJobId] = useState<number | null>(null);

  const fetchSummary = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const since = sinceFromWindow(windowKey);
      const qs = `?since=${encodeURIComponent(since)}`;
      const resp: any = await apiFetchRaw(`/admin/sweep-summary${qs}`);
      const data = (resp?.data ?? resp) as SweepSummary;
      setSummary(data);
    } catch (e: any) {
      setError(e?.message || "Failed to load sweep summary");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [windowKey]);

  // Initial + on-window-change fetch.
  useEffect(() => {
    fetchSummary(false);
  }, [fetchSummary]);

  // Polling — re-fetch every 30s while the panel is mounted. The
  // parent sub-tab carousel re-mounts panels on flip, so "mounted"
  // is equivalent to "active sub-tab" (see CatalogOps.tsx's note
  // about why we don't keep inactive panels React-alive).
  useEffect(() => {
    const id = setInterval(() => fetchSummary(true), POLL_MS);
    return () => clearInterval(id);
  }, [fetchSummary]);

  const now = useMemo(() => new Date(), [summary]);  // eslint-disable-line react-hooks/exhaustive-deps

  const handleCopy = useCallback(async (failure: SweepFailure) => {
    const text = [
      failure.slug ? `slug=${failure.slug}` : null,
      `kind=${failure.kind}`,
      `job_id=${failure.job_id}`,
      failure.at ? `at=${failure.at}` : null,
      "",
      failure.message,
    ].filter(Boolean).join("\n");
    const ok = await copyToClipboard(text);
    if (ok) {
      hapticTap();
      setCopiedJobId(failure.job_id);
      setTimeout(() => setCopiedJobId((c) => (c === failure.job_id ? null : c)), 1500);
    }
  }, []);

  const handleRoasterTap = useCallback((slug: string) => {
    hapticTap();
    router.push(`/admin/refresh/${slug}` as any);
  }, [router]);

  // ── Render ─────────────────────────────────────────────────────────
  const totals = summary?.totals;
  const inFlight = totals?.runs_in_flight || 0;

  return (
    <View style={s.wrap}>
      {/* Hero strip — mirrors RefreshCatalogPanel.hero, scoped copy. */}
      <View style={s.hero}>
        <View style={s.heroTitleRow}>
          <Text style={s.heroTitle}>Sweep Activity</Text>
          {inFlight > 0 ? (
            <View style={s.livePill} accessibilityLabel={`${inFlight} runs in flight`}>
              <View style={s.livePillDot} />
              <Text style={s.livePillText}>
                {inFlight} run{inFlight === 1 ? "" : "s"} in flight
              </Text>
            </View>
          ) : null}
        </View>
        <Text style={s.heroBlurb}>
          Retrospective + live view of the last roaster-refresh sweep. What
          ran overnight, what landed, what's still in flight, and what
          failed.
        </Text>
        <View style={s.windowRow}>
          {(["6h", "24h", "72h"] as WindowKey[]).map((k) => {
            const active = k === windowKey;
            return (
              <Pressable
                key={k}
                onPress={() => { hapticTap(); setWindowKey(k); }}
                style={({ pressed }) => [
                  s.windowChip,
                  active && s.windowChipActive,
                  pressed && s.windowChipPressed,
                ]}
              >
                <Text style={[s.windowChipText, active && s.windowChipTextActive]}>
                  {WINDOW_LABEL[k]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {/* Top stats row — mirrors TractionDashboard's metric grid feel,
          but scoped to ops counters not consumer metrics. */}
      {totals ? (
        <View style={s.statsGrid}>
          <StatCell label="Roasters" value={totals.roasters_processed} />
          <StatCell label="Bios refreshed" value={totals.bios_refreshed} />
          <StatCell label="Products enriched" value={totals.products_enriched} />
          <StatCell label="Articles enriched" value={totals.articles_enriched} />
          <StatCell label="Proposals approved" value={totals.proposals_auto_approved} />
          <StatCell label="Held for review" value={totals.proposals_held_for_review} />
          <StatCell label="Auto-rejected" value={totals.proposals_auto_rejected} />
          <StatCell label="LLM calls" value={totals.llm_calls} />
          <StatCell label="Wall time" value={fmtDuration(totals.run_time_seconds)} />
        </View>
      ) : null}

      {/* Section header + last-refresh stamp */}
      <View style={s.sectionHeader}>
        <Text style={s.sectionTitle}>Per-roaster</Text>
        {summary?.now ? (
          <Text style={s.lastRefreshed}>
            Updated {fmtRelative(summary.now, now)}
          </Text>
        ) : null}
      </View>

      {error ? (
        <View style={s.errorBlock}>
          <AlertTriangle size={t.size["icon.md"]} color={t.color["text.primary"]} strokeWidth={1.75} />
          <Text style={s.errorText}>{error}</Text>
        </View>
      ) : null}

      {loading && !summary ? (
        <View style={s.emptyBlock}>
          <ActivityIndicator size="small" color={t.color["text.primary"]} />
        </View>
      ) : !summary || summary.roasters.length === 0 ? (
        <Text style={s.emptyText}>No runs yet.</Text>
      ) : (
        <View style={s.rowList}>
          {summary.roasters.map((r, idx) => (
            <RoasterActivityRow
              key={r.slug}
              roaster={r}
              now={now}
              showDivider={idx < summary.roasters.length - 1}
              onPress={() => handleRoasterTap(r.slug)}
            />
          ))}
        </View>
      )}

      {/* Recent failures — surfaces the top N error messages so the
          operator can copy + paste into a tracker. */}
      {summary && summary.recent_failures.length > 0 ? (
        <View style={s.failuresBlock}>
          <Text style={s.sectionTitle}>Recent failures</Text>
          <View style={{ gap: t.spacing.sm }}>
            {summary.recent_failures.map((f) => (
              <View key={`${f.job_id}:${f.slug}:${f.message}`} style={s.failureCard}>
                <View style={s.failureHeader}>
                  <View style={s.failureMeta}>
                    <Text style={s.failureSlug} numberOfLines={1}>
                      {f.slug || "(unscoped)"}
                    </Text>
                    <Text style={s.failureKind}>{f.kind}</Text>
                    {f.at ? (
                      <Text style={s.failureTime}>{fmtRelative(f.at, now)}</Text>
                    ) : null}
                  </View>
                  <Pressable
                    onPress={() => handleCopy(f)}
                    hitSlop={8}
                    style={({ pressed }) => [
                      s.copyBtn,
                      pressed && s.copyBtnPressed,
                    ]}
                    accessibilityLabel="Copy failure"
                  >
                    <Copy
                      size={t.size["icon.sm"]}
                      color={t.color["text.muted"]}
                      strokeWidth={1.75}
                    />
                    <Text style={s.copyBtnText}>
                      {copiedJobId === f.job_id ? "Copied" : "Copy"}
                    </Text>
                  </Pressable>
                </View>
                <Text style={s.failureMessage} numberOfLines={4}>
                  {f.message}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

// ── StatCell — single metric tile ────────────────────────────────────
function StatCell({ label, value }: { label: string; value: number | string }) {
  const s = useStyles();
  return (
    <View style={s.statCell}>
      <Text style={s.statValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={s.statLabel} numberOfLines={2}>
        {label}
      </Text>
    </View>
  );
}

// ── RoasterActivityRow — per-roaster summary, taps to drill in ──────
function RoasterActivityRow({
  roaster,
  now,
  showDivider,
  onPress,
}: {
  roaster: SweepRoaster;
  now: Date;
  showDivider: boolean;
  onPress: () => void;
}) {
  const s = useStyles();
  const meta = [
    roaster.products_new > 0 ? `+${roaster.products_new} new` : null,
    roaster.products_updated > 0 ? `${roaster.products_updated} updated` : null,
    roaster.products_missing_to_sold_out > 0
      ? `${roaster.products_missing_to_sold_out} sold-out`
      : null,
    roaster.bio_refreshed ? "bio refreshed" : null,
  ].filter(Boolean).join(" · ");

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.activityRow,
        showDivider && s.activityRowDivider,
        pressed && s.activityRowPressed,
      ]}
      accessibilityLabel={`Open ${roaster.name || roaster.slug} refresh page`}
    >
      <RoasterLogo
        url={roaster.logo_url}
        size={56}
        fallbackInitial={roaster.name || roaster.slug}
      />
      <View style={s.activityInfo}>
        <View style={s.activityNameRow}>
          <Text style={s.activityName} numberOfLines={1}>
            {roaster.name || roaster.slug}
          </Text>
          <StatusPill status={roaster.status} />
        </View>
        {meta ? (
          <Text style={s.activityMeta} numberOfLines={1}>{meta}</Text>
        ) : null}
        <View style={s.activityCounters}>
          <CounterChip label="LLM" value={roaster.llm_jobs} />
          <CounterChip label="Held" value={roaster.proposals_held} />
          <CounterChip
            label="Rejected"
            value={roaster.proposals_rejected}
            muted
          />
          {roaster.errors_count > 0 ? (
            <CounterChip label="Errors" value={roaster.errors_count} alert />
          ) : null}
        </View>
        {roaster.first_error ? (
          <Text style={s.activityError} numberOfLines={2}>
            {roaster.first_error}
          </Text>
        ) : null}
      </View>
      <View style={s.activityRightCol}>
        <Text style={s.activityTime}>
          {fmtRelative(roaster.last_activity_at, now)}
        </Text>
      </View>
    </Pressable>
  );
}

// ── Status pill — running / succeeded / failed / partial ────────────
function StatusPill({ status }: { status: SweepRoaster["status"] }) {
  const s = useStyles();
  const label =
    status === "running" ? "RUNNING"
    : status === "failed" ? "FAILED"
    : status === "partial" ? "PARTIAL"
    : "OK";
  const variant =
    status === "running" ? s.statusRunning
    : status === "failed" ? s.statusFailed
    : status === "partial" ? s.statusPartial
    : s.statusOk;
  const labelStyle =
    status === "running" ? s.statusTextOnCta
    : status === "failed" ? s.statusTextOnIdentity
    : status === "partial" ? s.statusTextOnLight
    : s.statusTextMuted;
  return (
    <View style={[s.statusPill, variant]}>
      {status === "running" ? <View style={s.runningDot} /> : null}
      <Text style={[s.statusText, labelStyle]}>{label}</Text>
    </View>
  );
}

// ── CounterChip — small numeric chip ────────────────────────────────
function CounterChip({
  label,
  value,
  muted,
  alert,
}: {
  label: string;
  value: number;
  muted?: boolean;
  alert?: boolean;
}) {
  const s = useStyles();
  return (
    <View style={[
      s.counterChip,
      alert && s.counterChipAlert,
      muted && s.counterChipMuted,
    ]}>
      <Text style={[
        s.counterValue,
        alert && s.counterValueAlert,
        muted && s.counterValueMuted,
      ]}>
        {value}
      </Text>
      <Text style={[
        s.counterLabel,
        alert && s.counterLabelAlert,
        muted && s.counterLabelMuted,
      ]}>
        {label}
      </Text>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: { gap: t.spacing.lg } as any,

  // ── Hero strip ───────────────────────────────────────────────────
  hero: {
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    padding: t.spacing.lg,
    gap: t.spacing.sm,
  } as any,
  heroTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.md,
  } as any,
  heroTitle: {
    fontFamily: t.font.display,
    fontSize: t.size["font.2xl"],
    lineHeight: 30,
    color: t.color["text.primary"],
  } as any,
  heroBlurb: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.secondary"],
    lineHeight: 22,
  } as any,
  // Live pill — pulses via the dot, uses the brand pink so it reads
  // as "active engagement state" per the palette §1 rules.
  livePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    backgroundColor: t.color["accent.cta"],
    paddingHorizontal: t.spacing.sm,
    paddingVertical: 4,
    borderRadius: t.radius.full,
  } as any,
  livePillDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: t.color["text.on-cta"],
  } as any,
  livePillText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    letterSpacing: 0.4,
    color: t.color["text.on-cta"],
    textTransform: "uppercase",
  } as any,
  windowRow: {
    flexDirection: "row",
    gap: t.spacing.xs,
    marginTop: t.spacing.sm,
  } as any,
  windowChip: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.xs,
    borderRadius: t.radius.full,
    borderWidth: 1,
    borderColor: t.color["border.light"],
    backgroundColor: t.color.bg,
  } as any,
  windowChipActive: {
    backgroundColor: t.color["text.primary"],
    borderColor: t.color["text.primary"],
  } as any,
  windowChipPressed: { opacity: 0.7 } as any,
  windowChipText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    letterSpacing: 0.5,
    color: t.color["text.primary"],
    textTransform: "uppercase",
  } as any,
  // Active chip bg is `text.primary` (Espresso light / Crema White dark).
  // For correct contrast in both modes, the active text must be the
  // INVERSE of text.primary — which is `bg` (Crema White light / #2a0d00
  // dark), not the constant cream `text.on-dark` that collides with the
  // dark-mode text.primary value.
  windowChipTextActive: { color: t.color.bg } as any,

  // ── Stats grid ───────────────────────────────────────────────────
  // Flex-wrap'd row of metric tiles — each tile sizes to roughly a
  // quarter of the row at wide widths and stacks to half / full on
  // narrow viewports. Matches the TractionDashboard metric-card feel.
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.sm,
  } as any,
  statCell: {
    flexGrow: 1,
    flexBasis: 120,
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.md,
    gap: 2,
  } as any,
  statValue: {
    fontFamily: t.font.display,
    fontSize: t.size["font.xl"],
    lineHeight: 24,
    color: t.color["text.primary"],
  } as any,
  statLabel: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    letterSpacing: 0.4,
    textTransform: "uppercase",
  } as any,

  // ── Section header ───────────────────────────────────────────────
  sectionHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: t.spacing.md,
    marginTop: t.spacing.sm,
  } as any,
  sectionTitle: {
    fontFamily: t.font.display,
    fontSize: t.size["font.2xl"],
    color: t.color["text.primary"],
  } as any,
  lastRefreshed: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
  } as any,

  // ── Error block ─────────────────────────────────────────────────
  errorBlock: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    backgroundColor: t.color["card.info"],
  } as any,
  errorText: {
    flex: 1,
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
  } as any,

  // ── Empty + list ────────────────────────────────────────────────
  emptyBlock: { alignItems: "center", paddingVertical: t.spacing["2xl"] } as any,
  emptyText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.muted"],
    textAlign: "center",
    paddingVertical: t.spacing["2xl"],
  } as any,
  rowList: {
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    overflow: "hidden",
  } as any,

  // ── Per-roaster row ─────────────────────────────────────────────
  activityRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
  } as any,
  activityRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: t.color.divider,
  } as any,
  activityRowPressed: { backgroundColor: t.color.flash } as any,
  activityInfo: { flex: 1, gap: 4 } as any,
  activityNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
  } as any,
  activityName: {
    flexShrink: 1,
    fontFamily: t.font.display,
    fontSize: t.size["font.lg"],
    lineHeight: 22,
    color: t.color["text.primary"],
  } as any,
  activityMeta: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
  } as any,
  activityCounters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xs,
    marginTop: t.spacing.xs,
  } as any,
  activityError: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    marginTop: 4,
    lineHeight: 16,
  } as any,
  activityRightCol: {
    alignItems: "flex-end",
    gap: t.spacing.xs,
    minWidth: 80,
  } as any,
  activityTime: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    textAlign: "right",
  } as any,

  // ── Status pill ─────────────────────────────────────────────────
  statusPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: 2,
    borderRadius: t.radius.full,
  } as any,
  statusText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    letterSpacing: 0.5,
    textTransform: "uppercase",
  } as any,
  // Always-Espresso CTA text (constant token) — paired with the
  // brand-pink `statusRunning` background which is also constant
  // across modes.
  statusTextOnCta: { color: t.color["text.on-cta"] } as any,
  // Mode-inverted text for the `statusFailed` pill — the bg flips
  // Espresso ↔ Crema White via `text.primary`, so the text needs
  // the complementary token (`bg` = Crema White light / `#2a0d00`
  // dark). Reusing `text.on-dark` would silently break in dark mode
  // because `text.on-dark` is constant cream while `text.primary`
  // is also cream in dark — no contrast.
  statusTextOnIdentity: { color: t.color.bg } as any,
  statusTextOnLight: { color: t.color["text.primary"] } as any,
  statusTextMuted: { color: t.color["text.muted"] } as any,
  // OK = quiet beige chip (success is the boring default)
  statusOk: { backgroundColor: t.color["tag.bg"] } as any,
  // Running = brand pink CTA + dot (engagement)
  statusRunning: { backgroundColor: t.color["accent.cta"] } as any,
  runningDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: t.color["text.on-cta"],
  } as any,
  // Failed = Espresso (high-attention, identity-coded). Bg flips
  // with mode (Espresso light / Crema White dark) so the inverted
  // text token below stays legible in both.
  statusFailed: { backgroundColor: t.color["text.primary"] } as any,
  // Partial = beige (same family as OK but readable) — the brand
  // doesn't carry a yellow / orange so we stay within the warm-
  // neutral set per palette §1.
  statusPartial: { backgroundColor: t.color["card.info"] } as any,

  // ── Counter chip ────────────────────────────────────────────────
  counterChip: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: 2,
    borderRadius: t.radius.sm,
    backgroundColor: t.color["tag.bg"],
  } as any,
  counterChipMuted: { opacity: 0.6 } as any,
  // Alert variant — Espresso (light) / Crema White (dark) fill,
  // paired with the inverted `bg` token (Crema White / `#2a0d00`)
  // for guaranteed contrast in both modes. See the rationale on
  // `statusTextOnIdentity` above — `text.on-dark` is constant cream
  // and would vanish on a Crema-White bg in dark mode.
  counterChipAlert: { backgroundColor: t.color["text.primary"] } as any,
  counterValue: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
  } as any,
  counterValueMuted: { color: t.color["text.muted"] } as any,
  counterValueAlert: { color: t.color.bg } as any,
  counterLabel: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    letterSpacing: 0.4,
    textTransform: "uppercase",
  } as any,
  counterLabelMuted: { color: t.color["text.muted"] } as any,
  counterLabelAlert: { color: t.color.bg, opacity: 0.85 } as any,

  // ── Recent failures ─────────────────────────────────────────────
  failuresBlock: { gap: t.spacing.md, marginTop: t.spacing.md } as any,
  failureCard: {
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    padding: t.spacing.md,
    gap: t.spacing.xs,
  } as any,
  failureHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: t.spacing.sm,
  } as any,
  failureMeta: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: t.spacing.sm,
  } as any,
  failureSlug: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
  } as any,
  failureKind: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    backgroundColor: t.color["tag.bg"],
    paddingHorizontal: t.spacing.xs,
    paddingVertical: 2,
    borderRadius: t.radius.sm,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  } as any,
  failureTime: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
  } as any,
  failureMessage: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    lineHeight: 20,
    color: t.color["text.secondary"],
  } as any,
  copyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: 4,
    borderRadius: t.radius.full,
    backgroundColor: t.color["card.info"],
  } as any,
  copyBtnPressed: { opacity: 0.7 } as any,
  copyBtnText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    letterSpacing: 0.4,
    textTransform: "uppercase",
  } as any,
}));
