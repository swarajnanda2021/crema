/**
 * Article meta helpers — shared between the JOURNALS list row and the
 * chat-bubble article unfurl. Keeping them in one util means the two
 * editorial surfaces don't drift on label copy or formula.
 */

/** Lower-case `topic_category` enum → human-friendly label. The enum
 *  set is fixed in `services/article_enricher.TOPIC_CATEGORIES`. The
 *  "other" bucket is intentionally absent — call sites should hide
 *  the tag entirely when the lookup misses (otherwise "Other" reads
 *  as noise on every fallback row).
 */
export const TOPIC_LABELS: Record<string, string> = {
  sourcing_story: "Sourcing story",
  brew_guide: "Brew guide",
  origin_profile: "Origin profile",
  industry_news: "Industry news",
  harvest_report: "Harvest report",
  tasting_notes: "Tasting notes",
  company_update: "Company update",
};

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
