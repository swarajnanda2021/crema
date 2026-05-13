/**
 * Article meta helpers — shared between the JOURNALS list row and the
 * chat-bubble article unfurl. Keeping them in one util means the two
 * editorial surfaces don't drift on label copy or formula.
 */

/** Lower-case `topic_category` enum → human-friendly label. The enum
 *  set is fixed in `services/article_enricher.TOPIC_CATEGORIES`.
 *
 *  v3.1 (2026-05-10): the catch-all `other` bucket was subdivided
 *  into `culture` / `health` / `miscellaneous`. Legacy rows that
 *  still carry `topic_category='other'` (or NULL) collapse into
 *  "Miscellaneous" on display until they're re-enriched. The
 *  filter chip key for those rows is `miscellaneous` — see
 *  `topicBucketKey` — so they remain selectable from one chip
 *  without splitting old data across multiple chips.
 */
export const TOPIC_LABELS: Record<string, string> = {
  sourcing_story: "Sourcing story",
  brew_guide: "Brew guide",
  origin_profile: "Origin profile",
  industry_news: "Industry news",
  harvest_report: "Harvest report",
  tasting_notes: "Tasting notes",
  company_update: "Company update",
  culture: "Culture",
  health: "Health",
  miscellaneous: "Miscellaneous",
  // Legacy — pre-v3.1 rows; renders as "Miscellaneous" in the row
  // meta and groups under the same chip in the filter UI.
  other: "Miscellaneous",
};

/** Resolve an article row's `topic_category` (string | null) to its
 *  display label — null collapses into "Miscellaneous" so
 *  unenriched / legacy rows still get a category in the row meta and
 *  the filter UI. Returns null only when the value is non-empty and
 *  not in the canonical set (a defensive fallback that hides garbage
 *  rather than mis-labeling).
 */
export function resolveTopicLabel(
  topic: string | null | undefined,
): string | null {
  if (!topic) return TOPIC_LABELS.miscellaneous;
  const known = TOPIC_LABELS[topic];
  return known ?? null;
}

/** Canonical filter bucket key for `topic_category`. NULL + 'other'
 *  collapse into the `miscellaneous` bucket so legacy rows surface
 *  under the same chip as new rows that Haiku tagged as
 *  `miscellaneous`. */
export function topicBucketKey(
  topic: string | null | undefined,
): string {
  if (!topic) return "miscellaneous";
  if (topic === "other") return "miscellaneous";
  return TOPIC_LABELS[topic] ? topic : "miscellaneous";
}

/** The 10 topic chips, in the order they should appear in the filter
 *  bar. Editorial topics first (Sourcing → Tasting → Harvest →
 *  Industry → Company), then the lifestyle pair (Culture → Health),
 *  with Miscellaneous last as the catch-all. */
export const TOPIC_CHIPS: Array<{ key: string; label: string }> = [
  { key: "sourcing_story", label: TOPIC_LABELS.sourcing_story },
  { key: "origin_profile", label: TOPIC_LABELS.origin_profile },
  { key: "brew_guide", label: TOPIC_LABELS.brew_guide },
  { key: "tasting_notes", label: TOPIC_LABELS.tasting_notes },
  { key: "harvest_report", label: TOPIC_LABELS.harvest_report },
  { key: "industry_news", label: TOPIC_LABELS.industry_news },
  { key: "company_update", label: TOPIC_LABELS.company_update },
  { key: "culture", label: TOPIC_LABELS.culture },
  { key: "health", label: TOPIC_LABELS.health },
  { key: "miscellaneous", label: TOPIC_LABELS.miscellaneous },
];

/** Format an ISO timestamp as "5 May 2026". Returns "" when the input
 *  is null / unparseable so callers can hide the line cleanly. */
export function formatArticleDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (!ms) return "";
  return new Date(ms).toLocaleString("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "N min read" from a word count — "" when missing. 200 wpm is the
 *  same divisor the article reader uses for its meta line. */
export function estimateReadingTime(words: number | null | undefined): string {
  if (!words || words <= 0) return "";
  const minutes = Math.max(1, Math.round(words / 200));
  return `${minutes} min read`;
}
