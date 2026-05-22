/**
 * AgentLogPanel — daily activity journal of autonomous catalog-ops agents.
 *
 * Reads `/admin/agent-summaries`. Each row is ONE agent session — task
 * label, narrative summary, outcome, roasters touched, key counters.
 *
 * Replaces the older SweepActivityPanel which grouped activity by
 * time-window only. The pivot is per the operator's directive
 * (2026-05-20): the unit is the AGENT SESSION, not the hour. Every
 * MCP-protocol use rolls up into one entry the human reads. The
 * system is autonomous, but the human needs to know what happened.
 *
 * Loading + empty states follow DESIGN_LANGUAGE §6 conventions.
 * Token usage only — no inline hex per §1. Dark-mode contrast
 * verified: outcome pills use text.primary bg + bg text (the
 * inverse-flips pair) where bold, tag.bg + text.primary for quiet.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { CheckCircle2, AlertTriangle, XCircle, Ban, Bot } from "lucide-react-native";

import { t, makeStyles } from "../../tokens/useTokens";
import { apiFetchRaw } from "../../api/client";
import { formatRelative } from "./JobHistory";

type Outcome = "success" | "partial" | "failed" | "aborted";

type AgentSummary = {
  id: number;
  agent_identity: string;
  task_label: string;
  prompt_excerpt: string | null;
  summary: string;
  outcome: Outcome | null;
  tool_calls_count: number | null;
  scope_slugs: string[] | null;
  metrics: Record<string, unknown> | null;
  started_at: string | null;
  ended_at: string;
};

type WindowKey = "1d" | "3d" | "7d" | "all";
const WINDOW_HOURS: Record<WindowKey, number | null> = {
  "1d": 24,
  "3d": 72,
  "7d": 168,
  "all": null,
};
const WINDOW_LABEL: Record<WindowKey, string> = {
  "1d": "Past day",
  "3d": "Past 3 days",
  "7d": "Past week",
  "all": "All time",
};

function sinceFromWindow(win: WindowKey): string | null {
  const hours = WINDOW_HOURS[win];
  if (hours == null) return null;
  const d = new Date(Date.now() - hours * 3600 * 1000);
  return d.toISOString().replace(/\.\d{3}/, "");
}

function shortIdentity(id: string): string {
  // Shorten "claude-opus-4-7@anthropic-via-claude-code" → "claude-opus-4-7"
  return id.split("@")[0];
}

export default function AgentLogPanel() {
  const s = useStyles();
  const [windowKey, setWindowKey] = useState<WindowKey>("1d");
  const [rows, setRows] = useState<AgentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchSummaries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const since = sinceFromWindow(windowKey);
      const qs = since
        ? `?since=${encodeURIComponent(since)}&limit=200`
        : `?limit=200`;
      const res: any = await apiFetchRaw(`/admin/agent-summaries${qs}`);
      const data = res?.data ?? res;
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setError(e?.message || "Couldn't load agent log");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [windowKey]);

  useEffect(() => {
    fetchSummaries();
  }, [fetchSummaries]);

  // Aggregate counts for the header — small at-a-glance numbers above
  // the session feed. Empty when no rows.
  const counts = useMemo(() => {
    if (!rows) return null;
    let success = 0, partial = 0, failed = 0, aborted = 0;
    let toolCalls = 0;
    const distinctAgents = new Set<string>();
    const distinctSlugs = new Set<string>();
    for (const r of rows) {
      const o = r.outcome || "success";
      if (o === "success") success++;
      else if (o === "partial") partial++;
      else if (o === "failed") failed++;
      else if (o === "aborted") aborted++;
      if (r.tool_calls_count) toolCalls += r.tool_calls_count;
      if (r.agent_identity) distinctAgents.add(r.agent_identity);
      if (r.scope_slugs) for (const sl of r.scope_slugs) distinctSlugs.add(sl);
    }
    return {
      total: rows.length,
      success, partial, failed, aborted,
      toolCalls,
      agents: distinctAgents.size,
      slugs: distinctSlugs.size,
    };
  }, [rows]);

  return (
    <ScrollView contentContainerStyle={s.scrollInner}>
      {/* Window chips */}
      <View style={s.chipRow}>
        {(["1d", "3d", "7d", "all"] as WindowKey[]).map((k) => {
          const active = k === windowKey;
          return (
            <Pressable
              key={k}
              onPress={() => setWindowKey(k)}
              style={({ pressed }) => [
                s.chip,
                active && s.chipActive,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[s.chipText, active && s.chipTextActive]}>
                {WINDOW_LABEL[k]}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Counts strip */}
      {counts && counts.total > 0 ? (
        <View style={s.countsRow}>
          <CountTile label="Sessions" value={counts.total} />
          <CountTile label="Success" value={counts.success} />
          <CountTile label="Partial" value={counts.partial} dim={counts.partial === 0} />
          <CountTile label="Failed" value={counts.failed} dim={counts.failed === 0} />
          <CountTile label="Tool calls" value={counts.toolCalls} />
          <CountTile label="Agents" value={counts.agents} />
          <CountTile label="Roasters touched" value={counts.slugs} />
        </View>
      ) : null}

      {/* Body */}
      {loading ? (
        <View style={s.loadingBlock}>
          <ActivityIndicator size="small" color={t.color["text.primary"]} />
        </View>
      ) : error ? (
        <Text style={s.errorText}>{error}</Text>
      ) : !rows || rows.length === 0 ? (
        <View style={s.emptyBlock}>
          <Bot size={t.size["icon.lg"]} color={t.color["text.muted"]} strokeWidth={1.5} />
          <Text style={s.emptyText}>
            No agent sessions logged in this window yet.{"\n"}
            Autonomous agents append here on exit via{" "}
            <Text style={s.emptyTextMono}>crema_log_agent_summary</Text>.
          </Text>
        </View>
      ) : (
        <View style={s.feed}>
          {rows.map((r) => (
            <SessionCard key={r.id} row={r} />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

function CountTile({ label, value, dim }: { label: string; value: number; dim?: boolean }) {
  const s = useStyles();
  return (
    <View style={[s.countTile, dim && s.countTileDim]}>
      <Text style={[s.countValue, dim && s.countValueDim]}>{value.toLocaleString()}</Text>
      <Text style={s.countLabel}>{label}</Text>
    </View>
  );
}

function SessionCard({ row }: { row: AgentSummary }) {
  const s = useStyles();
  const outcome = row.outcome || "success";

  const OutcomeIcon =
    outcome === "success" ? CheckCircle2 :
    outcome === "partial" ? AlertTriangle :
    outcome === "aborted" ? Ban :
    XCircle;

  const showSlugs = (row.scope_slugs || []).slice(0, 6);
  const slugsOverflow = (row.scope_slugs?.length || 0) - showSlugs.length;
  const metricKeys = row.metrics ? Object.keys(row.metrics) : [];

  return (
    <View style={s.card}>
      {/* Top row: outcome pill + ended-at + agent identity */}
      <View style={s.cardTop}>
        <View
          style={[
            s.outcomePill,
            outcome === "success" && s.outcomeQuiet,
            outcome === "partial" && s.outcomePartial,
            outcome === "failed" && s.outcomeFailed,
            outcome === "aborted" && s.outcomeAborted,
          ]}
        >
          <OutcomeIcon
            size={t.size["icon.sm"]}
            color={
              outcome === "failed"
                ? t.color.bg                        // inverts with text.primary bg
                : t.color["text.primary"]
            }
            strokeWidth={2}
          />
          <Text
            style={[
              s.outcomeText,
              outcome === "failed" && s.outcomeTextInverse,
            ]}
          >
            {outcome.toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <Text style={s.metaText}>{formatRelative(row.ended_at)}</Text>
      </View>

      {/* Task label */}
      <Text style={s.taskLabel}>{row.task_label}</Text>

      {/* Agent identity, small */}
      <Text style={s.identityLine}>
        <Text style={s.identityLineLabel}>by </Text>
        {shortIdentity(row.agent_identity)}
      </Text>

      {/* Summary narrative */}
      <Text style={s.summaryText}>{row.summary}</Text>

      {/* Counters row */}
      {(row.tool_calls_count || metricKeys.length > 0) ? (
        <View style={s.counterRow}>
          {row.tool_calls_count != null ? (
            <View style={s.counterChip}>
              <Text style={s.counterValue}>{row.tool_calls_count}</Text>
              <Text style={s.counterLabel}>MCP calls</Text>
            </View>
          ) : null}
          {metricKeys.map((k) => {
            const v = row.metrics?.[k];
            if (v == null) return null;
            return (
              <View key={k} style={s.counterChip}>
                <Text style={s.counterValue}>{String(v)}</Text>
                <Text style={s.counterLabel}>{k.replace(/_/g, " ")}</Text>
              </View>
            );
          })}
        </View>
      ) : null}

      {/* Scope slugs as chips */}
      {showSlugs.length > 0 ? (
        <View style={s.slugRow}>
          {showSlugs.map((sl) => (
            <View key={sl} style={s.slugChip}>
              <Text style={s.slugChipText} numberOfLines={1}>
                {sl.length > 28 ? `${sl.slice(0, 26)}…` : sl}
              </Text>
            </View>
          ))}
          {slugsOverflow > 0 ? (
            <View style={s.slugChip}>
              <Text style={s.slugChipText}>+{slugsOverflow} more</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  scrollInner: {
    paddingBottom: t.spacing["3xl"],
    gap: t.spacing.lg,
  } as any,

  // ── Window chips ────────────────────────────────────────────────
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xs,
  } as any,
  chip: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.xs,
    borderRadius: t.radius.full,
    borderWidth: 1,
    borderColor: t.color["border.light"],
    backgroundColor: t.color.bg,
  } as any,
  chipActive: {
    backgroundColor: t.color["text.primary"],
    borderColor: t.color["text.primary"],
  } as any,
  chipText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    letterSpacing: 0.5,
    color: t.color["text.primary"],
    textTransform: "uppercase",
  } as any,
  // Active chip text uses `bg` (inverts opposite to text.primary bg) so
  // it stays legible in BOTH modes. Using text.on-dark (constant cream)
  // would silently break dark mode where text.primary also resolves to
  // cream.
  chipTextActive: { color: t.color.bg } as any,

  // ── Aggregate counts strip ─────────────────────────────────────
  countsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.sm,
  } as any,
  countTile: {
    minWidth: 120,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.color["border.light"],
    backgroundColor: t.color["card.front"],
    gap: 2,
  } as any,
  countTileDim: { opacity: 0.55 } as any,
  countValue: {
    fontFamily: t.font.display,
    fontSize: t.size["font.xl"],
    color: t.color["text.primary"],
    fontVariant: ["tabular-nums"],
  } as any,
  countValueDim: { color: t.color["text.muted"] } as any,
  countLabel: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    letterSpacing: 0.4,
    textTransform: "uppercase",
  } as any,

  // ── Loading / error / empty ────────────────────────────────────
  loadingBlock: {
    alignItems: "center",
    paddingVertical: t.spacing["3xl"],
  } as any,
  errorText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
  } as any,
  emptyBlock: {
    alignItems: "center",
    paddingVertical: t.spacing["3xl"],
    gap: t.spacing.sm,
  } as any,
  emptyText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.muted"],
    textAlign: "center",
    lineHeight: 22,
  } as any,
  emptyTextMono: {
    fontFamily: t.font["body.semibold"],
    color: t.color["text.secondary"],
  } as any,

  // ── Feed ────────────────────────────────────────────────────────
  feed: { gap: t.spacing.md } as any,
  card: {
    padding: t.spacing.lg,
    borderRadius: t.radius.lg,
    borderWidth: 1,
    borderColor: t.color["border.light"],
    backgroundColor: t.color["card.front"],
    gap: t.spacing.sm,
  } as any,
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
  } as any,
  metaText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
  } as any,

  // Outcome pill — small badge at top-left of each session card.
  // Color rules:
  //  • success: tag.bg (quiet beige in light / translucent cream in
  //    dark) — success is the boring default.
  //  • partial: card.info (warm cream in light, identity-band dark
  //    in dark — readable in both).
  //  • failed: text.primary bg (Espresso ↔ Crema White flip) with
  //    inverted text via `bg` token — high-attention identity-coded.
  //  • aborted: tag.bg with muted text — like success but neutral
  //    rather than positive.
  outcomePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: 4,
    borderRadius: t.radius.full,
  } as any,
  outcomeQuiet: { backgroundColor: t.color["tag.bg"] } as any,
  outcomePartial: { backgroundColor: t.color["card.info"] } as any,
  outcomeFailed: { backgroundColor: t.color["text.primary"] } as any,
  outcomeAborted: { backgroundColor: t.color["tag.bg"] } as any,
  outcomeText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    letterSpacing: 0.5,
    color: t.color["text.primary"],
    textTransform: "uppercase",
  } as any,
  outcomeTextInverse: { color: t.color.bg } as any,

  // Task label — the agent's free-text description of what it did.
  // Display font, lg size — this is the headline of each card.
  taskLabel: {
    fontFamily: t.font.display,
    fontSize: t.size["font.lg"],
    color: t.color["text.primary"],
    lineHeight: 22,
  } as any,
  identityLine: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.secondary"],
    letterSpacing: 0.3,
  } as any,
  identityLineLabel: {
    fontFamily: t.font["body.regular"],
    color: t.color["text.muted"],
    fontWeight: "normal" as const,
  } as any,
  summaryText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
    lineHeight: 20,
  } as any,

  // ── Counter chips (MCP-calls + per-metric counters) ───────────
  counterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xs,
  } as any,
  counterChip: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: 4,
    borderRadius: t.radius.md,
    backgroundColor: t.color["card.info"],
  } as any,
  counterValue: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    fontVariant: ["tabular-nums"],
  } as any,
  counterLabel: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.secondary"],
  } as any,

  // ── Scope-slugs chip row ───────────────────────────────────────
  slugRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xs,
  } as any,
  slugChip: {
    paddingHorizontal: t.spacing.sm,
    paddingVertical: 3,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color["border.light"],
    backgroundColor: t.color["tag.bg"],
  } as any,
  slugChipText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.secondary"],
    maxWidth: 240,
  } as any,
}));
