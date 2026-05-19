/**
 * /admin/refresh/[slug] — diff-based catalog refresh for one roaster.
 *
 * Companion to /admin/roaster/[slug]. The roaster page is the
 * onboarding / full-re-baseline surface; this page is the lean
 * maintenance surface: hit the website once, compare hashes, only
 * re-enrich entities whose identity changed.
 *
 * Three site-quirk hints live on the roaster — each one is read by
 * the relevant LLM call when the agent step runs:
 *   - bio    (`enrichment_prompt_hint`) — Sonnet bio + bean enricher
 *   - journal (`article_enrichment_prompt_hint`) — Haiku article enricher
 *   - diff   (`diff_prompt_hint`) — Haiku diff interpretation, this tab
 *
 * Per the architecture, refresh is one continuous agentic operation —
 * crawl, diff, enrich what changed. No manual orchestrator hop.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  ScrollView,
  TextInput,
} from "react-native";
import { ArrowLeft, ExternalLink, Lock } from "lucide-react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";

import { t, makeStyles } from "../../../src/tokens/useTokens";
import { apiFetchRaw } from "../../../src/api/client";
import { useBreakpoint } from "../../../src/hooks/useBreakpoint";
import SiteHeader from "../../../src/components/SiteHeader";
import RoasterLogo from "../../../src/components/primitives/RoasterLogo";
import { tap as hapticTap, commit as hapticCommit } from "../../../src/utils/haptics";
import type { RoasterProfile } from "../../../src/resources/types";
import { formatRelative } from "../../../src/components/admin/JobHistory";

type RefreshSummary = {
  ok: boolean;
  mode: string;
  bio_pending: number;
  products_pending: number;
  articles_pending: number;
  products_removed?: number;
  articles_removed?: number;
  has_prev?: boolean;
  snapshot_taken_at: string;
};

type Breakdown = {
  products: { storefront: number; in_catalog: number; unknown: number };
  articles: { storefront: number; in_catalog: number; unknown: number };
};

type SnapshotInfo = {
  slug: string;
  snapshot: null | {
    taken_at: string;
    summary: {
      platform: string | null;
      bio_len: number | null;
      products_count: number;
      articles_count: number;
    };
  };
  breakdown: null | Breakdown;
  diff: null | {
    has_prev: boolean;
    bio_changed: boolean;
    products: { added: any[]; updated: any[]; removed: any[] };
    articles: { added: any[]; updated: any[]; removed: any[] };
  };
};

type ProfileHints = {
  enrichment_prompt_hint?: string | null;
  enrichment_prompt_hint_updated_at?: string | null;
  article_enrichment_prompt_hint?: string | null;
  article_enrichment_prompt_hint_updated_at?: string | null;
  diff_prompt_hint?: string | null;
  diff_prompt_hint_updated_at?: string | null;
};

export default function AdminRefreshPage() {
  const router = useRouter();
  const { isMobile } = useBreakpoint();
  const { slug: rawSlug } = useLocalSearchParams<{ slug: string }>();
  const slug = typeof rawSlug === "string" ? rawSlug : "";
  const s = useStyles();

  const [profile, setProfile] = useState<RoasterProfile & ProfileHints | null>(null);
  const [snapshot, setSnapshot] = useState<SnapshotInfo | null>(null);
  const [lastRun, setLastRun] = useState<RefreshSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Diff-hint editor state — separate draft so the save button only
  // fires when the admin confirms. Pattern mirrors EditableField in
  // the roaster admin page.
  const [diffHintDraft, setDiffHintDraft] = useState("");
  const [diffHintSaving, setDiffHintSaving] = useState(false);
  const [diffHintError, setDiffHintError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    if (!slug) return;
    try {
      const res: any = await apiFetchRaw(`/roaster_profiles/${slug}`);
      const data = (res?.data ?? res) as RoasterProfile & ProfileHints;
      setProfile(data);
      setDiffHintDraft(data.diff_prompt_hint || "");
    } catch (e: any) {
      setError(e?.message || "Couldn't load roaster profile");
    }
  }, [slug]);

  const fetchSnapshot = useCallback(async () => {
    if (!slug) return;
    try {
      const res: any = await apiFetchRaw(`/admin/sync/${slug}/snapshot`);
      setSnapshot((res?.data ?? res) as SnapshotInfo);
    } catch {
      setSnapshot(null);
    }
  }, [slug]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchProfile(), fetchSnapshot()]);
      setLoading(false);
    })();
  }, [fetchProfile, fetchSnapshot]);

  const runRefresh = async () => {
    if (!slug) return;
    setError(null);
    setRunning(true);
    try {
      hapticCommit();
      const res: any = await apiFetchRaw(`/admin/sync/${slug}`, {
        method: "POST",
        body: JSON.stringify({ mode: "tab2" }),
      });
      setLastRun((res?.data ?? res) as RefreshSummary);
      await fetchSnapshot();
    } catch (e: any) {
      setError(e?.message || "Refresh failed");
    } finally {
      setRunning(false);
    }
  };

  const saveDiffHint = async () => {
    if (!slug) return;
    setDiffHintError(null);
    setDiffHintSaving(true);
    try {
      hapticCommit();
      const res: any = await apiFetchRaw(`/admin/roasters/${slug}/diff-hint`, {
        method: "PUT",
        body: JSON.stringify({ hint: diffHintDraft }),
      });
      const data = res?.data ?? res;
      setProfile((p) => p ? {
        ...p,
        diff_prompt_hint: data.diff_prompt_hint,
        diff_prompt_hint_updated_at: data.diff_prompt_hint_updated_at,
      } : p);
    } catch (e: any) {
      setDiffHintError(e?.message || "Couldn't save hint");
    } finally {
      setDiffHintSaving(false);
    }
  };

  const hasSnapshot = !!snapshot?.snapshot;
  const hasPrev = !!snapshot?.diff?.has_prev;
  const breakdown = snapshot?.breakdown;

  const diffCounts = useMemo(() => {
    if (!snapshot?.diff || !snapshot.diff.has_prev) return null;
    const d = snapshot.diff;
    const totalRemoved =
      d.products.removed.length + d.articles.removed.length;
    const totalLLM =
      (d.bio_changed ? 1 : 0) +
      d.products.added.length + d.products.updated.length +
      d.articles.added.length + d.articles.updated.length;
    return {
      bio:              d.bio_changed,
      productsAdded:    d.products.added.length,
      productsUpdated:  d.products.updated.length,
      productsRemoved:  d.products.removed.length,
      articlesAdded:    d.articles.added.length,
      articlesUpdated:  d.articles.updated.length,
      articlesRemoved:  d.articles.removed.length,
      totalLLM,
      totalRemoved,
      anyChange: d.bio_changed || totalLLM > 0 || totalRemoved > 0,
    };
  }, [snapshot]);

  // Has the editor drifted from the saved value?
  const diffHintDirty =
    (profile?.diff_prompt_hint || "") !== diffHintDraft;

  return (
    <View style={s.page}>
      <Stack.Screen options={{ headerShown: false }} />
      <SiteHeader />

      {loading ? (
        <View style={s.loadingBlock}>
          <ActivityIndicator size="small" color={t.color["text.primary"]} />
        </View>
      ) : !profile ? (
        <View style={s.loadingBlock}>
          <Text style={s.errorText}>{error || "Couldn't load roaster"}</Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.scrollInner}
          showsVerticalScrollIndicator={false}
        >
          {/* Back affordance */}
          {isMobile ? (
            <Pressable
              onPress={() => {
                hapticTap();
                if (router.canGoBack()) router.back();
                else router.replace("/profile?tab=catalog");
              }}
              hitSlop={8}
              style={({ pressed }) => [s.backBtn, pressed && s.pressed]}
              accessibilityLabel="Back to Catalog Ops"
            >
              <ArrowLeft size={18} color={t.color["text.primary"]} strokeWidth={2} />
              <Text style={s.backText}>Catalog Ops</Text>
            </Pressable>
          ) : null}

          {/* Identity */}
          <View style={s.identity}>
            <RoasterLogo
              url={profile.logo_url || profile.hero_image_url}
              size={72}
              fallbackInitial={profile.name || slug}
            />
            <View style={{ flex: 1 }}>
              <Text style={s.identityName} numberOfLines={1}>
                {profile.name || slug}
              </Text>
              <Text style={s.identityMeta} numberOfLines={1}>
                {[profile.city, profile.state].filter(Boolean).join(", ") ||
                  profile.website ||
                  slug}
              </Text>
            </View>
            <Pressable
              onPress={() => {
                hapticTap();
                router.push(`/admin/roaster/${slug}` as any);
              }}
              style={({ pressed }) => [s.altLink, pressed && s.pressed]}
              accessibilityLabel="Open full admin page for this roaster"
            >
              <Text style={s.altLinkText}>Full admin</Text>
              <ExternalLink size={14} color={t.color["text.secondary"]} strokeWidth={1.8} />
            </Pressable>
          </View>

          {/* Snapshot + breakdown */}
          <View style={s.card}>
            <Text style={s.cardTitle}>Snapshot</Text>
            {hasSnapshot ? (
              <>
                <Text style={s.cardMeta}>
                  <Text style={s.cardMetaLabel}>Last sync</Text>{" "}
                  {formatRelative(snapshot!.snapshot!.taken_at)}
                  {snapshot!.snapshot!.summary.platform
                    ? ` · ${snapshot!.snapshot!.summary.platform}`
                    : ""}
                </Text>

                {breakdown ? (
                  <View style={s.breakdownGrid}>
                    <View style={s.breakdownCol}>
                      <Text style={s.breakdownHeader}>Coffees</Text>
                      <BreakdownRow
                        label="Storefront"
                        value={breakdown.products.storefront}
                        emphasis={false}
                      />
                      <BreakdownRow
                        label="In catalog"
                        value={breakdown.products.in_catalog}
                        emphasis
                      />
                      <BreakdownRow
                        label="Unknown"
                        value={breakdown.products.unknown}
                        emphasis={breakdown.products.unknown > 0}
                      />
                    </View>
                    <View style={s.breakdownCol}>
                      <Text style={s.breakdownHeader}>Journals</Text>
                      <BreakdownRow
                        label="Discovered"
                        value={breakdown.articles.storefront}
                        emphasis={false}
                      />
                      <BreakdownRow
                        label="In catalog"
                        value={breakdown.articles.in_catalog}
                        emphasis
                      />
                      <BreakdownRow
                        label="Unknown"
                        value={breakdown.articles.unknown}
                        emphasis={breakdown.articles.unknown > 0}
                      />
                    </View>
                  </View>
                ) : null}

                <Text style={s.cardHint}>
                  Bio: {snapshot!.snapshot!.summary.bio_len?.toLocaleString() ?? 0} chars
                </Text>
              </>
            ) : (
              <Text style={s.cardHint}>
                No snapshot yet. The first refresh takes a baseline; subsequent runs diff against it.
              </Text>
            )}
          </View>

          {/* Diff vs prev */}
          {hasSnapshot ? (
            <View style={s.card}>
              <Text style={s.cardTitle}>Changes since last snapshot</Text>
              {hasPrev && diffCounts ? (
                <>
                  <View style={s.diffGrid}>
                    <DiffCell
                      label="Bio"
                      value={diffCounts.bio ? "Changed" : "Unchanged"}
                      changed={diffCounts.bio}
                    />
                    <DiffCell
                      label="Coffees"
                      value={`+${diffCounts.productsAdded}  ~${diffCounts.productsUpdated}  −${diffCounts.productsRemoved}`}
                      changed={
                        diffCounts.productsAdded +
                          diffCounts.productsUpdated +
                          diffCounts.productsRemoved >
                        0
                      }
                    />
                    <DiffCell
                      label="Journals"
                      value={`+${diffCounts.articlesAdded}  ~${diffCounts.articlesUpdated}  −${diffCounts.articlesRemoved}`}
                      changed={
                        diffCounts.articlesAdded +
                          diffCounts.articlesUpdated +
                          diffCounts.articlesRemoved >
                        0
                      }
                    />
                  </View>
                  <Text style={s.cardHint}>
                    {!diffCounts.anyChange
                      ? "Nothing changed since the last refresh — running now will hit the website once and exit with zero LLM calls."
                      : diffCounts.totalLLM === 0
                      ? `Only removals (${diffCounts.totalRemoved} item${diffCounts.totalRemoved === 1 ? "" : "s"}) — DB-flag updates, zero LLM calls.`
                      : `${diffCounts.totalLLM} LLM call${diffCounts.totalLLM === 1 ? "" : "s"} needed to enrich the diff.`}
                  </Text>
                </>
              ) : (
                <Text style={s.cardHint}>
                  No previous snapshot to diff against. The next refresh will
                  produce the first prev snapshot.
                </Text>
              )}
            </View>
          ) : null}

          {/* Last run result */}
          {lastRun ? (
            <View style={[s.card, s.cardSubtle]}>
              <Text style={s.cardTitle}>Last run</Text>
              <Text style={s.cardMeta}>
                {lastRun.bio_pending} bio · {lastRun.products_pending} products ·{" "}
                {lastRun.articles_pending} articles enriched
                {lastRun.products_removed ? ` · ${lastRun.products_removed} products removed` : ""}
                {lastRun.articles_removed ? ` · ${lastRun.articles_removed} articles removed` : ""}
              </Text>
            </View>
          ) : null}

          {error ? <Text style={s.errorText}>{error}</Text> : null}

          {/* Primary CTA */}
          <Pressable
            onPress={runRefresh}
            disabled={running}
            style={({ pressed }) => [
              s.cta,
              running && s.ctaDisabled,
              pressed && s.ctaPressed,
            ]}
            accessibilityRole="button"
            accessibilityLabel={`Refresh diff for ${profile.name || slug}`}
          >
            {running ? (
              <ActivityIndicator size="small" color={t.color["text.on-cta"]} />
            ) : (
              <Text style={s.ctaText}>Refresh diff</Text>
            )}
          </Pressable>

          {/* ── Site quirks ──────────────────────────────────────────
             Three per-roaster prompt hints — bio + journal are
             Sonnet-generated and live elsewhere (read-only here);
             diff is admin-written and editable inline. */}
          <View style={s.quirkBlock}>
            <Text style={s.sectionLabel}>Site quirks</Text>
            <Text style={s.sectionHint}>
              Per-roaster hints the LLM reads when running bio, journal, or
              diff enrichment. Diff quirk is editable here; bio + journal
              quirks are generated on each run — open the full admin page to
              regenerate.
            </Text>

            <HintCard
              title="Bio + bean quirk"
              hint={profile.enrichment_prompt_hint}
              updatedAt={profile.enrichment_prompt_hint_updated_at}
              readonly
              onOpenFullAdmin={() =>
                router.push(`/admin/roaster/${slug}` as any)
              }
            />

            <HintCard
              title="Journal quirk"
              hint={profile.article_enrichment_prompt_hint}
              updatedAt={profile.article_enrichment_prompt_hint_updated_at}
              readonly
              onOpenFullAdmin={() =>
                router.push(`/admin/roaster/${slug}` as any)
              }
            />

            <View style={[s.hintCard, s.hintCardEditable]}>
              <View style={s.hintHeader}>
                <Text style={s.hintTitle}>Diff quirk</Text>
                <Text style={s.hintMeta}>
                  {profile.diff_prompt_hint_updated_at
                    ? `Updated ${formatRelative(profile.diff_prompt_hint_updated_at)}`
                    : "Not set"}
                </Text>
              </View>
              <Text style={s.hintHelper}>
                Free text Haiku reads when interpreting this roaster's
                storefront diff. Tell it which SKUs to ignore (gift cards,
                merch, subscription bundles), how this site archives
                products, anything else worth knowing.
              </Text>
              <TextInput
                style={s.hintEditor}
                value={diffHintDraft}
                onChangeText={setDiffHintDraft}
                placeholder="e.g. Ignore /products/gift-card-* and /products/merch-*; this site archives by setting available=false rather than unlisting."
                placeholderTextColor={t.color["text.muted"]}
                multiline
                numberOfLines={4}
              />
              {diffHintError ? <Text style={s.errorText}>{diffHintError}</Text> : null}
              <View style={s.hintActions}>
                <Pressable
                  onPress={saveDiffHint}
                  disabled={!diffHintDirty || diffHintSaving}
                  style={({ pressed }) => [
                    s.hintSaveBtn,
                    (!diffHintDirty || diffHintSaving) && s.hintSaveBtnDisabled,
                    pressed && s.hintSaveBtnPressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="Save diff quirk"
                >
                  {diffHintSaving ? (
                    <ActivityIndicator size="small" color={t.color["text.on-cta"]} />
                  ) : (
                    <Text style={s.hintSaveBtnText}>
                      {diffHintDirty ? "Save" : "Saved"}
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function BreakdownRow({
  label, value, emphasis,
}: { label: string; value: number; emphasis: boolean }) {
  const s = useStyles();
  return (
    <View style={s.breakdownRow}>
      <Text style={s.breakdownLabel}>{label}</Text>
      <Text
        style={[
          s.breakdownValue,
          { color: emphasis ? t.color["text.primary"] : t.color["text.muted"] },
        ]}
      >
        {value.toLocaleString()}
      </Text>
    </View>
  );
}

function DiffCell({
  label, value, changed,
}: { label: string; value: string; changed: boolean }) {
  const s = useStyles();
  return (
    <View style={s.diffCell}>
      <Text style={s.diffCellLabel}>{label}</Text>
      <Text
        style={[
          s.diffCellValue,
          {
            color: changed ? t.color["text.primary"] : t.color["text.muted"],
            fontFamily: changed
              ? t.font["body.semibold"]
              : t.font["body.regular"],
          },
        ]}
      >
        {value}
      </Text>
    </View>
  );
}

function HintCard({
  title, hint, updatedAt, readonly, onOpenFullAdmin,
}: {
  title: string;
  hint?: string | null;
  updatedAt?: string | null;
  readonly?: boolean;
  onOpenFullAdmin: () => void;
}) {
  const s = useStyles();
  return (
    <View style={s.hintCard}>
      <View style={s.hintHeader}>
        <Text style={s.hintTitle}>{title}</Text>
        <View style={s.hintHeaderRight}>
          {readonly ? (
            <View style={s.hintReadonlyBadge}>
              <Lock size={11} color={t.color["text.muted"]} strokeWidth={2} />
              <Text style={s.hintReadonlyText}>Read-only here</Text>
            </View>
          ) : null}
          <Text style={s.hintMeta}>
            {updatedAt
              ? `Updated ${formatRelative(updatedAt)}`
              : "Not generated yet"}
          </Text>
        </View>
      </View>
      <Text style={[s.hintBody, !hint && s.hintBodyEmpty]}>
        {hint || "No hint generated yet — the first enrichment run produces it."}
      </Text>
      {readonly ? (
        <Pressable
          onPress={onOpenFullAdmin}
          style={({ pressed }) => [s.hintLinkBtn, pressed && { opacity: 0.7 }]}
          accessibilityLabel={`Open full admin to regenerate ${title}`}
        >
          <Text style={s.hintLinkText}>Open full admin to regenerate</Text>
          <ExternalLink size={12} color={t.color["text.secondary"]} strokeWidth={1.8} />
        </Pressable>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  page: { flex: 1, backgroundColor: t.color.bg } as any,
  loadingBlock: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: t.spacing.xl,
  } as any,
  scrollInner: {
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.md,
    paddingBottom: t.spacing["3xl"],
    gap: t.spacing.lg,
  } as any,

  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    alignSelf: "flex-start",
    paddingVertical: t.spacing.xs,
    paddingHorizontal: t.spacing.sm,
    borderRadius: t.radius.full,
  } as any,
  backText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
  } as any,
  pressed: { opacity: 0.7 } as any,

  identity: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
    paddingVertical: t.spacing.sm,
  } as any,
  identityName: {
    fontFamily: t.font.display,
    fontSize: t.size["font.2xl"],
    lineHeight: 30,
    color: t.color["text.primary"],
  } as any,
  identityMeta: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    marginTop: 2,
  } as any,
  altLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: t.spacing.sm,
    paddingVertical: t.spacing.xs,
    borderRadius: t.radius.full,
    borderWidth: 1,
    borderColor: t.color["border.light"],
  } as any,
  altLinkText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.secondary"],
  } as any,

  card: {
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    padding: t.spacing.lg,
    gap: t.spacing.sm,
  } as any,
  cardSubtle: { backgroundColor: t.color["card.info"] } as any,
  cardTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
  } as any,
  cardMeta: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
    lineHeight: 20,
  } as any,
  cardMetaLabel: {
    fontFamily: t.font["body.semibold"],
    color: t.color["text.primary"],
  } as any,
  cardHint: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    lineHeight: 20,
    marginTop: t.spacing.xs,
  } as any,

  // ── Breakdown ──────────────────────────────────────────────────
  breakdownGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xl,
    marginTop: t.spacing.sm,
  } as any,
  breakdownCol: { minWidth: 140, gap: t.spacing.xs } as any,
  breakdownHeader: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    marginBottom: t.spacing.xs,
  } as any,
  breakdownRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: t.spacing.md,
  } as any,
  breakdownLabel: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
  } as any,
  breakdownValue: {
    fontFamily: t.font.display,
    fontSize: t.size["font.lg"],
    fontVariant: ["tabular-nums"],
  } as any,

  // ── Diff cells — emphasis via text.primary (mode-flipping),
  // NOT accent.cta. Crema pink is reserved for buttons + post-action
  // icons per DESIGN_LANGUAGE.md §1.
  diffGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.xl,
    marginTop: t.spacing.xs,
  } as any,
  diffCell: { minWidth: 130 } as any,
  diffCellLabel: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
  } as any,
  diffCellValue: {
    fontSize: t.size["font.md"],
    marginTop: 2,
    fontVariant: ["tabular-nums"],
    // fontFamily + color set inline based on changed state
  } as any,

  errorText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    padding: t.spacing.md,
    backgroundColor: t.color["card.info"],
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: t.color["border.light"],
  } as any,

  cta: {
    minHeight: 52,
    paddingHorizontal: t.spacing.xl,
    borderRadius: t.radius.full,
    backgroundColor: t.color["accent.cta"],
    alignItems: "center",
    justifyContent: "center",
    marginTop: t.spacing.sm,
    shadowColor: t.color.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 8,
  } as any,
  ctaDisabled: { opacity: 0.55 } as any,
  ctaPressed: { transform: [{ scale: 0.98 }], opacity: 0.9 } as any,
  ctaText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.on-cta"],
  } as any,

  // ── Quirks section ─────────────────────────────────────────────
  quirkBlock: {
    gap: t.spacing.md,
    marginTop: t.spacing.lg,
  } as any,
  sectionLabel: {
    fontFamily: t.font.display,
    fontSize: t.size["font.xl"],
    color: t.color["text.primary"],
  } as any,
  sectionHint: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
    lineHeight: 20,
  } as any,

  hintCard: {
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    padding: t.spacing.md,
    gap: t.spacing.sm,
  } as any,
  hintCardEditable: { backgroundColor: t.color["card.info"] } as any,

  hintHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: t.spacing.sm,
    flexWrap: "wrap",
  } as any,
  hintHeaderRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
  } as any,
  hintTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
  } as any,
  hintMeta: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
  } as any,
  hintReadonlyBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: t.spacing.xs,
    paddingVertical: 2,
    borderRadius: t.radius.sm,
    borderWidth: 1,
    borderColor: t.color["border.light"],
  } as any,
  hintReadonlyText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
  } as any,
  hintBody: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    lineHeight: 20,
  } as any,
  hintBodyEmpty: {
    color: t.color["text.muted"],
    fontStyle: "italic",
  } as any,
  hintHelper: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    lineHeight: 20,
  } as any,

  hintLinkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingVertical: t.spacing.xs,
  } as any,
  hintLinkText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.secondary"],
  } as any,

  hintEditor: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    backgroundColor: t.color.bg,
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    minHeight: 100,
    textAlignVertical: "top",
    lineHeight: 20,
  } as any,
  hintActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
  } as any,
  hintSaveBtn: {
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.full,
    backgroundColor: t.color["accent.cta"],
    minHeight: 38,
    alignItems: "center",
    justifyContent: "center",
  } as any,
  hintSaveBtnDisabled: { opacity: 0.45 } as any,
  hintSaveBtnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] } as any,
  hintSaveBtnText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.on-cta"],
  } as any,
}));
