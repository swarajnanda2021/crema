/**
 * Admin · Roaster page — full-route version of the old
 * `RoasterProfileDrawer`. Replaces the modal because nested-Modal +
 * z-index quirks on iOS Expo Go made the drawer render only its
 * backdrop, never its card. A plain Expo Router screen avoids the
 * entire Modal stack.
 *
 * Chrome layout follows the consumer `/roaster/[slug]` page so the
 * admin and consumer surfaces feel like one product:
 *   - `<SiteHeader />` at the top — mobile MobileHeader (safe-area
 *     aware, clears the iPhone Dynamic Island) or the wide Navbar.
 *   - Floating circular back button on the hero (mobile only); the
 *     OS swipe-back gesture covers it on iOS too.
 *   - Site-wide `MobileFooter` from the root layout, scroll-aware
 *     via `onChromeScroll` piped into the ScrollView.
 *
 * Body sections (top → bottom):
 *   1. Hero image + logo + roaster name + city/state.
 *   2. Discover-publish pill row.
 *   3. About blurb (multi-line edit, debounced PUT on blur).
 *   4. Specialties chip row (read-only for now).
 *   5. Location fields (city / state — inline edit).
 *   6. Scrape settings (website / shop_url / platform + Enabled pill).
 *   7. Action row (Re-enrich link + Remove destructive).
 *
 * The page is the natural surface to "progressively fill" as more
 * Catalog Ops sub-tabs touch the same roaster — products from BEANS,
 * classifications from MAPPING, etc. — instead of stuffing every
 * concern into a single modal.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  TextInput,
  ActivityIndicator,
  Modal,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft,
  Check,
  Pencil,
  Sparkles,
  Trash2,
  X,
} from "lucide-react-native";

import { t } from "../../../src/tokens/useTokens";
import { apiFetchRaw, resolveUploadUrl } from "../../../src/api/client";
import { onChromeScroll } from "../../../src/utils/chromeScroll";
import { useBreakpoint } from "../../../src/hooks/useBreakpoint";
import SiteHeader from "../../../src/components/SiteHeader";
import RoasterLogo from "../../../src/components/primitives/RoasterLogo";
import JobProposalsCarousel from "../../../src/components/admin/JobProposalsCarousel";
import {
  tap as hapticTap,
  commit as hapticCommit,
  warn as hapticWarn,
} from "../../../src/utils/haptics";
import type {
  CatalogJob,
  RoasterProfile,
  RoasterSource,
  ScrapeProposal,
} from "../../../src/resources/types";

export default function AdminRoasterPage() {
  const router = useRouter();
  const { isMobile } = useBreakpoint();
  const { slug: rawSlug } = useLocalSearchParams<{ slug: string }>();
  const slug = typeof rawSlug === "string" ? rawSlug : "";

  const [profile, setProfile] = useState<RoasterProfile | null>(null);
  const [source, setSource] = useState<RoasterSource | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // No draft mirror — each `EditableField` keeps its own draft until
  // the user taps the ✓ Save button, then calls `saveProfileField`
  // with the final string. The parent only carries the saved server
  // state in `profile` and `source`. Both surfaces (profile fields +
  // catalog-source fields) save through the same `EditableField`
  // pattern; the only difference is which endpoint each one PUTs to.
  const [savingField, setSavingField] = useState<string | null>(null);
  const [savingScrapeField, setSavingScrapeField] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<"publish" | "delete" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Combined refresh flow — bio re-enrich runs synchronously on the
  // backend (Sonnet against the homepage), then the same endpoint
  // enqueues a per-roaster scrape job whose progress we poll. The
  // status strip on the right hero row reads from `refreshPhase` and
  // pairs with `phaseProgress` ("scraped 2/4 …") to surface what's
  // actually happening to the admin.
  const [refreshPhase, setRefreshPhase] = useState<
    "idle" | "bio" | "scraping" | "enriching" | "done"
  >("idle");
  const [phaseProgress, setPhaseProgress] = useState<string | null>(null);

  // Live catalog carousel — products already in the DB for this
  // roaster. After accepting a proposal the new row lands here on the
  // next refetch; admin can delete a stale bean directly from the
  // card (warns first; next enrichment re-pulls it if still listed
  // on the roaster's site).
  const [catalogProducts, setCatalogProducts] = useState<any[]>([]);
  const [productToDelete, setProductToDelete] = useState<any | null>(null);
  const [deletingProduct, setDeletingProduct] = useState(false);

  // Coffees section — pending bean-enrichment proposals scoped to
  // this roaster + the in-flight job (if the admin just kicked one off
  // from this page). Proposals are fetched globally and filtered
  // client-side because the existing endpoint doesn't expose a
  // `roaster_slug` filter — and adding one would require a tiny
  // backend change. The client-side filter is N=20-ish per fetch so
  // the cost is negligible.
  const [allProposals, setAllProposals] = useState<ScrapeProposal[]>([]);
  const [enrichJobId, setEnrichJobId] = useState<number | null>(null);
  const [enrichBusy, setEnrichBusy] = useState(false);
  const [enrichError, setEnrichError] = useState<string | null>(null);
  const enrichPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Per-run flag — when set, the next "Run enrichment" call passes
  // `regenerate_prompt: true` so the backend re-runs the Sonnet
  // meta-call and overwrites the cached site-prompt addendum.
  // Auto-clears after the run starts (sticky for one click).
  const [regeneratePromptOnNext, setRegeneratePromptOnNext] = useState(false);
  // Optional show/hide for the (sometimes long) hint text.
  const [hintExpanded, setHintExpanded] = useState(false);

  const refetch = () => {
    if (!slug) return;
    setLoading(true);
    setError(null);
    Promise.all([
      apiFetchRaw(`/roaster_profiles/${slug}`),
      apiFetchRaw(`/roaster_sources?limit=500`).catch(() => null),
    ])
      .then(([profRes, srcRes]: any[]) => {
        const p = (profRes?.data ?? profRes) as RoasterProfile;
        setProfile(p);
        const sources = (srcRes?.data ?? srcRes) as RoasterSource[] | null;
        if (Array.isArray(sources) && p?.website) {
          const match = sources.find((s) => s.website === p.website) || null;
          setSource(match);
        } else {
          setSource(null);
        }
      })
      .catch((e: any) => setError(e?.message || "Couldn't load roaster"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const saveProfileField = async (key: keyof RoasterProfile, val: any) => {
    if (!profile) return;
    if (val === (profile[key] ?? "")) return;
    setSavingField(key);
    setError(null);
    try {
      const res: any = await apiFetchRaw(
        `/roaster_profiles/${profile.roaster_slug}`,
        { method: "PUT", body: JSON.stringify({ [key]: val }) },
      );
      const updated = (res?.data ?? res) as RoasterProfile;
      setProfile(updated);
    } catch (e: any) {
      setError(e?.message || `Couldn't save ${String(key)}`);
      throw e;
    } finally {
      setSavingField(null);
    }
  };

  // Source-side editing (`shop_url`, `platform`, `enabled`) lives
  // inside the Coffees section below — that's where catalog
  // enrichment runs are kicked off, so the configuration that gates
  // them is right alongside the action. PUT goes to the dedicated
  // `/admin/roasters/{slug}/scrape-settings` endpoint which upserts
  // the matching `roaster_sources` row when missing.
  const saveScrapeField = async (key: "shop_url" | "platform", val: string) => {
    if (val === ((source?.[key] as string | undefined) || "")) return;
    setSavingScrapeField(key);
    setError(null);
    try {
      await apiFetchRaw(
        `/admin/roasters/${slug}/scrape-settings`,
        { method: "PUT", body: JSON.stringify({ [key]: val }) },
      );
      refetch();
    } catch (e: any) {
      setError(e?.message || `Couldn't save ${key}`);
      throw e;
    } finally {
      setSavingScrapeField(null);
    }
  };

  // ── Catalog enrichment ────────────────────────────────────────────
  // Kick off the standalone scraper scoped to this one roaster, poll
  // its job row for completion, then refetch proposals so the
  // carousel below can pick up the staged changes. Polling lives in
  // a ref so we can clear the interval on unmount or on a fresh
  // run. We hit `/jobs/{id}` (registry-driven CRUD) instead of the
  // bulk `/jobs` list so the poll stays a single-row read.
  const fetchProposals = useCallback(async () => {
    try {
      const res: any = await apiFetchRaw("/admin/scrape/proposals?status=pending");
      const rows = (res?.data ?? res) as ScrapeProposal[];
      setAllProposals(Array.isArray(rows) ? rows : []);
    } catch {
      // Best-effort — if the fetch fails we just don't update; the
      // existing list (possibly empty) stays. Avoids flashing an
      // error on a page that's also showing live data.
    }
  }, []);

  useEffect(() => {
    fetchProposals();
  }, [fetchProposals]);

  const fetchCatalogProducts = useCallback(async () => {
    if (!slug) return;
    try {
      const res: any = await apiFetchRaw(
        `/products/filter?roaster_slug=${encodeURIComponent(slug)}&limit=200`,
      );
      const rows = (res?.data ?? res) as any[];
      setCatalogProducts(Array.isArray(rows) ? rows : []);
    } catch {
      // Best-effort; the carousel just stays empty.
    }
  }, [slug]);

  useEffect(() => {
    fetchCatalogProducts();
  }, [fetchCatalogProducts]);

  const deleteProduct = async () => {
    if (!productToDelete) return;
    hapticWarn();
    setDeletingProduct(true);
    setError(null);
    try {
      await apiFetchRaw(`/products/${productToDelete.product_id}`, {
        method: "DELETE",
      });
      setProductToDelete(null);
      await fetchCatalogProducts();
    } catch (e: any) {
      setError(e?.message || "Couldn't delete bean");
    } finally {
      setDeletingProduct(false);
    }
  };

  // Clean up any in-flight poll interval on slug change / unmount.
  useEffect(() => {
    return () => {
      if (enrichPollRef.current) {
        clearInterval(enrichPollRef.current);
        enrichPollRef.current = null;
      }
    };
  }, [slug]);

  const startPoll = (jobId: number) => {
    if (enrichPollRef.current) clearInterval(enrichPollRef.current);
    // Hard ceilings so a silently-failing poll can't stick the
    // spinner forever:
    //   • Up to 12 consecutive errors → give up (~24s of no
    //     visibility); surfaces the error instead of swallowing.
    //   • Up to 600 ticks (20 min) total → enrichment runs that
    //     actually go that long are exceptional; better to clear
    //     the spinner and let the admin re-check via the Recent
    //     enrichment runs collapsible than to leave it spinning.
    let consecutiveErrors = 0;
    let tickCount = 0;
    const MAX_CONSECUTIVE_ERRORS = 12;
    const MAX_TICKS = 600;
    const stopPoll = () => {
      if (enrichPollRef.current) {
        clearInterval(enrichPollRef.current);
        enrichPollRef.current = null;
      }
    };
    enrichPollRef.current = setInterval(async () => {
      tickCount += 1;
      if (tickCount > MAX_TICKS) {
        stopPoll();
        setEnrichBusy(false);
        setEnrichError(
          `Stopped polling job #${jobId} after 20 min. Check "Recent enrichment runs" — the job may have already completed.`,
        );
        return;
      }
      try {
        const res: any = await apiFetchRaw(`/jobs/${jobId}`);
        const job = (res?.data ?? res) as CatalogJob;
        consecutiveErrors = 0;
        // Surface mid-flight progress in the status strip — once the
        // log_tail mentions per-product enrichment we're past the
        // raw scrape and into the Haiku phase. Cheap regex sniff
        // against the rolling tail.
        const tail = (job as any)?.log_tail || "";
        if (typeof tail === "string") {
          if (/staging proposals|per-product enrichment/i.test(tail)) {
            setRefreshPhase("enriching");
            const m = tail.match(/staged: scraped=(\d+)/);
            if (m) setPhaseProgress(`Enriching ${m[1]} beans…`);
          }
        }
        if (job.status === "succeeded" || job.status === "failed") {
          stopPoll();
          setEnrichBusy(false);
          setRefreshPhase(job.status === "succeeded" ? "done" : "idle");
          setPhaseProgress(null);
          // Auto-clear the "Done." status after a brief moment so the
          // strip doesn't linger forever once everything's settled.
          if (job.status === "succeeded") {
            // Now (and only now) is it safe to clear the regen toggle.
            // If we'd cleared on Run-tap and the job ended up failing,
            // the user would have to re-tick before retrying.
            setRegeneratePromptOnNext(false);
            setTimeout(() => {
              setRefreshPhase((cur) => (cur === "done" ? "idle" : cur));
            }, 2500);
          }
          if (job.status === "failed") {
            setEnrichError(job.error_message || "Enrichment failed.");
          }
          await fetchProposals();
          await fetchCatalogProducts();
          refetch();
        }
      } catch (err: any) {
        consecutiveErrors += 1;
        // eslint-disable-next-line no-console
        console.warn(
          `[enrich poll] job=${jobId} attempt=${tickCount} err`,
          consecutiveErrors,
          "of",
          MAX_CONSECUTIVE_ERRORS,
          err?.message || err,
        );
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          stopPoll();
          setEnrichBusy(false);
          setEnrichError(
            `Lost track of job #${jobId} — ${MAX_CONSECUTIVE_ERRORS} consecutive poll failures. ` +
              `Check "Recent enrichment runs" to see if it finished anyway: ${err?.message || "unknown"}`,
          );
        }
      }
    }, 2000);
  };

  // Combined refresh — bio enrich + catalog scrape in one click.
  // Single POST: the backend runs Sonnet against the homepage,
  // upserts the profile, and enqueues a per-roaster scrape job.
  // The status strip narrates the bio-enrichment phase via the
  // synchronous response, then the strip switches to "Fetching
  // catalog…" and the existing poll picks up live progress out of
  // the job's `log_tail`.
  const refreshAll = async () => {
    if (!profile) return;
    hapticCommit();
    setEnrichBusy(true);
    setEnrichError(null);
    setError(null);
    setRefreshPhase("bio");
    setPhaseProgress(null);
    // Capture the regen intent for the API call but DON'T reset the
    // toggle here — if the API or the job that follows fails, the user
    // would have to re-tick. The toggle is reset once the job's
    // status flips to "succeeded" inside `startPoll`.
    const sendRegenerate = regeneratePromptOnNext;

    try {
      const res: any = await apiFetchRaw(
        `/admin/roasters/${profile.roaster_slug}/refresh-all`,
        {
          method: "POST",
          body: JSON.stringify({ regenerate_prompt: sendRegenerate }),
        },
      );
      const data: any = res?.data ?? res;
      const updatedProfile = data?.profile as RoasterProfile | undefined;
      const job = data?.job as { id: number } | undefined;
      if (updatedProfile) setProfile(updatedProfile);
      if (data?.warning) setEnrichError(data.warning);
      refetch();
      await fetchCatalogProducts();
      if (job?.id) {
        setEnrichJobId(job.id);
        setRefreshPhase("scraping");
        setPhaseProgress("Fetching catalog…");
        startPoll(job.id);
      } else {
        setRefreshPhase("done");
        setEnrichBusy(false);
        setTimeout(() => {
          setRefreshPhase((cur) => (cur === "done" ? "idle" : cur));
          setPhaseProgress(null);
        }, 2500);
      }
    } catch (e: any) {
      setEnrichError(e?.message || "Refresh failed");
      setRefreshPhase("idle");
      setEnrichBusy(false);
    }
  };

  // Filter the global pending list down to this roaster — the scrape
  // proposals carry roaster_slug inside `proposed_state` (and
  // `prev_state` for updates) so we match either side.
  const myPendingProposals = useMemo(() => {
    return allProposals.filter((p) => {
      const pSlug = (p.proposed_state as any)?.roaster_slug;
      const prevSlug = (p.prev_state as any)?.roaster_slug;
      return pSlug === slug || prevSlug === slug;
    });
  }, [allProposals, slug]);

  const latestPendingJobId = useMemo(() => {
    if (myPendingProposals.length === 0) return null;
    return Math.max(...myPendingProposals.map((p) => p.job_id));
  }, [myPendingProposals]);

  // Status line readout — "Last enriched 2h ago · 23 coffees" or
  // "Not enriched yet" when the catalog source has never been
  // scraped. The coffees count comes from `source.products_count`
  // which the scraper stamps after each successful run.
  const enrichmentStatusText = useMemo(() => {
    const count = source?.products_count || 0;
    const last = source?.last_scraped_at;
    const countLabel = `${count} ${count === 1 ? "coffee" : "coffees"} in catalog`;
    if (!last) return count > 0 ? countLabel : "Not enriched yet.";
    return `${countLabel} · enriched ${relativeAge(last)}`;
  }, [source?.products_count, source?.last_scraped_at]);

  const togglePublish = async () => {
    if (!profile) return;
    hapticCommit();
    setBusyAction("publish");
    setError(null);
    try {
      const next = profile.published === 1 ? 0 : 1;
      await apiFetchRaw(
        `/admin/roasters/${profile.roaster_slug}/publish`,
        { method: "POST", body: JSON.stringify({ published: next }) },
      );
      setProfile({ ...profile, published: next });
    } catch (e: any) {
      setError(e?.message || "Couldn't change publish state");
    } finally {
      setBusyAction(null);
    }
  };

  const remove = async () => {
    if (!profile) return;
    hapticWarn();
    setBusyAction("delete");
    setError(null);
    try {
      await apiFetchRaw(
        `/admin/roasters/${profile.roaster_slug}`,
        { method: "DELETE" },
      );
      setConfirmDelete(false);
      // Drop the route from the back stack — going back lands on the
      // ROASTERS sub-tab so the deleted row's removal is visible.
      router.back();
    } catch (e: any) {
      setError(e?.message || "Couldn't remove roaster");
      setBusyAction(null);
    }
  };

  const specialties = useMemo<string[]>(() => {
    const raw = profile?.specialties as any;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
      const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }, [profile?.specialties]);

  const heroUrl = (profile?.hero_image_url || profile?.logo_url) as string | null;

  return (
    <View style={s.page}>
      <Stack.Screen options={{ headerShown: false }} />
      {/* Sitewide top chrome — handles iPhone Dynamic Island / notch
         via SafeAreaView internally and animates collapsed when the
         ScrollView below scrolls down (sitewide chromeScroll bus). */}
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
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={s.scrollInner}
          showsVerticalScrollIndicator={false}
          onScroll={onChromeScroll}
          scrollEventThrottle={16}
          keyboardShouldPersistTaps="handled"
          // iOS 14+ keyboard handling — when a TextInput inside this
          // ScrollView focuses, the system pads the scroll content
          // automatically so the focused field stays above the
          // keyboard. Replaces the old "field gets hidden behind the
          // keyboard" bug entirely.
          automaticallyAdjustKeyboardInsets={true}
          contentInsetAdjustmentBehavior="automatic"
        >
          {/* ── 1. Hero ─────────────────────────────────────────────── */}
          <View style={s.hero}>
            {heroUrl ? (
              <Image
                source={{ uri: resolveUploadUrl(heroUrl) || heroUrl }}
                style={s.heroImage}
                contentFit="cover"
                transition={200}
              />
            ) : (
              <View style={s.heroPlaceholder} />
            )}
            <View style={s.heroOverlay} />
            {/* Mobile-only floating back button — same geometry as the
               consumer roaster page so the muscle memory carries over.
               On wide / web the OS-level browser back works and the
               Navbar provides chrome navigation, so we hide it. */}
            {isMobile ? (
              <Pressable
                onPress={() => {
                  hapticTap();
                  router.back();
                }}
                hitSlop={8}
                style={({ pressed }) => [s.backFloating, pressed && s.linkBtnPressed]}
                accessibilityLabel="Back to Catalog Ops"
              >
                <ArrowLeft size={18} color={t.color["text.on-dark"]} strokeWidth={2} />
              </Pressable>
            ) : null}
            {/* Floating Remove button — top-right of the hero,
               mirrors the back button's geometry so the two
               affordances bookend the hero. Lives here (not in a
               bottom action row) so a stray scroll-to-bottom tap
               can't fire a destructive action. The confirm modal
               still gates the actual delete. Visible on every
               viewport — there is no browser-level "delete this
               roaster" alternative the way back-navigation has. */}
            <Pressable
              onPress={() => {
                hapticTap();
                setConfirmDelete(true);
              }}
              hitSlop={8}
              style={({ pressed }) => [s.deleteFloating, pressed && s.linkBtnPressed]}
              accessibilityLabel="Remove roaster"
            >
              <Trash2 size={18} color={t.color["text.on-dark"]} strokeWidth={2} />
            </Pressable>
            <View style={s.heroContent}>
              <RoasterLogo
                url={profile.logo_url}
                size={64}
                fallbackInitial={profile.name || profile.roaster_slug}
              />
              <View style={{ flex: 1 }}>
                <Text style={s.heroTitle} numberOfLines={2}>
                  {profile.name || profile.roaster_slug}
                </Text>
                <Text style={s.heroMeta} numberOfLines={1}>
                  {[profile.city, profile.state].filter(Boolean).join(" · ") || "Location not set"}
                </Text>
                {/* Catalog freshness — the source row's
                   `last_scraped_at` is the canonical "when did we
                   last pull this roaster's beans" timestamp. Reads
                   "Last enriched 2d ago" / "Not enriched yet" so
                   the admin can spot stale roasters at a glance
                   from the hero, not just from the Coffees status
                   line further down. */}
                <Text style={s.heroMeta} numberOfLines={1}>
                  {source?.last_scraped_at
                    ? `Last enriched ${relativeAge(source.last_scraped_at)}`
                    : "Catalog not enriched yet"}
                </Text>
              </View>
            </View>
          </View>

          {/* ── 2. Publish state ────────────────────────────────────── */}
          <View style={s.publishRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.sectionHead}>Discover visibility</Text>
              <Text style={s.helper}>
                {profile.published === 1
                  ? "Live in Discover and surfaced to consumers."
                  : "Hidden from Discover until you publish."}
              </Text>
            </View>
            <Pressable
              onPress={togglePublish}
              disabled={busyAction === "publish"}
              style={({ pressed }) => [
                s.pill,
                profile.published === 1 ? s.pillOn : s.pillOff,
                pressed && s.linkBtnPressed,
              ]}
            >
              {busyAction === "publish" ? (
                <ActivityIndicator
                  size="small"
                  color={profile.published === 1 ? t.color["text.on-dark"] : t.color["text.primary"]}
                />
              ) : (
                <Check
                  size={14}
                  color={profile.published === 1 ? t.color["text.on-dark"] : t.color["text.muted"]}
                  strokeWidth={2}
                />
              )}
              <Text
                style={[
                  s.pillText,
                  profile.published === 1 ? s.pillTextOn : s.pillTextOff,
                ]}
              >
                {profile.published === 1 ? "Live" : "Hidden"}
              </Text>
            </Pressable>
          </View>

          {/* ── Combined refresh row ──────────────────────────────────
             Single CTA that runs bio re-enrich → catalog scrape in
             one shot. Status strip on the left narrates what's
             happening; the button itself stays right-aligned under
             the Live/Hidden pill so the two action affordances on
             this row stack visually. */}
          <View style={s.refreshRow}>
            <View style={s.statusStrip} pointerEvents="none">
              {refreshPhase !== "idle" && (
                <>
                  <ActivityIndicator
                    size="small"
                    color={t.color["text.muted"]}
                  />
                  <Text style={s.statusStripText} numberOfLines={1}>
                    {refreshPhase === "bio" && "Updating roaster bio…"}
                    {refreshPhase === "scraping" && (phaseProgress || "Fetching catalog…")}
                    {refreshPhase === "enriching" && (phaseProgress || "Enriching beans…")}
                    {refreshPhase === "done" && "Done."}
                  </Text>
                </>
              )}
            </View>
            <Pressable
              onPress={refreshAll}
              disabled={enrichBusy || refreshPhase === "bio" || refreshPhase === "scraping" || refreshPhase === "enriching"}
              style={({ pressed }) => [
                s.enrichCta,
                (enrichBusy || refreshPhase === "bio" || refreshPhase === "scraping" || refreshPhase === "enriching") && s.ctaDisabled,
                pressed && !enrichBusy && s.ctaPressed,
              ]}
              accessibilityLabel="Refresh roaster — bio + catalog enrichment"
              accessibilityRole="button"
            >
              {enrichBusy ? (
                <ActivityIndicator size="small" color={t.color["text.on-dark"]} />
              ) : (
                <Sparkles size={14} color={t.color["text.on-dark"]} strokeWidth={2} />
              )}
              <Text style={s.enrichCtaText}>
                {enrichBusy ? "Refreshing…" : "Refresh roaster"}
              </Text>
            </Pressable>
          </View>

          {/* ── Refresh inputs ──────────────────────────────────────────
             The two URLs the Refresh roaster button reads from: the
             roaster's homepage drives Sonnet's bio enrichment; the
             shop URL drives the catalog scrape. Pinned right under
             the CTA so the cause-effect is obvious — edit either to
             point Sonnet / the scraper at a different page. */}
          <View style={s.section}>
            <Text style={s.sectionHead}>Sources</Text>
            <Text style={s.configHelper}>
              Bio refresh reads the website; the catalog scrape crawls
              the shop URL — narrower beats the generic /shop.
            </Text>
            <EditableField
              label="Website"
              value={profile.website || ""}
              placeholder="https://roaster.example.com"
              saving={savingField === "website"}
              onSave={(next) => saveProfileField("website", next)}
            />
            <EditableField
              label="Shop URL"
              value={source?.shop_url || ""}
              placeholder="https://roaster.example.com/collections/coffee"
              saving={savingScrapeField === "shop_url"}
              onSave={(next) => saveScrapeField("shop_url", next)}
            />
          </View>

          {/* ── Site enrichment hint ──────────────────────────────────
             Sonnet writes a 1-2 paragraph addendum to Haiku's
             extraction system prompt after the first per-roaster
             enrichment run, capturing what's idiosyncratic about
             this roaster's product pages (units, where info is
             buried, naming conventions). Surfaced above About so
             the admin sees enrichment status — generated, pending,
             or stale — on every roaster page, not just ones that
             happen to have catalog activity. The toggle below opts
             the next run into a regen; auto-clears once that run
             kicks off. */}
          <View style={s.section}>
            <View style={s.hintCard}>
              <Pressable
                onPress={() => {
                  hapticTap();
                  setHintExpanded((v) => !v);
                }}
                style={s.hintHead}
                accessibilityRole="button"
                accessibilityLabel={
                  hintExpanded
                    ? "Collapse site enrichment hint"
                    : "Expand site enrichment hint"
                }
              >
                <View style={{ flex: 1 }}>
                  <Text style={s.hintTitle}>Site enrichment hint</Text>
                  <Text style={s.hintSubtitle}>
                    {profile?.enrichment_prompt_hint
                      ? `Haiku prepends this to its system prompt on every run for this roaster${
                          profile?.enrichment_prompt_hint_updated_at
                            ? ` · updated ${relativeAge(profile.enrichment_prompt_hint_updated_at)}`
                            : ""
                        }.`
                      : "Not enriched yet — generated automatically on the first enrichment run."}
                  </Text>
                </View>
                <Text style={s.hintToggleText}>
                  {hintExpanded ? "Hide" : "Show"}
                </Text>
              </Pressable>
              {hintExpanded ? (
                <View style={s.hintBody}>
                  {profile?.enrichment_prompt_hint ? (
                    // Bounded ScrollView so a long hint doesn't push
                    // the whole roaster page off-screen — the card
                    // stays a constant ~220px tall and the prose
                    // scrolls within. `nestedScrollEnabled` lets
                    // touch drag inside the scroll without snagging
                    // the parent ScrollView on Android.
                    <ScrollView
                      style={s.hintScroll}
                      contentContainerStyle={s.hintScrollContent}
                      nestedScrollEnabled
                      showsVerticalScrollIndicator
                    >
                      <Text style={s.hintProse}>
                        {profile.enrichment_prompt_hint}
                      </Text>
                    </ScrollView>
                  ) : (
                    <Text style={s.hintEmpty}>
                      No site hint generated yet — first enrichment
                      run will sample 3-5 of this roaster's products
                      and ask Sonnet to write a short addendum that
                      captures the site's quirks.
                    </Text>
                  )}
                  <Pressable
                    onPress={() => {
                      hapticTap();
                      setRegeneratePromptOnNext((v) => !v);
                    }}
                    style={s.regenRow}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: regeneratePromptOnNext }}
                  >
                    <View
                      style={[
                        s.regenCheckbox,
                        regeneratePromptOnNext && s.regenCheckboxOn,
                      ]}
                    >
                      {regeneratePromptOnNext ? (
                        <Check
                          size={12}
                          color={t.color["text.on-dark"]}
                          strokeWidth={2.4}
                        />
                      ) : null}
                    </View>
                    <Text style={s.regenLabel}>
                      Regenerate site hint on next run
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          </View>

          {/* ── 3. About ────────────────────────────────────────────── */}
          <View style={s.section}>
            <EditableField
              label="About"
              value={profile.about_blurb || ""}
              placeholder="Sonnet's synthesized bio will land here."
              multiline
              saving={savingField === "about_blurb"}
              onSave={(next) => saveProfileField("about_blurb", next)}
            />
          </View>

          {/* ── 4. Specialties ──────────────────────────────────────── */}
          <View style={s.section}>
            <Text style={s.sectionHead}>Specialties</Text>
            {specialties.length > 0 ? (
              <View style={s.chipRow}>
                {specialties.map((sp, i) => (
                  <View key={`${sp}-${i}`} style={s.specialtyChip}>
                    <Text style={s.specialtyChipText}>{sp}</Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text style={s.emptyText}>No specialties on file yet.</Text>
            )}
          </View>

          {/* ── 5. Location ─────────────────────────────────────────── */}
          <View style={s.section}>
            <Text style={s.sectionHead}>Location</Text>
            <EditableField
              label="City"
              value={profile.city || ""}
              placeholder="e.g. New Delhi"
              saving={savingField === "city"}
              onSave={(next) => saveProfileField("city", next)}
            />
            <EditableField
              label="State"
              value={profile.state || ""}
              placeholder="e.g. Delhi"
              saving={savingField === "state"}
              onSave={(next) => saveProfileField("state", next)}
            />
          </View>

          {/* ── 6. Contact / online presence ──────────────────────────
             Website moved up under the Refresh CTA — it's an
             enrichment input, not a contact channel. */}
          <View style={s.section}>
            <Text style={s.sectionHead}>Contact</Text>
            <EditableField
              label="Instagram"
              value={profile.instagram_handle || ""}
              placeholder="handle without @"
              saving={savingField === "instagram_handle"}
              onSave={(next) => saveProfileField("instagram_handle", next)}
            />
            <EditableField
              label="Email"
              value={profile.contact_email || ""}
              placeholder="contact email"
              saving={savingField === "contact_email"}
              onSave={(next) => saveProfileField("contact_email", next)}
            />
          </View>

          {/* ── 7. Coffees ──────────────────────────────────────────────
             Per-roaster catalog. The combined "Refresh roaster" CTA
             above runs bio enrich + scrape in one click; this section
             surfaces the resulting proposals for review and the live
             catalog products with delete-per-card. Shop URL moved up
             under the CTA — it's an enrichment input. Platform
             (which strategy the scraper picks) stays here since it's
             a metadata classifier, not a URL the admin pastes. */}
          <View style={s.section}>
            <Text style={s.sectionHead}>Coffees</Text>
            <EditableField
              label="Platform"
              value={source?.platform || ""}
              placeholder="shopify · woocommerce · custom"
              saving={savingScrapeField === "platform"}
              onSave={(next) => saveScrapeField("platform", next)}
            />

            <Text style={s.coffeesStatusLine}>{enrichmentStatusText}</Text>

            {enrichError ? (
              <Text style={s.errorTextInline}>{enrichError}</Text>
            ) : null}

            {/* Pending proposals — the latest enrichment run for this
               roaster, scoped by client-side filter on the global
               pending list. Long-press a card → BeanDetailModal
               (handled inside the carousel). The carousel handles
               its own approve / skip + bulk actions. After
               acceptance the resulting product lands in the live
               catalog carousel below. */}
            {latestPendingJobId !== null ? (
              <JobProposalsCarousel
                jobId={latestPendingJobId}
                onChanged={() => {
                  fetchProposals();
                  fetchCatalogProducts();
                }}
              />
            ) : enrichBusy && enrichJobId ? (
              <Text style={s.coffeesEmptyHint}>
                Enriching your catalog · proposals will appear here when
                the run finishes.
              </Text>
            ) : null}

            {/* Live catalog — every product currently in the DB for
               this roaster, in a horizontal carousel. Each card has
               a small trash affordance that fires a confirm modal
               before deleting; the warning notes that the next
               enrichment run will re-pull the bean if it's still
               on the roaster's site. */}
            {catalogProducts.length > 0 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={s.liveCatalogCarousel}
              >
                {catalogProducts.map((p) => (
                  <View key={p.product_id} style={s.liveCard}>
                    <View style={s.liveCardImageWrap}>
                      {p.image_url ? (
                        <Image
                          source={{ uri: resolveUploadUrl(p.image_url) }}
                          style={s.liveCardImage}
                          contentFit="cover"
                        />
                      ) : (
                        <View style={s.liveCardImagePlaceholder} />
                      )}
                      <Pressable
                        onPress={() => {
                          hapticTap();
                          setProductToDelete(p);
                        }}
                        hitSlop={8}
                        style={s.liveCardDelete}
                        accessibilityLabel={`Delete ${p.coffee_name}`}
                        accessibilityRole="button"
                      >
                        <Trash2
                          size={12}
                          color={t.color["text.on-dark"]}
                          strokeWidth={2}
                        />
                      </Pressable>
                    </View>
                    <Text style={s.liveCardName} numberOfLines={2}>
                      {p.coffee_name}
                    </Text>
                    <Text style={s.liveCardMeta} numberOfLines={1}>
                      {p.weight_grams ? `${p.weight_grams}g` : ""}
                      {p.weight_grams && p.price_inr ? " · " : ""}
                      {p.price_inr ? `₹${Math.round(p.price_inr)}` : ""}
                    </Text>
                  </View>
                ))}
              </ScrollView>
            ) : latestPendingJobId === null && !(enrichBusy && enrichJobId) ? (
              <Text style={s.coffeesEmptyHint}>
                No beans in the catalog yet. Tap Refresh roaster above
                to scrape this roaster's site.
              </Text>
            ) : null}
          </View>

          {error ? <Text style={s.errorText}>{error}</Text> : null}

          {/* No bottom action row — Re-enrich bio lives at the foot
             of the Contact section (next to the data it
             re-generates) and Remove roaster lives top-right of the
             hero (bookending the back button). Both moves on
             2026-04-28 to keep destructive actions out of casual
             scroll-tap reach and to put the bio re-enrich next to
             the bio. */}
        </ScrollView>
        </KeyboardAvoidingView>
      )}

      {/* Per-product delete confirm — same overlay shape as the
         roaster remove modal, copy-tweaked for beans. */}
      <Modal
        visible={!!productToDelete}
        transparent
        animationType="fade"
        onRequestClose={() => setProductToDelete(null)}
      >
        <View style={s.confirmOverlayWrap}>
          <Pressable
            style={s.confirmOverlayBg}
            onPress={() => setProductToDelete(null)}
          />
          <View style={s.confirmCard}>
            <View style={s.confirmHeader}>
              <Text style={s.confirmTitle}>
                Delete {productToDelete?.coffee_name || "bean"}?
              </Text>
              <Pressable
                onPress={() => {
                  hapticTap();
                  setProductToDelete(null);
                }}
                hitSlop={8}
              >
                <X size={t.size["icon.lg"]} color={t.color["text.primary"]} />
              </Pressable>
            </View>
            <View style={s.confirmBody}>
              <Text style={s.confirmText}>
                The bean leaves the catalog immediately. The next
                enrichment run will re-pull it from the roaster's site
                if it's still listed there, so this is reversible.
              </Text>
              <View style={s.confirmActions}>
                <Pressable
                  onPress={() => {
                    hapticTap();
                    setProductToDelete(null);
                  }}
                  style={({ pressed }) => [s.linkBtn, pressed && s.linkBtnPressed]}
                >
                  <Text style={s.linkBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={deleteProduct}
                  disabled={deletingProduct}
                  style={({ pressed }) => [
                    s.cta,
                    deletingProduct && s.ctaDisabled,
                    pressed && s.ctaPressed,
                  ]}
                >
                  {deletingProduct ? (
                    <ActivityIndicator size="small" color={t.color["text.on-dark"]} />
                  ) : (
                    <Trash2 size={t.size["icon.sm"]} color={t.color["text.on-dark"]} strokeWidth={2} />
                  )}
                  <Text style={s.ctaText}>Delete bean</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Confirm-remove modal — top-level Modal (no nesting). */}
      <Modal
        visible={confirmDelete}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmDelete(false)}
      >
        <View style={s.confirmOverlayWrap}>
          <Pressable
            style={s.confirmOverlayBg}
            onPress={() => setConfirmDelete(false)}
          />
          <View style={s.confirmCard}>
            <View style={s.confirmHeader}>
              <Text style={s.confirmTitle}>Remove {profile?.name || profile?.roaster_slug}?</Text>
              <Pressable
                onPress={() => {
                  hapticTap();
                  setConfirmDelete(false);
                }}
                hitSlop={8}
              >
                <X size={t.size["icon.lg"]} color={t.color["text.primary"]} />
              </Pressable>
            </View>
            <View style={s.confirmBody}>
              <Text style={s.confirmText}>
                This deletes the profile + the associated source row. The
                website is preserved in the "Recently deleted" audit log
                so you can re-enrich later if this was a mistake.
              </Text>
              <View style={s.confirmActions}>
                <Pressable
                  onPress={() => {
                    hapticTap();
                    setConfirmDelete(false);
                  }}
                  style={({ pressed }) => [s.linkBtn, pressed && s.linkBtnPressed]}
                >
                  <Text style={s.linkBtnText}>Cancel</Text>
                </Pressable>
                <Pressable
                  onPress={remove}
                  disabled={busyAction === "delete"}
                  style={({ pressed }) => [
                    s.cta,
                    busyAction === "delete" && s.ctaDisabled,
                    pressed && s.ctaPressed,
                  ]}
                >
                  {busyAction === "delete" ? (
                    <ActivityIndicator size="small" color={t.color["text.on-dark"]} />
                  ) : (
                    <Trash2 size={t.size["icon.sm"]} color={t.color["text.on-dark"]} strokeWidth={2} />
                  )}
                  <Text style={s.ctaText}>Remove roaster</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ── EditableField ────────────────────────────────────────────────────────
//
// Read-only by default. Tap the pencil → field becomes a focused
// `<TextInput>` with two affordances on the right: an X to cancel
// (discards the draft, returns to read view) and a check to save
// (commits via the parent's `onSave`). Keyboard avoidance is handled
// by the parent ScrollView via `automaticallyAdjustKeyboardInsets`,
// so the focused input never disappears behind the iOS keyboard.
//
// `multiline` flips the layout from row (label · input · X · ✓) to
// stacked block (label + buttons on top, input below) — necessary for
// the "About" blurb which would otherwise crush long text into a
// single-line ellipsis.

function EditableField({
  label,
  value,
  onSave,
  saving,
  placeholder,
  multiline,
  keyboardType,
}: {
  label: string;
  value: string;
  onSave: (next: string) => Promise<void> | void;
  saving: boolean;
  placeholder: string;
  multiline?: boolean;
  keyboardType?: "default" | "url" | "email-address";
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<TextInput | null>(null);

  // Re-sync the draft if the parent reloads / re-enriches and our
  // committed value changes from underneath us — but only when we're
  // not mid-edit, so the user's keystrokes never get clobbered.
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const startEdit = () => {
    hapticTap();
    setDraft(value);
    setEditing(true);
    // Focus on the next tick so the TextInput has been mounted.
    setTimeout(() => inputRef.current?.focus(), 30);
  };

  const save = async () => {
    if (draft === value) {
      setEditing(false);
      return;
    }
    hapticCommit();
    try {
      await onSave(draft);
      setEditing(false);
    } catch {
      // Parent surfaces the error — revert the draft so the read
      // view doesn't claim a value the server didn't accept.
      setDraft(value);
      setEditing(false);
    }
  };

  const cancel = () => {
    hapticTap();
    setDraft(value);
    setEditing(false);
  };

  // Read-mode trigger: a single pencil disc to enter edit mode.
  const pencilBtn = (
    <Pressable
      onPress={startEdit}
      hitSlop={8}
      disabled={saving}
      style={({ pressed }) => [s.fieldEditBtn, pressed && s.iconBtnPressed]}
      accessibilityLabel={`Edit ${label}`}
      accessibilityRole="button"
    >
      {saving ? (
        <ActivityIndicator size="small" color={t.color["text.muted"]} />
      ) : (
        <Pencil size={14} color={t.color["text.muted"]} strokeWidth={1.8} />
      )}
    </Pressable>
  );

  // Edit-mode triggers: X (cancel, cream disc) + Check (save, dark
  // primary disc) — primary on the right matches the marketplace's
  // primary-on-right CTA pattern.
  const editControls = (
    <View style={s.editControls}>
      <Pressable
        onPress={cancel}
        hitSlop={8}
        disabled={saving}
        style={({ pressed }) => [s.fieldEditBtn, pressed && s.iconBtnPressed]}
        accessibilityLabel={`Cancel ${label} edit`}
        accessibilityRole="button"
      >
        <X size={16} color={t.color["text.muted"]} strokeWidth={1.8} />
      </Pressable>
      <Pressable
        onPress={save}
        hitSlop={8}
        disabled={saving}
        style={({ pressed }) => [s.fieldSaveBtn, pressed && s.iconBtnPressed]}
        accessibilityLabel={`Save ${label}`}
        accessibilityRole="button"
      >
        {saving ? (
          <ActivityIndicator size="small" color={t.color["text.on-dark"]} />
        ) : (
          <Check size={16} color={t.color["text.on-dark"]} strokeWidth={2.2} />
        )}
      </Pressable>
    </View>
  );

  const trailing = editing ? editControls : pencilBtn;

  const inputProps = {
    value: draft,
    onChangeText: setDraft,
    placeholder,
    placeholderTextColor: t.color["text.muted"],
    autoCapitalize: "none" as const,
    autoCorrect: false,
    keyboardType: keyboardType || "default",
    editable: !saving,
    // For single-line fields, the native keyboard return key acts as
    // a Save shortcut. Multi-line keeps return for newlines.
    onSubmitEditing: multiline ? undefined : save,
    blurOnSubmit: !multiline,
    returnKeyType: multiline ? ("default" as const) : ("done" as const),
  };

  // Multi-line "See more / See less" toggle for the About blurb. Use
  // a char-count heuristic for the truncation cue (4-line cap × ~60
  // chars/line ≈ 240) so we don't need a hidden measurement pass —
  // bias false-positives toward "show toggle" since the alternative
  // (hidden tail) is the worse failure mode.
  const [expanded, setExpanded] = useState(false);
  const longBlurb = !!multiline && (value?.length ?? 0) > 240;

  if (multiline) {
    return (
      <View style={s.editableBlock}>
        <View style={s.editableBlockHead}>
          <Text style={s.sectionHead}>{label}</Text>
          {trailing}
        </View>
        {editing ? (
          <TextInput
            ref={inputRef}
            multiline
            style={[s.fieldInput, s.fieldInputMulti]}
            {...inputProps}
          />
        ) : (
          <>
            <Text
              style={[s.fieldValueRO, !value && s.fieldValuePlaceholder]}
              numberOfLines={expanded ? undefined : 4}
            >
              {value || placeholder}
            </Text>
            {longBlurb ? (
              <Pressable
                onPress={() => setExpanded((v) => !v)}
                hitSlop={6}
                accessibilityLabel={expanded ? "Show less" : "Show more"}
                accessibilityRole="button"
                style={({ pressed }) => [
                  s.seeMoreBtn,
                  pressed && s.linkBtnPressed,
                ]}
              >
                <Text style={s.seeMoreText}>
                  {expanded ? "Show less" : "…show more"}
                </Text>
              </Pressable>
            ) : null}
          </>
        )}
      </View>
    );
  }

  return (
    <View style={s.fieldRow}>
      <Text style={s.fieldLabel}>{label}</Text>
      {editing ? (
        <TextInput ref={inputRef} style={s.fieldInput} {...inputProps} />
      ) : (
        <Text
          style={[s.fieldValueRO, !value && s.fieldValuePlaceholder]}
          numberOfLines={1}
        >
          {value || placeholder}
        </Text>
      )}
      {trailing}
    </View>
  );
}

// ── relativeAge ──────────────────────────────────────────────────────────
//
// Pretty-print an ISO timestamp as "5m ago" / "3h ago" / "2d ago" /
// "3mo ago". Used by the Coffees section status line so the admin can
// answer "when did this roaster last get scraped?" at a glance.

function relativeAge(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.parse(iso);
  if (!ms) return "never";
  const diff = Math.max(0, Date.now() - ms);
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return `${Math.floor(diff / (30 * 86_400_000))}mo ago`;
}

// ── Styles — every value reads from design tokens ────────────────────────

const s = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: t.color.bg,
  } as any,

  // Floating circular back button on the hero — mobile only.
  // Sits over the dark hero overlay so the white arrow stays
  // legible. Position values mirror the consumer roaster page
  // (`backFloating` there) so muscle memory transfers between
  // surfaces.
  backFloating: {
    position: "absolute",
    top: t.spacing.md,
    left: t.spacing.md,
    width: 36,
    height: 36,
    borderRadius: t.radius.full,
    backgroundColor: t.color["overlay.panel"],
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  } as any,
  // Floating Remove button — top-right mirror of the back button.
  // Same geometry / overlay backdrop so the white icon stays
  // legible on the dark hero. Tap → confirm modal (no inline
  // destructive action). All viewports — there's no browser-level
  // delete affordance the way there is for back-navigation.
  deleteFloating: {
    position: "absolute",
    top: t.spacing.md,
    right: t.spacing.md,
    width: 36,
    height: 36,
    borderRadius: t.radius.full,
    backgroundColor: t.color["overlay.panel"],
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  } as any,

  scrollInner: {
    paddingBottom: t.spacing["3xl"],
  } as any,

  loadingBlock: {
    paddingVertical: t.spacing["4xl"],
    alignItems: "center",
  } as any,

  // Hero
  hero: {
    width: "100%",
    height: 220,
    backgroundColor: t.color["card.back"],
    position: "relative",
  } as any,
  heroImage: {
    ...StyleSheet.absoluteFillObject,
  } as any,
  heroPlaceholder: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: t.color["card.back"],
  } as any,
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: t.color["overlay.panel"],
  } as any,
  heroContent: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.lg,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: t.spacing.md,
  } as any,
  // (logo style removed — admin hero logo now uses the RoasterLogo
  // primitive at size 64; see imports above.)
  heroTitle: {
    fontFamily: t.font.display,
    fontSize: t.size["font.2xl"],
    color: t.color["text.on-dark"],
    lineHeight: t.lineHeight.loose,
  },
  heroMeta: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.on-dark"],
    opacity: 0.8,
    marginTop: t.spacing.xs,
  },

  // Publish row
  publishRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.lg,
    paddingHorizontal: t.spacing.xl,
    paddingTop: t.spacing.xl,
  },
  helper: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
    marginTop: t.spacing.xs,
  },

  // Pill
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.full,
  } as any,
  pillOn: { backgroundColor: t.color["text.primary"] } as any,
  pillOff: {
    backgroundColor: t.color["card.info"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
  } as any,
  pillText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  pillTextOn: { color: t.color["text.on-dark"] },
  pillTextOff: { color: t.color["text.muted"] },

  // Section block
  section: {
    paddingHorizontal: t.spacing.xl,
    paddingTop: t.spacing.xl,
    gap: t.spacing.sm,
  } as any,
  // ── Coffees section ─────────────────────────────────────────────
  // Per-roaster catalog surface. The combined "Refresh roaster" CTA
  // lives on the hero row above, so this section is bio-free —
  // catalog source config (Shop URL · Platform) flows as plain
  // EditableFields, the site-prompt hint is a flat collapsible
  // panel, and the proposals + live-catalog carousels stack at the
  // bottom.
  // Combined refresh row — sits right under the Live/Hidden pill and
  // above the About section. Status strip on the left narrates which
  // phase the refresh is in (bio → scraping → enriching → done);
  // the Refresh CTA stays right-aligned to mirror the Live/Hidden
  // pill position above.
  refreshRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.lg,
    paddingHorizontal: t.spacing.xl,
    paddingTop: t.spacing.md,
  } as any,
  statusStrip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    minHeight: 20,
  } as any,
  statusStripText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
    flex: 1,
  } as any,
  enrichCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    backgroundColor: t.color["text.primary"],
    paddingHorizontal: t.spacing.lg,
    paddingVertical: t.spacing.sm,
    borderRadius: t.radius.full,
    minHeight: 36,
  } as any,
  enrichCtaText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.on-dark"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  // Inline helper text under the Coffees section header — the prior
  // `configCard` chrome is gone, the EditableFields below flow as
  // plain rows so the page reads as one continuous form.
  configHelper: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    marginTop: t.spacing["2xs"],
  },
  coffeesStatusLine: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
  },
  coffeesEmptyHint: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    fontStyle: "italic",
    paddingTop: t.spacing.sm,
  } as any,

  // Site enrichment hint — collapsible block. Lives in its own
  // section right under the Refresh CTA so the admin can see the
  // cached Haiku prompt addendum (and its freshness) before deciding
  // whether to regenerate. Section spacing handles outer padding;
  // this style is a no-op container kept in place so the JSX stays
  // grouped semantically.
  hintCard: {} as any,
  hintHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
  },
  hintTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  hintSubtitle: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
    marginTop: t.spacing["2xs"],
  },
  hintToggleText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.xs"],
    color: t.color["text.secondary"],
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  hintBody: {
    paddingHorizontal: t.spacing.lg,
    paddingBottom: t.spacing.lg,
    gap: t.spacing.md,
    borderTopWidth: 1,
    borderTopColor: t.color["border.light"],
  } as any,
  // Bounded scroll container — keeps the hint card visually compact
  // (~220px tall) regardless of how much text Sonnet generated. The
  // user scrolls inside the card to read the rest. Without this the
  // card grew unbounded and the prose flowed off the bottom of the
  // viewport on mobile.
  hintScroll: {
    maxHeight: 220,
    marginTop: t.spacing.md,
  } as any,
  hintScrollContent: {
    paddingRight: t.spacing.sm,
  } as any,
  hintProse: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    lineHeight: t.lineHeight.relaxed,
  } as any,
  hintEmpty: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    fontStyle: "italic",
    lineHeight: t.lineHeight.relaxed,
    paddingTop: t.spacing.md,
  } as any,
  regenRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    paddingTop: t.spacing.xs,
  },
  regenCheckbox: {
    width: 18,
    height: 18,
    borderRadius: t.radius.sm,
    borderWidth: 1.5,
    borderColor: t.color.border,
    backgroundColor: t.color.bg,
    alignItems: "center",
    justifyContent: "center",
  } as any,
  regenCheckboxOn: {
    backgroundColor: t.color["text.primary"],
    borderColor: t.color["text.primary"],
  } as any,
  regenLabel: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
  },
  errorTextInline: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["accent.cta"],
  },
  sectionHead: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
  // Block layout for multi-line editable fields (e.g. About). Label
  // and pencil sit on the top row; the value / TextInput drops below.
  editableBlock: {
    gap: t.spacing.sm,
  } as any,
  editableBlockHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: t.spacing.sm,
  },
  specialtyChip: {
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.xs,
    borderRadius: t.radius.full,
    backgroundColor: t.color["card.info"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
  } as any,
  specialtyChipText: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
  },
  emptyText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.muted"],
  },

  // Field rows
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
    paddingVertical: t.spacing.sm,
  },
  fieldLabel: {
    width: 80,
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
  },
  // Read-only display for a saved value. Same height + line metrics
  // as the input so toggling between read and edit doesn't reflow
  // the row's vertical position.
  fieldValueRO: {
    flex: 1,
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
    paddingVertical: t.spacing.sm,
    lineHeight: t.lineHeight.relaxed,
  } as any,
  fieldValuePlaceholder: {
    color: t.color["text.muted"],
    fontStyle: "italic",
  } as any,
  fieldInput: {
    flex: 1,
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.primary"],
    backgroundColor: t.color["card.front"],
    borderWidth: 1,
    borderColor: t.color["border.light"],
    borderRadius: t.radius.sm,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
    minHeight: 36,
    ...(Platform.OS === "web" ? { outlineStyle: "none" } : {}),
  } as any,
  fieldInputMulti: {
    minHeight: 120,
    lineHeight: t.lineHeight.relaxed,
    paddingTop: t.spacing.md,
    paddingBottom: t.spacing.md,
  } as any,
  // Pencil / cancel-X disc to the right of every editable field.
  fieldEditBtn: {
    width: 32,
    height: 32,
    borderRadius: t.radius.full,
    backgroundColor: t.color["card.info"],
    alignItems: "center",
    justifyContent: "center",
  } as any,
  // Primary save (✓) disc — dark fill so the affirmative action reads
  // as the intended next step. Sits to the right of the cream cancel
  // disc so primary lands on the right, matching the marketplace's
  // CTA placement.
  fieldSaveBtn: {
    width: 32,
    height: 32,
    borderRadius: t.radius.full,
    backgroundColor: t.color["text.primary"],
    alignItems: "center",
    justifyContent: "center",
  } as any,
  editControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
  },
  // "Show more" toggle under a truncated About blurb.
  seeMoreBtn: {
    paddingTop: t.spacing.xs,
  } as any,
  seeMoreText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["accent.cta"],
    letterSpacing: 0.3,
  },

  // Plain link button — kept because EditableField + the floating
  // back/delete buttons share its `linkBtnPressed` opacity.
  linkBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.xs,
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
  iconBtnPressed: { opacity: 0.7 } as any,

  errorText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.sm"],
    color: t.color["accent.cta"],
    paddingHorizontal: t.spacing.xl,
    paddingTop: t.spacing.md,
  },

  // Confirm-remove modal — only ever rendered as a top-level Modal,
  // never nested inside another, to avoid the iOS quirk where the
  // outer modal renders empty.
  confirmOverlayWrap: {
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
  confirmOverlayBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: t.color.overlay,
  } as any,
  confirmCard: {
    position: "relative",
    backgroundColor: t.color.bg,
    borderRadius: t.radius.lg,
    width: "92%",
    maxWidth: 480,
    overflow: "hidden",
    zIndex: 1,
  } as any,
  confirmHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.md + 2,
    borderBottomWidth: 1,
    borderBottomColor: t.color["border.light"],
  },
  confirmTitle: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.lg"],
    color: t.color["text.primary"],
    flex: 1,
    paddingRight: t.spacing.md,
  },
  confirmBody: {
    padding: t.spacing.xl,
    gap: t.spacing.md,
  },
  confirmText: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.secondary"],
    lineHeight: t.lineHeight.relaxed,
  },
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
    backgroundColor: t.color["accent.cta"],
    paddingHorizontal: t.spacing.xl,
    paddingVertical: t.spacing.md,
    borderRadius: t.radius.md,
    minHeight: 44,
  } as any,
  ctaDisabled: { opacity: 0.5 } as any,
  ctaPressed: { transform: [{ scale: 0.97 }] } as any,

  // ── Live catalog carousel ────────────────────────────────────────
  // Horizontal strip of products currently in the DB for this
  // roaster. Each card carries a corner trash affordance that
  // routes through a confirm modal before delete. Sized to fit ~2.5
  // cards on a 390-px viewport so the carousel-ness is obvious.
  liveCatalogCarousel: {
    gap: t.spacing.md,
    paddingTop: t.spacing.sm,
  } as any,
  liveCard: {
    width: 140,
    gap: t.spacing.xs,
  } as any,
  liveCardImageWrap: {
    width: 140,
    height: 140,
    borderRadius: t.radius.md,
    backgroundColor: t.color["card.info"],
    overflow: "hidden",
    position: "relative",
  } as any,
  liveCardImage: {
    width: "100%",
    height: "100%",
  } as any,
  liveCardImagePlaceholder: {
    width: "100%",
    height: "100%",
    backgroundColor: t.color["card.info"],
  } as any,
  liveCardDelete: {
    position: "absolute",
    top: t.spacing.xs,
    right: t.spacing.xs,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: t.color["text.primary"],
    alignItems: "center",
    justifyContent: "center",
    opacity: 0.92,
  } as any,
  liveCardName: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    color: t.color["text.primary"],
    lineHeight: 18,
  },
  liveCardMeta: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.xs"],
    color: t.color["text.muted"],
  },
  ctaText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.md"],
    color: t.color["text.on-dark"],
  },
});
