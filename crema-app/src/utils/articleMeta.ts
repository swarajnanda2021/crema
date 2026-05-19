/**
 * Article meta helpers — shared between the JOURNALS list row and the
 * chat-bubble article unfurl. Keeping them in one util means the two
 * editorial surfaces don't drift on label copy or formula.
 */

/** Lower-case `topic_category` enum → human-friendly label.
 *
 *  v4 (2026-05-14): collapsed the prior 10-bucket scheme to 7 buckets
 *  organized by consumer mental model. The backend enum source of
 *  truth is `services/article_enricher.TOPIC_CATEGORIES`. The legacy
 *  10-bucket values (`sourcing_story` / `origin_profile` /
 *  `harvest_report` / `tasting_notes` / `brew_guide` / `culture` /
 *  `health` / `industry_news` / `company_update` / `miscellaneous` /
 *  `other`) are migrated in-place at boot — they no longer appear in
 *  live data — but the legacy keys remain mapped here so any stale
 *  client cache renders the right label until the next refetch.
 */
export const TOPIC_LABELS: Record<string, string> = {
  brew: "Brew",
  roast: "Roast",
  origins: "Origins",
  taste: "Taste",
  lifestyle: "Lifestyle",
  news: "News",
  misc: "Miscellaneous",
  // Legacy v1-v3.1 keys — migrated server-side, mapped here for
  // stale-cache safety. Maps each old value to the v4 bucket it
  // collapses into.
  sourcing_story: "Origins",
  origin_profile: "Origins",
  harvest_report: "Origins",
  tasting_notes: "Taste",
  brew_guide: "Brew",
  culture: "Lifestyle",
  health: "Lifestyle",
  industry_news: "News",
  company_update: "News",
  miscellaneous: "Miscellaneous",
  other: "Miscellaneous",
};

/** Resolve an article row's `topic_category` (string | null) to its
 *  display label. NULL collapses into "Miscellaneous" so unenriched
 *  rows still get a category in the row meta and filter UI. Returns
 *  null only when the value is non-empty and not in the canonical or
 *  legacy set (a defensive fallback that hides garbage rather than
 *  mis-labeling).
 */
export function resolveTopicLabel(
  topic: string | null | undefined,
): string | null {
  if (!topic) return TOPIC_LABELS.misc;
  const known = TOPIC_LABELS[topic];
  return known ?? null;
}

/** Map any topic value — current or legacy — to the canonical v4
 *  filter bucket key. Used by the filter UI so rows surface under the
 *  same chip whether they carry a v4 value or a stale-cache legacy
 *  one. NULL / unknown collapses into `misc`.
 */
export function topicBucketKey(
  topic: string | null | undefined,
): string {
  if (!topic) return "misc";
  switch (topic) {
    // Already v4
    case "brew":
    case "roast":
    case "origins":
    case "taste":
    case "lifestyle":
    case "news":
    case "misc":
      return topic;
    // Legacy → v4
    case "sourcing_story":
    case "origin_profile":
    case "harvest_report":
      return "origins";
    case "tasting_notes":
      return "taste";
    case "brew_guide":
      return "brew";
    case "culture":
    case "health":
      return "lifestyle";
    case "industry_news":
    case "company_update":
      return "news";
    case "miscellaneous":
    case "other":
      return "misc";
    default:
      return "misc";
  }
}

/** The 7 topic chips, in the order they should appear in the filter
 *  bar. Order follows the cascade priority in `_ARTICLE_SYSTEM` so
 *  the most-distinctive subjects (brew / roast / origins / taste)
 *  surface first, then the relational buckets (lifestyle / news),
 *  with Miscellaneous last as the catch-all. */
export const TOPIC_CHIPS: Array<{ key: string; label: string }> = [
  { key: "brew", label: TOPIC_LABELS.brew },
  { key: "roast", label: TOPIC_LABELS.roast },
  { key: "origins", label: TOPIC_LABELS.origins },
  { key: "taste", label: TOPIC_LABELS.taste },
  { key: "lifestyle", label: TOPIC_LABELS.lifestyle },
  { key: "news", label: TOPIC_LABELS.news },
  { key: "misc", label: TOPIC_LABELS.misc },
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
