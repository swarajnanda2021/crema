/**
 * CRUD Utopia — admin-only catalog ops surface. Mirrors TractionDashboard's
 * structural moves (sub-tab carousel, header, body) so the two top-level
 * admin tabs feel like one product. Every visual value reads from
 * design-tokens.json via useTokens.
 *
 * Two sub-tabs:
 *   • Scraper — runs the existing Scraper/ pipeline on demand, edits the
 *     list of roaster URLs the catalog tracks.
 *   • Taste Graph — runs Haiku classification on un-geolocated flavor
 *     tags, uploads + activates new SCA trees.
 *
 * Long-running work fans out to FastAPI BackgroundTasks; this surface
 * polls /api/jobs/{id} every 2 s while a job is live. See
 * LAUNCH_TODO §3.8 for the prod-deployment hardening that's parked.
 */

import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
} from "react-native";

import { t, makeStyles } from "../../tokens/useTokens";
import RoastersPanel from "./RoastersPanel";
import StandardizationPanel from "./StandardizationPanel";
import ArticlesPanel from "./ArticlesPanel";
import RefreshCatalogPanel from "./RefreshCatalogPanel";

export type CatalogOpsSection =
  | "roasters"
  | "refresh"
  | "standardization"
  | "articles";

const SECTIONS: CatalogOpsSection[] = [
  "roasters",
  "refresh",
  "standardization",
  "articles",
];

const SECTION_LABEL: Record<CatalogOpsSection, string> = {
  roasters: "ROASTERS & BEANS",
  refresh: "REFRESH CATALOG",
  standardization: "STANDARDIZATION",
  articles: "JOURNAL OPS",
};

const SECTION_TITLE: Record<CatalogOpsSection, string> = {
  roasters: "Roasters & Beans",
  refresh: "Refresh Catalog",
  standardization: "Catalog Standardization",
  articles: "Roaster Journal",
};

const SECTION_BLURB: Record<CatalogOpsSection, string> = {
  roasters: "Manage roaster identities + run per-roaster bean enrichment from the same surface.",
  refresh: "Diff each roaster's website against the last snapshot — re-enrich only what changed. Cheap maintenance refresh, distinct from the full re-baseline that Roasters & Beans triggers.",
  standardization: "Five sequential Haiku passes that map tasting notes, origins, varietals, roast levels, and processes onto Crema canonical references.",
  articles: "Discover, refresh, and curate the blog articles each roaster publishes. Tap a row to expand its site-quirk hint and per-article controls. Multi-select rows to scope a refresh.",
};

export default function CatalogOps() {
  const [section, setSection] = useState<CatalogOpsSection>("roasters");
  const s = useStyles();

  const subTabs = (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={s.subTabRow}
    >
      {SECTIONS.map((key) => {
        const active = key === section;
        return (
          <Pressable key={key} onPress={() => setSection(key)} style={s.subTab}>
            <Text
              style={[
                s.subTabText,
                active ? s.subTabTextActive : s.subTabTextInactive,
              ]}
            >
              {SECTION_LABEL[key]}
            </Text>
            {active ? <View style={s.subTabUnderline} /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );

  return (
    <View style={s.wrap}>
      <View style={s.header}>
        <View style={{ flex: 1 }}>
          <Text style={s.title}>{SECTION_TITLE[section]}</Text>
          <Text style={s.blurb}>{SECTION_BLURB[section]}</Text>
        </View>
      </View>
      {subTabs}
      {/* Plain conditional render of the active panel. Earlier we
          tried `display: 'none'` and an off-screen `position: 'absolute'`
          mount to keep the inactive panel React-alive across sub-tab
          flips (so polling timers + submit-error strings survived).
          Both broke vertical scroll on iOS — the hidden panel's
          subviews kept entering the layout / hit-test tree and
          swallowed scroll touches. The async-job backend already
          handles state continuity (see `_apply_roaster_enrichment`
          and the orphan-recovery on server boot), so dropping the
          UI-side polling state on tab flip is a tolerable trade.
          When the user flips back, the panel re-mounts and its
          first poll re-attaches to whatever job is still running. */}
      <View style={{ gap: t.spacing.xl }}>
        {section === "roasters" ? (
          <RoastersPanel />
        ) : section === "refresh" ? (
          <RefreshCatalogPanel />
        ) : section === "articles" ? (
          <ArticlesPanel />
        ) : (
          <StandardizationPanel />
        )}
      </View>
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  wrap: {
    paddingHorizontal: t.spacing.xl,
    paddingTop: t.spacing.xl,
    paddingBottom: t.spacing["4xl"],
    gap: t.spacing.xl,
  },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: t.spacing.md,
  },
  title: {
    fontFamily: t.font.display,
    fontSize: t.size["font.display"],
    lineHeight: 42,
    color: t.color["text.primary"],
  },
  blurb: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    color: t.color["text.secondary"],
    marginTop: t.spacing.xs,
  },
  subTabRow: {
    flexDirection: "row",
    alignItems: "stretch",
    gap: t.spacing["3xl"],
    borderBottomWidth: 1,
    borderBottomColor: t.color.divider,
    paddingBottom: 0,
    height: 48,
  },
  subTab: {
    justifyContent: "center",
    position: "relative",
  } as any,
  subTabText: {
    fontFamily: t.font["body.semibold"],
    fontSize: t.size["font.sm"],
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  subTabTextInactive: { color: t.color["text.muted"] },
  subTabTextActive: { color: t.color["text.primary"] },
  subTabUnderline: {
    position: "absolute",
    bottom: -1,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: t.color["text.primary"],
  } as any,
}));
