/**
 * Catalog Standardization sub-tab — formerly "MAPPING".
 *
 * One workflow run that maps three roaster-side fields onto Crema
 * canonical references in a single Haiku call:
 *   • tasting tags → SCA flavor tree address
 *   • origin → estate name / Multi-estate / International / Unknown
 *   • varietal → canonical cultivar + species + morphology
 *
 * Reference trees (SCA + Coffee Variety) ship in code — admin inspects
 * via the modal, edits via a code change. No paste-upload flow.
 *
 * Workflow shape mirrors the Roasters & Beans sub-tab:
 *   1. Hero stats row — three task chips with classified / unclassified.
 *   2. Run-CTA + per-task exemplar regen toggles.
 *   3. Reference inspectors (SCA + Variety) as cream-bg cards.
 *   4. Recent runs collapsible (uses the shared JobHistory module).
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
  Eye,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react-native";

import { t, makeStyles } from "../../tokens/useTokens";
import { apiFetchRaw } from "../../api/client";
import { useResource } from "../../resources/useResource";
import { tap as hapticTap, commit as hapticCommit } from "../../utils/haptics";
import type {
  CatalogJob,
  StandardizeStats,
  StandardizeExemplarMap,
  StandardizeTask,
  StandardizeTrees,
} from "../../resources/types";

const ALL_TASKS: StandardizeTask[] = ["tasting", "origin", "varietal", "roast", "process"];
import { JobHistory, JobLogModal } from "./JobHistory";
import FlavorSchemaManager from "./FlavorSchemaManager";

export default function StandardizationPanel() {
  const jobs = useResource<CatalogJob>("jobs", { limit: 50 });
  const s = useStyles();

  const [stats, setStats] = useState<StandardizeStats | null>(null);
  const [statsErr, setStatsErr] = useState<string | null>(null);
  const [exemplars, setExemplars] = useState<StandardizeExemplarMap | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  // Per-task "include in next run" selection. The Run CTA only fires
  // Haiku calls for tasks in this set; admin can toggle each card on
  // / off via the checkbox in its header. Defaults to all five.
  const [includedTasks, setIncludedTasks] = useState<Set<StandardizeTask>>(
    () => new Set<StandardizeTask>(ALL_TASKS),
  );

  // Inspectors (System Prompt + SCA + Variety reference trees). All
  // three load lazily on first open so the panel doesn't pay the JSON-
  // parse / prompt-build cost on mount.
  const [trees, setTrees] = useState<StandardizeTrees | null>(null);
  const [treesLoading, setTreesLoading] = useState(false);
  const [treesErr, setTreesErr] = useState<string | null>(null);
  // Five per-task prompts (the runner issues sequential Haiku calls;
  // each has its own focused prompt). The inspector modal renders all
  // five in one scrollable view, divided by section headers so the
  // admin can see the full surface area of what runs.
  const [prompts, setPrompts] = useState<Record<StandardizeTask, string> | null>(null);
  const [promptMeta, setPromptMeta] = useState<{
    char_counts: Record<StandardizeTask, number>;
    exemplar_counts: Record<StandardizeTask, number>;
  } | null>(null);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptErr, setPromptErr] = useState<string | null>(null);
  const [inspecting, setInspecting] =
    useState<"prompt" | "sca" | "variety" | null>(null);

  // Bottom collapsible — recent standardization runs. Mirrors the
  // "Recent enrichment runs" pattern on Roasters & Beans so the
  // operational diagnostics live below the workflow surface.
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [logModalJob, setLogModalJob] = useState<CatalogJob | null>(null);

  const liveJob = useMemo(
    () => (jobs.data || []).find(
      (j) =>
        j.kind === "standardize" &&
        (j.status === "queued" || j.status === "running"),
    ),
    [jobs.data],
  );

  const refreshStats = async () => {
    try {
      const res: any = await apiFetchRaw("/admin/standardize/stats");
      setStats((res?.data ?? res) as StandardizeStats);
      setStatsErr(null);
    } catch (e: any) {
      setStatsErr(e?.message || "Failed to load stats");
    }
  };

  const refreshExemplars = async () => {
    try {
      const res: any = await apiFetchRaw("/admin/standardize/exemplars");
      setExemplars((res?.data ?? res) as StandardizeExemplarMap);
    } catch {
      // Best-effort; the toggles still work, they just won't show
      // their generated_at timestamp.
    }
  };

  useEffect(() => {
    refreshStats();
    refreshExemplars();
  }, []);

  // Poll while a job is live — stats and exemplar status both move.
  useEffect(() => {
    if (!liveJob) return;
    const id = setInterval(() => {
      jobs.refetch();
      refreshStats();
      refreshExemplars();
    }, 2000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveJob?.id]);

  // Total unclassified across the INCLUDED tasks. Tasks the admin
  // toggled off don't add to the count — the CTA reflects only the
  // work the next run will actually do.
  const totalUnclassified = ALL_TASKS.reduce((sum, task) => {
    if (!includedTasks.has(task)) return sum;
    return sum + (stats?.[task]?.unclassified ?? 0);
  }, 0);

  // "Force resample on next run" — only counts tasks the admin
  // included AND has the regen flag on for. Excluded tasks' regen
  // flags are dormant.
  const anyRegen = ALL_TASKS.some(
    (task) => includedTasks.has(task) && exemplars?.[task]?.regenerate_next,
  );

  const toggleTaskInclusion = (task: StandardizeTask) => {
    hapticTap();
    setIncludedTasks((cur) => {
      const next = new Set(cur);
      if (next.has(task)) next.delete(task);
      else next.add(task);
      return next;
    });
  };

  const runStandardize = async (opts: { force?: boolean } = {}) => {
    hapticCommit();
    setSubmitting(true);
    setSubmitError(null);
    try {
      await apiFetchRaw("/admin/standardize/run", {
        method: "POST",
        body: JSON.stringify({
          regenerate_exemplars: false,
          // Backend treats omitted/empty as "all tasks"; we always send
          // the explicit list so disabled tasks stay off even if state
          // drifts between client and server.
          tasks: ALL_TASKS.filter((task) => includedTasks.has(task)),
          // When the caught-up CTA is used, re-classify every input
          // (overwrites existing rows). Useful after a prompt or
          // schema change.
          force_reclassify: !!opts.force,
        }),
      });
      await jobs.refetch();
    } catch (e: any) {
      setSubmitError(e?.message || "Failed to start standardization");
    } finally {
      setSubmitting(false);
    }
  };

  const toggleRegen = async (task: StandardizeTask) => {
    if (!exemplars) return;
    hapticTap();
    const next = !exemplars[task].regenerate_next;
    // Optimistic update so the checkbox doesn't lag behind the tap.
    setExemplars({
      ...exemplars,
      [task]: { ...exemplars[task], regenerate_next: next },
    });
    try {
      await apiFetchRaw("/admin/standardize/exemplars/regenerate", {
        method: "POST",
        body: JSON.stringify({ task, value: next }),
      });
    } catch {
      // Roll back on failure so the UI matches server state.
      refreshExemplars();
    }
  };

  const openInspector = async (which: "prompt" | "sca" | "variety") => {
    hapticTap();
    setInspecting(which);
    if (which === "prompt") {
      if (prompts) return;
      setPromptLoading(true);
      setPromptErr(null);
      try {
        const res: any = await apiFetchRaw("/admin/standardize/prompt");
        const data = (res?.data ?? res) as {
          prompts: Record<StandardizeTask, string>;
          char_counts: Record<StandardizeTask, number>;
          exemplar_counts: Record<StandardizeTask, number>;
        };
        setPrompts(data.prompts);
        setPromptMeta({
          char_counts: data.char_counts,
          exemplar_counts: data.exemplar_counts,
        });
      } catch (e: any) {
        setPromptErr(e?.message || "Failed to load prompts");
      } finally {
        setPromptLoading(false);
      }
      return;
    }
    if (trees) return;
    setTreesLoading(true);
    setTreesErr(null);
    try {
      const res: any = await apiFetchRaw("/admin/standardize/trees");
      setTrees((res?.data ?? res) as StandardizeTrees);
    } catch (e: any) {
      setTreesErr(e?.message || "Failed to load trees");
    } finally {
      setTreesLoading(false);
    }
  };

  // The button stays clickable even when nothing is unclassified —
  // re-running is valid after a prompt or schema change. Caught-up
  // mode flips the call into force_reclassify mode and relabels.
  const caughtUp = totalUnclassified === 0;
  const ctaDisabled = submitting || !!liveJob || includedTasks.size === 0;
  // Two-line CTA: action label on top, run-mode metadata underneath
  // (regen + how many tasks are included this run).
  const includedCount = includedTasks.size;
  const ctaTopLabel = liveJob
    ? liveJob.status === "queued" ? "Queued…" : "Running…"
    : includedTasks.size === 0
    ? "Select a task"
    : caughtUp
    ? "Re-run all (overwrite)"
    : `Run standardization (${totalUnclassified})`;
  const ctaSubLabel = liveJob || includedTasks.size === 0
    ? null
    : caughtUp
    ? `${includedCount}/${ALL_TASKS.length} tasks · re-classifies every input`
    : `${includedCount}/${ALL_TASKS.length} tasks · ${anyRegen ? "regen exemplars" : "no exemplar regen"}`;
  const ctaA11yLabel = ctaSubLabel
    ? `${ctaTopLabel} · ${ctaSubLabel}`
    : ctaTopLabel;

  return (
    <View style={{ gap: t.spacing.xl }}>
      {/* ── Run-CTA row (top) ──────────────────────────────────────
         Pinned at the top so the primary action is the first thing
         the admin sees. One button press fires up to five sequential
         Haiku calls (tasting → origin → varietal → roast → process)
         depending on which task cards have their include-toggle on.
         Each task's failure is independent of the others. The hint
         paragraph underneath summarises what the run actually does. */}
      <View style={s.ctaRow}>
        <Pressable
          onPress={() => runStandardize({ force: caughtUp })}
          disabled={ctaDisabled}
          style={({ pressed }) => [
            s.cta,
            ctaDisabled && s.ctaDisabled,
            pressed && !ctaDisabled && s.ctaPressed,
          ]}
          accessibilityLabel={ctaA11yLabel}
          accessibilityRole="button"
        >
          {submitting ? (
            <ActivityIndicator size="small" color={t.color["text.on-cta"]} />
          ) : (
            <Sparkles size={t.size["icon.md"]} color={t.color["text.on-cta"]} strokeWidth={2} />
          )}
          <View style={s.ctaTextWrap}>
            <Text style={s.ctaText} numberOfLines={1}>{ctaTopLabel}</Text>
            {ctaSubLabel ? (
              <Text style={s.ctaTextSub} numberOfLines={1}>{ctaSubLabel}</Text>
            ) : null}
          </View>
        </Pressable>
        <View style={s.ctaHint}>
          <Text style={s.ctaHintText}>
            Up to five sequential Haiku calls (tasting → origin →
            varietal → roast → process), one per included task.
            Results write to address tables + the legacy product
            columns; the consumer Discover filter reads canonical
            values directly.
          </Text>
        </View>
      </View>
      {submitError ? <Text style={s.errorText}>{submitError}</Text> : null}

      {/* ── Flavor schema manager ────────────────────────────────
         Single-tier flavor schemas drive the Discover wheel. Multiple
         can coexist; one is active. Upload pastes JSON (validated
         server-side); Activate flips `is_active`. After activation
         the wheel re-shapes immediately but `sca_addresses` may be
         stale until the admin re-runs Standardization Tasting — the
         banner inside the manager surfaces the count and prompts
         the re-run. */}
      <FlavorSchemaManager />

      {/* ── Reference inspectors ──────────────────────────────────
         Pinned at the top so the admin can see the prompt + trees
         BEFORE acting. All three open the same modal pattern, all
         three are read-only — edits land via code commits, not
         paste-uploads. The System Prompt card surfaces the exact
         system message the next Haiku run will receive (with
         currently-cached exemplars + active trees baked in). */}
      <View style={s.inspectRow}>
        <InspectorCard
          title="System Prompt"
          subtitle={
            promptMeta
              ? `${ALL_TASKS.reduce((sum, t) => sum + promptMeta.char_counts[t], 0).toLocaleString()} chars across 5 prompts · ${
                  ALL_TASKS.reduce((sum, t) => sum + promptMeta.exemplar_counts[t], 0)
                } exemplars cached.`
              : "Five per-task prompts Haiku sees on every run — verbatim."
          }
          onPress={() => openInspector("prompt")}
        />
        <InspectorCard
          title="SCA Flavor Tree"
          subtitle="3-tier hierarchy used by the tasting-note classifier."
          onPress={() => openInspector("sca")}
        />
        <InspectorCard
          title="Coffee Variety Tree"
          subtitle="WCR + CCRI varieties + natural mutations. Drives the varietal task."
          onPress={() => openInspector("variety")}
        />
      </View>
      {treesErr ? <Text style={s.errorText}>{treesErr}</Text> : null}
      {promptErr ? <Text style={s.errorText}>{promptErr}</Text> : null}

      {/* ── Three task stat cards ───────────────────────────────────
         One row per task — classified / unclassified at the top, a
         per-task breakdown below (multi-estate · international ·
         unknown for origin; specific · multi-cultivar · morphology
         for varietal). Tasting keeps the original geolocate shape
         since that's the established mental model. */}
      <View style={s.statsRow}>
        <TaskCard
          task="tasting"
          title="TASTING NOTES"
          totalLabel="catalog tags"
          total={stats?.tasting.total}
          classified={stats?.tasting.classified}
          unclassified={stats?.tasting.unclassified}
          breakdown={stats ? [
            ["Mapped to SCA", stats.tasting.geolocated],
            ["Resolved null",
              stats.tasting.classified - stats.tasting.geolocated],
          ] : []}
          regenOn={exemplars?.tasting.regenerate_next}
          regenAt={exemplars?.tasting.generated_at}
          onToggleRegen={() => toggleRegen("tasting")}
          included={includedTasks.has("tasting")}
          onToggleIncluded={() => toggleTaskInclusion("tasting")}
          exemplars={exemplars?.tasting.exemplars ?? []}
        />
        <TaskCard
          task="origin"
          title="ORIGINS"
          totalLabel="distinct origin strings"
          total={stats?.origin.total}
          classified={stats?.origin.classified}
          unclassified={stats?.origin.unclassified}
          breakdown={stats ? [
            ["Specific estate", stats.origin.specific_estate],
            ["Multi-estate",    stats.origin.multi_estate],
            ["International",   stats.origin.international],
            ["Unknown (hidden)", stats.origin.unknown],
          ] : []}
          regenOn={exemplars?.origin.regenerate_next}
          regenAt={exemplars?.origin.generated_at}
          onToggleRegen={() => toggleRegen("origin")}
          included={includedTasks.has("origin")}
          onToggleIncluded={() => toggleTaskInclusion("origin")}
          exemplars={exemplars?.origin.exemplars ?? []}
        />
        <TaskCard
          task="varietal"
          title="VARIETALS"
          totalLabel="distinct varietal strings"
          total={stats?.varietal.total}
          classified={stats?.varietal.classified}
          unclassified={stats?.varietal.unclassified}
          breakdown={stats ? [
            ["Specific varietal", stats.varietal.specific_varietal],
            ["Multi-cultivar",    stats.varietal.multi_cultivar],
            ["With morphology",   stats.varietal.with_morphology],
          ] : []}
          regenOn={exemplars?.varietal.regenerate_next}
          regenAt={exemplars?.varietal.generated_at}
          onToggleRegen={() => toggleRegen("varietal")}
          included={includedTasks.has("varietal")}
          onToggleIncluded={() => toggleTaskInclusion("varietal")}
          exemplars={exemplars?.varietal.exemplars ?? []}
        />
        <TaskCard
          task="roast"
          title="ROAST LEVEL"
          totalLabel="distinct roast strings"
          total={stats?.roast.total}
          classified={stats?.roast.classified}
          unclassified={stats?.roast.unclassified}
          breakdown={stats ? bucketBreakdown(stats.roast.buckets) : []}
          regenOn={exemplars?.roast.regenerate_next}
          regenAt={exemplars?.roast.generated_at}
          onToggleRegen={() => toggleRegen("roast")}
          included={includedTasks.has("roast")}
          onToggleIncluded={() => toggleTaskInclusion("roast")}
          exemplars={exemplars?.roast.exemplars ?? []}
        />
        <TaskCard
          task="process"
          title="PROCESS"
          totalLabel="distinct process strings"
          total={stats?.process.total}
          classified={stats?.process.classified}
          unclassified={stats?.process.unclassified}
          breakdown={stats ? bucketBreakdown(stats.process.buckets) : []}
          regenOn={exemplars?.process.regenerate_next}
          regenAt={exemplars?.process.generated_at}
          onToggleRegen={() => toggleRegen("process")}
          included={includedTasks.has("process")}
          onToggleIncluded={() => toggleTaskInclusion("process")}
          exemplars={exemplars?.process.exemplars ?? []}
        />
      </View>
      {statsErr ? <Text style={s.errorText}>{statsErr}</Text> : null}


      {/* ── Recent runs collapsible ────────────────────────────────
         Mirrors "Recent enrichment runs" on Roasters & Beans. */}
      <Pressable
        onPress={() => {
          hapticTap();
          setHistoryExpanded((v) => !v);
        }}
        style={s.collapsibleHead}
        accessibilityRole="button"
        accessibilityState={{ expanded: historyExpanded }}
      >
        {historyExpanded ? (
          <ChevronDown size={t.size["icon.sm"]} color={t.color["text.muted"]} />
        ) : (
          <ChevronRight size={t.size["icon.sm"]} color={t.color["text.muted"]} />
        )}
        <Text style={s.collapsibleTitle}>Recent standardization runs</Text>
      </Pressable>
      {historyExpanded ? (
        <View>
          <JobHistory
            jobs={(jobs.data || [])
              .filter((j) => j.kind === "standardize" || j.kind === "geolocate")
              .slice(0, 20)}
            loading={jobs.loading}
            onTap={setLogModalJob}
          />
        </View>
      ) : null}

      <JobLogModal job={logModalJob} onClose={() => setLogModalJob(null)} />

      <TreeInspectorModal
        visible={!!inspecting}
        which={inspecting}
        loading={inspecting === "prompt" ? promptLoading : treesLoading}
        trees={trees}
        prompts={prompts}
        promptMeta={promptMeta}
        onClose={() => setInspecting(null)}
      />
    </View>
  );
}

// ── Task card ───────────────────────────────────────────────────────────────

function TaskCard({
  task,
  title,
  totalLabel,
  total,
  classified,
  unclassified,
  breakdown,
  regenOn,
  regenAt,
  onToggleRegen,
  included,
  onToggleIncluded,
  exemplars,
}: {
  task: StandardizeTask;
  title: string;
  totalLabel: string;
  total: number | undefined;
  classified: number | undefined;
  unclassified: number | undefined;
  breakdown: Array<[string, number]>;
  regenOn: boolean | undefined;
  regenAt: string | null | undefined;
  onToggleRegen: () => void;
  // Per-task "include in next run" — when off the card dims and the
  // run skips it. Sits in the card header next to the title so it
  // reads as the primary toggle.
  included: boolean;
  onToggleIncluded: () => void;
  // Cached exemplars for THIS task. Renders inline in a collapsible
  // dropdown so ops can audit what house style Haiku is currently
  // primed with. Empty list = collapsed by default with a "no
  // exemplars cached yet" affordance.
  exemplars: any[];
}) {
  const pct = total && total > 0 ? Math.round(((classified ?? 0) / total) * 100) : 0;
  const [showExemplars, setShowExemplars] = useState(false);
  const s = useStyles();
  return (
    <View style={[s.taskCard, !included && s.taskCardExcluded]}>
      <Pressable
        onPress={onToggleIncluded}
        style={s.taskHeader}
        accessibilityRole="switch"
        accessibilityState={{ checked: included }}
      >
        <View style={[s.includeBox, included && s.includeBoxOn]}>
          {included ? <Text style={s.regenCheck}>{"✓"}</Text> : null}
        </View>
        <Text style={s.taskTitle}>{title}</Text>
      </Pressable>
      <View style={s.taskStatRow}>
        <Text style={s.taskStatBig}>{total ?? "—"}</Text>
        <Text style={s.taskStatLabel}>{totalLabel}</Text>
      </View>
      <View style={s.progressBar}>
        <View style={[s.progressFill, { width: `${pct}%` }]} />
      </View>
      <View style={s.taskStatLine}>
        <Text style={s.taskStatLineText}>
          <Text style={s.taskStatLineNum}>{classified ?? 0}</Text> classified ·{" "}
          <Text style={s.taskStatLineNum}>{unclassified ?? 0}</Text> unclassified
        </Text>
      </View>
      {breakdown.length > 0 ? (
        <View style={s.taskBreakdown}>
          {breakdown.map(([label, n]) => (
            <View key={label} style={s.taskBreakdownRow}>
              <Text style={s.taskBreakdownLabel}>{label}</Text>
              <Text style={s.taskBreakdownNum}>{n}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Pressable
        onPress={onToggleRegen}
        style={s.regenRow}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: !!regenOn }}
      >
        <View style={[s.regenCheckbox, regenOn && s.regenCheckboxOn]}>
          {regenOn ? <Text style={s.regenCheck}>{"✓"}</Text> : null}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.regenLabel}>Regenerate exemplars on next run</Text>
          <Text style={s.regenSub}>
            {regenAt
              ? `Last sampled ${formatRelative(regenAt)}`
              : "Never sampled"}
          </Text>
        </View>
      </Pressable>
      {/* Exemplars dropdown — collapsed by default; tap header to
         expand. Lets ops audit the house-style examples Haiku is
         being primed with for this task on the next run. */}
      <Pressable
        onPress={() => setShowExemplars((v) => !v)}
        style={s.exemplarHead}
        accessibilityRole="button"
        accessibilityState={{ expanded: showExemplars }}
      >
        {showExemplars ? (
          <ChevronDown size={14} color={t.color["text.muted"]} strokeWidth={1.75} />
        ) : (
          <ChevronRight size={14} color={t.color["text.muted"]} strokeWidth={1.75} />
        )}
        <Text style={s.exemplarHeadText}>
          Show exemplars ({exemplars.length})
        </Text>
      </Pressable>
      {showExemplars ? (
        exemplars.length === 0 ? (
          <Text style={s.exemplarEmpty}>
            No exemplars cached yet — they'll seed on the first run.
          </Text>
        ) : (
          <View style={s.exemplarList}>
            {exemplars.map((ex, i) => {
              const { left, right } = formatExemplar(task, ex);
              return (
                <View key={`${left}-${i}`} style={s.exemplarRow}>
                  <Text style={s.exemplarLeft} numberOfLines={1}>{left}</Text>
                  <Text style={s.exemplarArrow}>{"→"}</Text>
                  <Text
                    style={[
                      s.exemplarRight,
                      right === "null" && s.exemplarNullRight,
                    ]}
                    numberOfLines={2}
                  >
                    {right}
                  </Text>
                </View>
              );
            })}
          </View>
        )
      ) : null}
    </View>
  );
}

// Render a single cached exemplar as ("input string", "output string")
// per task. Each task's exemplar shape is different — defined on the
// backend in `services/sca_geolocator.py`'s `select_*_exemplars`. The
// "right" side stays as the literal "null" string when the canonical
// resolution is null so ops can spot when Haiku is being told that
// some flavor / origin / etc. doesn't fit the canonical taxonomy.
function formatExemplar(task: StandardizeTask, ex: any): { left: string; right: string } {
  if (task === "tasting") {
    const addr = ex?.address;
    const right = Array.isArray(addr) && addr.length > 0 ? addr.join(" › ") : "null";
    return { left: String(ex?.tag ?? ""), right };
  }
  if (task === "origin") {
    return {
      left: String(ex?.input ?? ""),
      right: ex?.estate == null ? "null" : String(ex.estate),
    };
  }
  if (task === "varietal") {
    const cv = ex?.canonical_varietal == null ? "null" : String(ex.canonical_varietal);
    const bt = ex?.bean_type == null ? "" : ` · ${ex.bean_type}`;
    const mo = ex?.morphology == null ? "" : ` · ${ex.morphology}`;
    return { left: String(ex?.input ?? ""), right: `${cv}${bt}${mo}` };
  }
  if (task === "roast") {
    return {
      left: String(ex?.input ?? ""),
      right: ex?.roast == null ? "null" : String(ex.roast),
    };
  }
  // process
  return {
    left: String(ex?.input ?? ""),
    right: ex?.process == null ? "null" : String(ex.process),
  };
}

// Top-3 entries from a {bucket: count} dict, descending. Keeps the
// breakdown list tight for roast / process where the canonical bucket
// set is short and we don't want a sparse / cluttered card.
function bucketBreakdown(buckets: Record<string, number> | undefined): Array<[string, number]> {
  if (!buckets) return [];
  return Object.entries(buckets)
    .filter(([k]) => k !== "null")
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([k, n]) => [k, n] as [string, number]);
}

// ── Reference inspector card ────────────────────────────────────────────────

function InspectorCard({
  title,
  subtitle,
  onPress,
}: {
  title: string;
  subtitle: string;
  onPress: () => void;
}) {
  const s = useStyles();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [s.inspectCard, pressed && s.inspectCardPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Inspect ${title}`}
    >
      <View style={s.inspectIconWrap}>
        <Eye size={t.size["icon.md"]} color={t.color["text.primary"]} strokeWidth={1.75} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.inspectTitle}>{title}</Text>
        <Text style={s.inspectSubtitle}>{subtitle}</Text>
      </View>
      <ChevronRight size={t.size["icon.sm"]} color={t.color["text.muted"]} />
    </Pressable>
  );
}

// ── Inspector modal ─────────────────────────────────────────────────────────
//
// Single read-only viewer for any of the three reference items: the
// Haiku system prompt verbatim, the SCA flavor tree, and the Coffee
// Variety tree. JSON content is pretty-printed; the prompt is rendered
// as-is (it's already human-readable plaintext). All three live behind
// the same Eye-icon affordance row at the top of the panel.

function TreeInspectorModal({
  visible,
  which,
  loading,
  trees,
  prompts,
  promptMeta,
  onClose,
}: {
  visible: boolean;
  which: "prompt" | "sca" | "variety" | null;
  loading: boolean;
  trees: StandardizeTrees | null;
  prompts: Record<StandardizeTask, string> | null;
  promptMeta: {
    char_counts: Record<StandardizeTask, number>;
    exemplar_counts: Record<StandardizeTask, number>;
  } | null;
  onClose: () => void;
}) {
  const s = useStyles();
  const title =
    which === "prompt" ? "System Prompts (5)"
    : which === "sca" ? "SCA Flavor Tree"
    : "Coffee Variety Tree";
  const TASK_LABEL: Record<StandardizeTask, string> = {
    tasting: "TASTING PROMPT",
    origin: "ORIGIN PROMPT",
    varietal: "VARIETAL PROMPT",
    roast: "ROAST PROMPT",
    process: "PROCESS PROMPT",
  };
  const subtitle =
    which === "prompt"
      ? promptMeta
        ? `${ALL_TASKS.reduce((sum, t) => sum + promptMeta.char_counts[t], 0).toLocaleString()} chars across 5 prompts · ` +
          ALL_TASKS.map((t) => `${promptMeta.exemplar_counts[t]} ${t}`).join(" · ") +
          ` exemplars. Read-only — edits land via a code commit.`
        : "Read-only — edits land via a code commit."
      : "Read-only. Reference trees ship in code — edits land via a commit, not a paste-upload.";
  const body = useMemo(() => {
    if (which === "prompt") {
      if (!prompts) return "";
      const divider = "═══════════════════════════════════════════════════════════════════════";
      // Concatenate all five with section dividers so the admin can
      // scroll through the full surface area of what runs.
      return ALL_TASKS.map((task, i) =>
        `${divider}\n${TASK_LABEL[task]} (Haiku call ${i + 1}/${ALL_TASKS.length})\n${divider}\n\n${prompts[task]}`
      ).join("\n\n");
    }
    const tree = which === "sca" ? trees?.sca_tree : trees?.variety_tree;
    return tree ? JSON.stringify(tree, null, 2) : "";
  }, [which, prompts, trees]);
  const empty =
    which === "prompt" ? "(no prompts loaded)" : "(no tree loaded)";
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.modalBackdrop}>
        <View style={s.modalCard}>
          <View style={s.modalHead}>
            <Text style={s.modalTitle}>{title}</Text>
            <Pressable onPress={onClose} style={s.modalClose} hitSlop={8}>
              <X size={t.size["icon.md"]} color={t.color["text.primary"]} />
            </Pressable>
          </View>
          <Text style={s.modalSub}>{subtitle}</Text>
          {loading ? (
            <View style={s.modalLoadingWrap}>
              <ActivityIndicator size="small" color={t.color["text.primary"]} />
            </View>
          ) : (
            <ScrollView
              style={s.modalScroll}
              showsVerticalScrollIndicator
              horizontal={false}
            >
              <Text style={s.modalJson} selectable>{body || empty}</Text>
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// ── relative-time helper (small dup to avoid pulling in JobHistory's) ──────

function formatRelative(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const diff = (Date.now() - ms) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── Styles ──────────────────────────────────────────────────────────────────

const useStyles = makeStyles((t) => ({
  // 3-card row, wraps on mobile.
  statsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.md,
  },
  taskCard: {
    flex: 1,
    minWidth: 280,
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    padding: t.spacing.lg,
    gap: t.spacing.sm,
  } as any,
  // Dim the whole card when its include-toggle is off so it reads as
  // "this task won't run on the next click of Run".
  taskCardExcluded: {
    opacity: 0.55,
  } as any,
  // Header row: include checkbox + title in one tappable strip.
  taskHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
  } as any,
  includeBox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: t.color["text.muted"],
    alignItems: "center",
    justifyContent: "center",
  } as any,
  includeBoxOn: {
    backgroundColor: t.color.accent,
    borderColor: t.color.accent,
  } as any,
  taskTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },
  taskStatRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: t.spacing.sm,
  },
  taskStatBig: {
    fontFamily: t.font.display,
    fontSize: t.size["font.display"],
    color: t.color["text.primary"],
    fontVariant: ["tabular-nums"],
  } as any,
  taskStatLabel: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
  },
  progressBar: {
    height: 4,
    backgroundColor: t.color["card.info"],
    borderRadius: 2,
    overflow: "hidden",
  } as any,
  progressFill: {
    height: 4,
    backgroundColor: t.color["text.primary"],
  } as any,
  taskStatLine: {},
  taskStatLineText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
  },
  taskStatLineNum: {
    fontFamily: t.font["body.semibold"],
    color: t.color["text.primary"],
    fontVariant: ["tabular-nums"],
  } as any,
  taskBreakdown: {
    borderTopWidth: 1,
    borderTopColor: t.color["border.light"],
    paddingTop: t.spacing.sm,
    gap: t.spacing.xs,
  } as any,
  taskBreakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  taskBreakdownLabel: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
  },
  taskBreakdownNum: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    fontVariant: ["tabular-nums"],
  } as any,
  // Regen toggle inside each task card.
  regenRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: t.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: t.color["border.light"],
    paddingTop: t.spacing.sm,
  } as any,
  regenCheckbox: {
    width: 18,
    height: 18,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: t.color["text.muted"],
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  } as any,
  regenCheckboxOn: {
    backgroundColor: t.color.accent,
    borderColor: t.color.accent,
  } as any,
  regenCheck: {
    fontSize: 12,
    color: t.color["text.on-cta"],
    fontFamily: t.font["body.semibold"],
  },
  regenLabel: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
  },
  regenSub: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    marginTop: 2,
  },

  // Exemplars dropdown — chevron + label header that toggles a list of
  // input → canonical pairs. Sits at the bottom of each task card so
  // ops can audit what house-style examples Haiku is being primed
  // with on the next run.
  exemplarHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: t.color["border.light"],
    paddingTop: t.spacing.sm,
  } as any,
  exemplarHeadText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  exemplarEmpty: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    fontStyle: "italic",
    paddingTop: 6,
  } as any,
  exemplarList: {
    paddingTop: 6,
    gap: 4,
  } as any,
  exemplarRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
  } as any,
  exemplarLeft: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.xs"],
    color: t.color["text.primary"],
    flexShrink: 1,
    maxWidth: "45%" as any,
  } as any,
  exemplarArrow: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
  },
  exemplarRight: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.secondary"],
    flex: 1,
  } as any,
  exemplarNullRight: {
    color: t.color["text.muted"],
    fontStyle: "italic",
  } as any,

  // Run-CTA row.
  ctaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.lg,
    flexWrap: "wrap",
  },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    backgroundColor: t.color.accent,
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.md,
    borderRadius: t.radius.md,
    minHeight: 56,
    shadowColor: t.color.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    elevation: 2,
    flexShrink: 1,
  } as any,
  ctaDisabled: { opacity: 0.5 } as any,
  ctaPressed: {
    backgroundColor: t.color["card.back"],
    transform: [{ scale: 0.97 }],
  } as any,
  // Two-line text container — the action label sits on top, the regen
  // mode (or nothing, when nothing to run) sits underneath as smaller
  // muted-on-dark text. flexShrink lets the wrapper scale on narrow
  // viewports instead of pushing the button past the screen edge.
  ctaTextWrap: { flexShrink: 1, minWidth: 0 } as any,
  ctaTextSub: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.on-cta"],
    opacity: 0.72,
    marginTop: 2,
    letterSpacing: 0.2,
  } as any,
  ctaText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.on-cta"],
  },
  ctaHint: { flex: 1, minWidth: 240 } as any,
  ctaHintText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
  },

  // Inspector cards row.
  inspectRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.md,
  },
  inspectCard: {
    flex: 1,
    minWidth: 280,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
    backgroundColor: t.color["card.info"],
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.md,
  } as any,
  inspectCardPressed: { opacity: 0.7 } as any,
  inspectIconWrap: {
    width: 36,
    height: 36,
    borderRadius: t.radius.full,
    backgroundColor: t.color.bg,
    alignItems: "center",
    justifyContent: "center",
  } as any,
  inspectTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
  },
  inspectSubtitle: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
    marginTop: 2,
  },

  // Recent-runs collapsible.
  collapsibleHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    paddingVertical: t.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: t.color["border.light"],
    paddingTop: t.spacing.lg,
    marginTop: t.spacing.sm,
  } as any,
  collapsibleTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    textTransform: "uppercase",
    letterSpacing: 0.7,
  },

  // Tree inspector modal.
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "flex-end",
  } as any,
  modalCard: {
    backgroundColor: t.color.bg,
    borderTopLeftRadius: t.radius.lg,
    borderTopRightRadius: t.radius.lg,
    paddingHorizontal: t.spacing.xl,
    paddingTop: t.spacing.lg,
    paddingBottom: t.spacing["2xl"],
    height: "85%",
    gap: t.spacing.sm,
  } as any,
  modalHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    fontFamily: t.font.display,
    fontSize: t.size["font.xl"],
    color: t.color["text.primary"],
  },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: t.radius.full,
    backgroundColor: t.color["card.info"],
    alignItems: "center",
    justifyContent: "center",
  } as any,
  modalSub: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
  },
  modalLoadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  } as any,
  modalScroll: {
    flex: 1,
    backgroundColor: t.color["card.front"],
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: t.color["border.light"],
    padding: t.spacing.md,
    marginTop: t.spacing.sm,
  } as any,
  modalJson: {
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "ui-monospace, monospace",
    }),
    fontSize: t.size["font.xs"],
    color: t.color["text.primary"],
    lineHeight: 18,
  } as any,

  errorText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["accent.cta"],
  },
}));
