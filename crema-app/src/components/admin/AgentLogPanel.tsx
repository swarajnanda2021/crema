/**
 * AgentLogPanel — journal-style activity feed of catalog-ops orchestrators.
 *
 * Reads `/admin/agent-summaries`. Each row is one orchestrator session
 * written as a journal entry: short noun-phrase TITLE, 1-3 sentence
 * EXCERPT shown on the card, optional long-form `body_html` that
 * expands into a journal-style reader on click. Voice: plain English,
 * colleague-briefing — never a technical log dump (per
 * AGENTIC_UTOPIA.md).
 *
 * Visual model mirrors the consumer JOURNAL: meta row · title ·
 * byline · excerpt · hairline divider. No card chrome on the row
 * itself. Click → floating reader modal that renders body_html via
 * the same `htmlToBlocks` walker the article reader uses.
 *
 * Window chips (1d / 3d / 7d / all) + aggregate-counts strip stay
 * above the feed — these are admin-only affordances not present in
 * the consumer JOURNAL.
 *
 * Token-only per DESIGN_LANGUAGE §1. Light + dark handled by token
 * resolution; outcome colors keep the same identity-flip pattern as
 * the prior SessionCard but compressed into a smaller meta-row tag.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Modal,
  useWindowDimensions,
  Linking,
} from "react-native";
import {
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Ban,
  Bot,
  X as XIcon,
  ChevronDown,
  ChevronUp,
  BrainCircuit,
} from "lucide-react-native";

import { t, makeStyles } from "../../tokens/useTokens";
import { apiFetchRaw } from "../../api/client";
import { formatRelative } from "./JobHistory";
import { htmlToBlocks, type Block, type Run } from "../../utils/htmlToBlocks";

type Outcome = "success" | "partial" | "failed" | "aborted";

type AgentSummary = {
  id: number;
  agent_identity: string;
  task_label: string;
  prompt_excerpt: string | null;
  summary: string;
  body_html: string | null;
  outcome: Outcome | null;
  tool_calls_count: number | null;
  scope_slugs: string[] | null;
  metrics: Record<string, unknown> | null;
  started_at: string | null;
  ended_at: string;
};

type AgentMemory = {
  id: number;
  scope: string;
  lesson: string;
  tags: string[];
  source_session_id: string | null;
  source_summary_id: number | null;
  created_at: string;
  last_referenced_at: string | null;
  reference_count: number;
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
  return id.split("@")[0];
}

function outcomeLabel(o: Outcome | null): string {
  return (o || "success").toUpperCase();
}

export default function AgentLogPanel() {
  const s = useStyles();
  const [windowKey, setWindowKey] = useState<WindowKey>("1d");
  const [rows, setRows] = useState<AgentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [openEntry, setOpenEntry] = useState<AgentSummary | null>(null);

  // Memory section — durable lessons across sessions. Refreshed
  // every time the panel opens; sits at the very top as
  // orientation for any new orchestrator. Per the directive: this
  // acts as a system prompt for catalog-ops agent runs.
  const [memory, setMemory] = useState<AgentMemory[] | null>(null);
  const fetchMemory = useCallback(async () => {
    try {
      const res: any = await apiFetchRaw(`/admin/agent-memory?limit=200`);
      const data = res?.data ?? res;
      setMemory(Array.isArray(data) ? data : []);
    } catch {
      setMemory([]);
    }
  }, []);
  useEffect(() => {
    fetchMemory();
  }, [fetchMemory]);

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
    <>
      <ScrollView contentContainerStyle={s.scrollInner}>
        {/* Memory section — orientation block for new orchestrators */}
        <MemorySection memory={memory} />

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

        {/* Feed body */}
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
              Orchestrators append here on exit via{" "}
              <Text style={s.emptyTextMono}>crema_log_agent_summary</Text>.
            </Text>
          </View>
        ) : (
          <View style={s.feed}>
            {rows.map((r, idx) => (
              <AgentJournalRow
                key={r.id}
                row={r}
                showDivider={idx < rows.length - 1}
                onOpen={() => setOpenEntry(r)}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {openEntry ? (
        <AgentJournalReaderModal
          entry={openEntry}
          onClose={() => setOpenEntry(null)}
        />
      ) : null}
    </>
  );
}

// ── Memory section: orientation block at top of the panel ─────────────────

const SCOPE_LABEL: Record<string, string> = {
  "catalog-ops-v2": "v2 architecture",
  "drainer-discipline": "Drainer ops",
  "filter-design": "Filter design",
  "dev-discipline": "Don't break in-flight runs",
  "voice-discipline": "Journal voice",
};

function MemorySection({ memory }: { memory: AgentMemory[] | null }) {
  const s = useStyles();
  const [open, setOpen] = useState(true);

  const grouped = useMemo(() => {
    if (!memory) return null;
    const byScope: Record<string, AgentMemory[]> = {};
    for (const m of memory) {
      const scope = m.scope || "general";
      (byScope[scope] = byScope[scope] || []).push(m);
    }
    return byScope;
  }, [memory]);

  if (!memory) return null;

  const total = memory.length;
  const scopes = grouped ? Object.keys(grouped).sort() : [];

  return (
    <View style={s.memoryWrap}>
      {/* Header — mirrors the editorial meta row pattern */}
      <Pressable
        onPress={() => setOpen((v) => !v)}
        style={({ pressed }) => [s.memoryHeader, pressed && { opacity: 0.7 }]}
      >
        <View style={s.memoryHeaderText}>
          <Text style={s.memoryTag}>MEMORY</Text>
          <Text style={s.memoryTitle}>Catalog-ops memory</Text>
          <Text style={s.memorySubtitle}>
            {total > 0
              ? `${total} lesson${total === 1 ? "" : "s"} across ${scopes.length} area${scopes.length === 1 ? "" : "s"} — read before any catalog-ops session`
              : "What every orchestrator should know. Empty for now — seed via crema_log_agent_memory."}
          </Text>
        </View>
        {open ? (
          <ChevronUp size={t.size["icon.sm"]} color={t.color["text.muted"]} strokeWidth={2} />
        ) : (
          <ChevronDown size={t.size["icon.sm"]} color={t.color["text.muted"]} strokeWidth={2} />
        )}
      </Pressable>

      {/* Body — editorial scopes + bullets, no chips */}
      {open && total > 0 ? (
        <View style={s.memoryBody}>
          {scopes.map((scope) => (
            <View key={scope} style={s.memoryScopeBlock}>
              <Text style={s.memoryScopeLabel}>
                {SCOPE_LABEL[scope] || scope}
              </Text>
              {grouped![scope].map((m) => (
                <View key={m.id} style={s.memoryLessonRow}>
                  <Text style={s.memoryBullet}>—</Text>
                  <Text style={s.memoryLesson}>{m.lesson}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null}

      {/* Hairline divider before the journal feed begins */}
      <View style={s.memoryDivider} />
    </View>
  );
}

// ── Row: editorial layout mirroring ArticleListRow ──────────────────────────

function AgentJournalRow({
  row,
  showDivider,
  onOpen,
}: {
  row: AgentSummary;
  showDivider: boolean;
  onOpen: () => void;
}) {
  const s = useStyles();
  const outcome = (row.outcome || "success") as Outcome;
  const slugCount = row.scope_slugs?.length || 0;
  const dateLabel = formatRelative(row.ended_at);
  // The journal row keeps closing meta minimal — single muted line
  // mirroring the consumer "N min read" pattern. Counters go in
  // here when relevant; the click affordance is the row itself.
  const closingBits: string[] = [];
  if (row.tool_calls_count != null) {
    closingBits.push(
      `${row.tool_calls_count} MCP call${row.tool_calls_count === 1 ? "" : "s"}`,
    );
  }
  if (slugCount > 0) {
    closingBits.push(`${slugCount} roaster${slugCount === 1 ? "" : "s"}`);
  }
  const closingLine = closingBits.join(" · ");

  return (
    <View style={s.row}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="link"
        accessibilityLabel={`Open agent log: ${row.task_label}`}
      >
        {/* Meta row: outcome label · relative date (plain text, no pills) */}
        <View style={s.metaRow}>
          <Text style={s.tag}>{outcomeLabel(outcome)}</Text>
          <Text style={s.date}>{dateLabel}</Text>
        </View>

        {/* Title — display font, 3-line clamp, mirrors ArticleListRow */}
        <Text style={s.title} numberOfLines={3}>
          {row.task_label}
        </Text>

        {/* Byline — "By {agent_identity}" mirrors "By {roaster_name}" */}
        {row.agent_identity ? (
          <Text style={s.byline} numberOfLines={1}>
            By {shortIdentity(row.agent_identity)}
          </Text>
        ) : null}

        {/* Excerpt — full text, no clamp */}
        {row.summary ? (
          <Text style={s.excerpt}>{row.summary}</Text>
        ) : null}

        {/* Closing meta — single muted line like "N min read" */}
        {closingLine ? (
          <Text style={s.readingTime}>{closingLine}</Text>
        ) : null}
      </Pressable>

      {showDivider ? <View style={s.divider} /> : null}
    </View>
  );
}

// ── Reader modal: journal-style expansion ───────────────────────────────────

function AgentJournalReaderModal({
  entry,
  onClose,
}: {
  entry: AgentSummary;
  onClose: () => void;
}) {
  const s = useStyles();
  const { height: vh } = useWindowDimensions();
  const outcome = (entry.outcome || "success") as Outcome;
  const blocks = useMemo<Block[]>(
    () => (entry.body_html ? htmlToBlocks(entry.body_html) : []),
    [entry.body_html],
  );
  const metricKeys = entry.metrics ? Object.keys(entry.metrics) : [];

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable
          style={[s.modalCard, { maxHeight: vh * 0.86 }]}
          onPress={(e) => e.stopPropagation?.()}
        >
          <View style={s.modalHeader}>
            <View style={s.modalMetaRow}>
              <Text style={s.tag}>{outcomeLabel(outcome)}</Text>
              <Text style={s.date}>{formatRelative(entry.ended_at)}</Text>
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              accessibilityLabel="Close entry"
              style={({ pressed }) => [s.closeBtn, pressed && { opacity: 0.6 }]}
            >
              <XIcon size={t.size["icon.md"]} color={t.color["text.primary"]} strokeWidth={1.8} />
            </Pressable>
          </View>

          <ScrollView
            contentContainerStyle={s.modalScroll}
            style={{ flexGrow: 0 }}
          >
            <Text style={s.modalTitle}>{entry.task_label}</Text>
            <Text style={s.modalByline}>
              by {shortIdentity(entry.agent_identity)}
            </Text>

            {entry.summary ? (
              <Text style={s.modalExcerpt}>{entry.summary}</Text>
            ) : null}

            {/* Roaster chips */}
            {entry.scope_slugs && entry.scope_slugs.length > 0 ? (
              <View style={s.scopeRow}>
                {entry.scope_slugs.map((sl) => (
                  <View key={sl} style={s.scopeChip}>
                    <Text style={s.scopeChipText} numberOfLines={1}>
                      {sl}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* Body */}
            {blocks.length > 0 ? (
              <View style={s.bodyWrap}>
                {blocks.map((b, i) => (
                  <BlockView key={i} block={b} />
                ))}
              </View>
            ) : (
              <Text style={s.bodyEmpty}>
                {entry.body_html
                  ? "(body present but couldn't be rendered)"
                  : "(no long-form body — see the excerpt above)"}
              </Text>
            )}

            {/* Metrics + tool-call meta */}
            {(entry.tool_calls_count != null || metricKeys.length > 0) ? (
              <View style={s.metricsBlock}>
                <Text style={s.metricsHeading}>Run metrics</Text>
                <View style={s.metricsList}>
                  {entry.tool_calls_count != null ? (
                    <MetricRow label="MCP tool calls" value={entry.tool_calls_count} />
                  ) : null}
                  {metricKeys.map((k) => (
                    <MetricRow
                      key={k}
                      label={k.replace(/_/g, " ")}
                      value={String(entry.metrics?.[k] ?? "")}
                    />
                  ))}
                </View>
              </View>
            ) : null}

            {/* Prompt excerpt (collapsed presentation) */}
            {entry.prompt_excerpt ? (
              <View style={s.promptBlock}>
                <Text style={s.metricsHeading}>Prompt excerpt</Text>
                <Text style={s.promptText}>{entry.prompt_excerpt}</Text>
              </View>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function MetricRow({ label, value }: { label: string; value: string | number }) {
  const s = useStyles();
  return (
    <View style={s.metricRow}>
      <Text style={s.metricLabel}>{label}</Text>
      <Text style={s.metricValue}>{value}</Text>
    </View>
  );
}

// ── Block renderer (subset — agent entries use paragraph/heading/list/quote) ─

function BlockView({ block }: { block: Block }) {
  const s = useStyles();
  switch (block.kind) {
    case "heading": {
      const isH2 = block.level <= 2;
      return (
        <Text style={isH2 ? s.bodyH2 : s.bodyH3}>
          {renderRuns(block.runs)}
        </Text>
      );
    }
    case "paragraph":
      return <Text style={s.bodyP}>{renderRuns(block.runs)}</Text>;
    case "quote":
      return (
        <View style={s.bodyQuote}>
          <Text style={s.bodyQuoteText}>{renderRuns(block.runs)}</Text>
        </View>
      );
    case "list":
      return (
        <View style={s.bodyList}>
          {block.items.map((runs, i) => (
            <View key={i} style={s.bodyListItem}>
              <Text style={s.bodyListBullet}>
                {block.ordered ? `${i + 1}.` : "•"}
              </Text>
              <Text style={s.bodyListText}>{renderRuns(runs)}</Text>
            </View>
          ))}
        </View>
      );
    case "image":
    case "video":
    case "adslot":
      // Agent entries don't use these. Skip silently.
      return null;
    default:
      return null;
  }
}

function renderRuns(runs: Run[]) {
  return runs.map((r, i) => {
    const baseStyle: any = {
      fontFamily: r.bold ? t.font["body.semibold"] : t.font["body.regular"],
      fontStyle: r.italic ? "italic" : "normal",
    };
    if (r.href) {
      return (
        <Text
          key={i}
          style={[baseStyle, { color: t.color["accent.cta"], textDecorationLine: "underline" }]}
          onPress={() => Linking.openURL(r.href!).catch(() => {})}
        >
          {r.text}
        </Text>
      );
    }
    return (
      <Text key={i} style={baseStyle}>
        {r.text}
      </Text>
    );
  });
}

// ── Aggregate-counts tile (unchanged from prior version) ────────────────────

function CountTile({ label, value, dim }: { label: string; value: number; dim?: boolean }) {
  const s = useStyles();
  return (
    <View style={[s.countTile, dim && s.countTileDim]}>
      <Text style={[s.countValue, dim && s.countValueDim]}>{value.toLocaleString()}</Text>
      <Text style={s.countLabel}>{label}</Text>
    </View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles((t) => ({
  scrollInner: {
    paddingBottom: t.spacing["3xl"],
    gap: t.spacing.lg,
  } as any,

  // Window chips
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: t.spacing.xs } as any,
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
  chipTextActive: { color: t.color.bg } as any,

  // Aggregate counts strip
  countsRow: { flexDirection: "row", flexWrap: "wrap", gap: t.spacing.sm } as any,
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

  // Loading / error / empty
  loadingBlock: { alignItems: "center", paddingVertical: t.spacing["3xl"] } as any,
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

  // Feed — no gap; each row owns its top padding + bottom divider
  feed: { gap: 0 } as any,

  // Row — mirrors ArticleListRow.wrap (paddingHorizontal lg, paddingTop lg)
  row: {
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.lg,
  } as any,

  // Meta row — outcome tag · date, no glyph separator (matches journal)
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
    marginBottom: t.spacing.sm,
    flexWrap: "wrap",
  } as any,
  tag: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    letterSpacing: 0.2,
  } as any,
  date: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    letterSpacing: 0.2,
  } as any,

  // Title — display font xl, 3-line clamp (matches ArticleListRow.title)
  title: {
    fontFamily: t.font.display,
    fontSize: t.size["font.xl"],
    lineHeight: 24,
    color: t.color["text.primary"],
  } as any,

  // Byline — "By {agent_identity}" (matches ArticleListRow.byline)
  byline: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
    marginTop: t.spacing.sm,
  } as any,

  // Excerpt — full text, no clamp (matches ArticleListRow.excerpt)
  excerpt: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    lineHeight: 22,
    color: t.color["text.primary"],
    marginTop: t.spacing.md,
  } as any,

  // Closing meta — single muted line (matches ArticleListRow.readingTime)
  readingTime: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    marginTop: t.spacing.md,
    letterSpacing: 0.2,
  } as any,

  // Hairline divider (full-row span via negative margin)
  divider: {
    height: 1,
    backgroundColor: t.color.divider,
    marginTop: t.spacing.lg,
    marginHorizontal: -t.spacing.lg,
  } as any,

  // ── Reader modal ──────────────────────────────────────────────────
  backdrop: {
    flex: 1,
    backgroundColor: t.color.overlay,
    alignItems: "center",
    justifyContent: "center",
    padding: t.spacing.lg,
  } as any,
  modalCard: {
    width: "100%",
    maxWidth: 720,
    backgroundColor: t.color["card.front"],
    borderRadius: t.radius.xl,
    borderWidth: 1,
    borderColor: t.color["border.light"],
    overflow: "hidden",
  } as any,
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.lg,
    paddingBottom: t.spacing.sm,
  } as any,
  modalMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    flex: 1,
    flexWrap: "wrap",
  } as any,
  closeBtn: {
    padding: t.spacing.xs,
    marginRight: -t.spacing.xs,
  } as any,
  modalScroll: {
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.sm,
    paddingBottom: t.spacing["2xl"],
    gap: t.spacing.md,
  } as any,
  modalTitle: {
    fontFamily: t.font.display,
    fontSize: t.size["font.2xl"],
    lineHeight: 32,
    color: t.color["text.primary"],
  } as any,
  modalByline: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
    marginTop: -t.spacing.xs,
  } as any,
  modalExcerpt: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    lineHeight: 22,
    color: t.color["text.primary"],
    fontStyle: "italic",
    marginTop: t.spacing.xs,
  } as any,

  // Scope (roaster) chips
  scopeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xs,
    marginTop: t.spacing.sm,
  } as any,
  scopeChip: {
    paddingHorizontal: t.spacing.sm,
    paddingVertical: 4,
    borderRadius: t.radius.md,
    borderWidth: 1,
    borderColor: t.color["border.light"],
    backgroundColor: t.color["tag.bg"],
  } as any,
  scopeChipText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.secondary"],
    maxWidth: 280,
  } as any,

  // Body block rendering
  bodyWrap: {
    gap: t.spacing.md,
    marginTop: t.spacing.md,
  } as any,
  bodyEmpty: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    fontStyle: "italic",
    marginTop: t.spacing.md,
  } as any,
  bodyH2: {
    fontFamily: t.font.display,
    fontSize: t.size["font.xl"],
    lineHeight: 26,
    color: t.color["text.primary"],
    marginTop: t.spacing.md,
  } as any,
  bodyH3: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.lg"],
    lineHeight: 22,
    color: t.color["text.primary"],
    marginTop: t.spacing.sm,
  } as any,
  bodyP: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    lineHeight: 22,
    color: t.color["text.primary"],
  } as any,
  bodyQuote: {
    borderLeftWidth: 3,
    borderLeftColor: t.color["accent.cta"],
    paddingLeft: t.spacing.md,
    paddingVertical: t.spacing.xs,
  } as any,
  bodyQuoteText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    lineHeight: 22,
    color: t.color["text.secondary"],
    fontStyle: "italic",
  } as any,
  bodyList: { gap: t.spacing.xs } as any,
  bodyListItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.sm,
  } as any,
  bodyListBullet: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    lineHeight: 22,
    color: t.color["text.secondary"],
    minWidth: 18,
  } as any,
  bodyListText: {
    flex: 1,
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    lineHeight: 22,
    color: t.color["text.primary"],
  } as any,

  // Metrics block
  metricsBlock: { gap: t.spacing.xs, marginTop: t.spacing.lg } as any,
  metricsHeading: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    letterSpacing: 0.5,
    color: t.color["text.muted"],
    textTransform: "uppercase",
  } as any,
  metricsList: { gap: 2 } as any,
  metricRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
  } as any,
  metricLabel: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
    textTransform: "capitalize",
  } as any,
  metricValue: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    fontVariant: ["tabular-nums"],
  } as any,

  // Prompt excerpt block
  promptBlock: { gap: t.spacing.xs, marginTop: t.spacing.lg } as any,
  promptText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    lineHeight: 20,
    color: t.color["text.secondary"],
    fontStyle: "italic",
  } as any,

  // ── Memory section — editorial, no card chrome ────────────────────
  memoryWrap: {
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.lg,
  } as any,
  memoryHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.md,
  } as any,
  memoryHeaderText: {
    flex: 1,
    gap: 2,
  } as any,
  // Same treatment as the row's "tag" — small uppercase muted label,
  // mirrors the consumer journal's topic label.
  memoryTag: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    letterSpacing: 0.5,
    textTransform: "uppercase",
    marginBottom: t.spacing.xs,
  } as any,
  memoryTitle: {
    fontFamily: t.font.display,
    fontSize: t.size["font.xl"],
    lineHeight: 24,
    color: t.color["text.primary"],
  } as any,
  memorySubtitle: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    lineHeight: 22,
    color: t.color["text.secondary"],
    marginTop: t.spacing.xs,
  } as any,
  memoryBody: {
    marginTop: t.spacing.lg,
    gap: t.spacing.lg,
  } as any,
  memoryScopeBlock: { gap: t.spacing.xs } as any,
  memoryScopeLabel: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    letterSpacing: 0.5,
    color: t.color["text.muted"],
    textTransform: "uppercase",
    marginBottom: t.spacing.xs,
  } as any,
  memoryLessonRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.sm,
  } as any,
  memoryBullet: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.muted"],
    lineHeight: 22,
    minWidth: 14,
  } as any,
  memoryLesson: {
    flex: 1,
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    lineHeight: 22,
    color: t.color["text.primary"],
  } as any,
  // Hairline that ends the memory section before the journal feed
  memoryDivider: {
    height: 1,
    backgroundColor: t.color.divider,
    marginTop: t.spacing.lg,
    marginHorizontal: -t.spacing.lg,
  } as any,
}));
