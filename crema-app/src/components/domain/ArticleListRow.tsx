/**
 * ArticleListRow — editorial row for the Discover JOURNALS feed.
 *
 * Layout (top → bottom):
 *
 *   • Tag · date row (small, muted)
 *   • Title (display, 3-line clamp at the `xl` size — the largest
 *     ladder size that fits the longest titles in our catalog without
 *     truncation)
 *   • Roaster byline ("By {roaster_name}")
 *   • Excerpt (regular body, full text — no clamp)
 *   • Reading-time line ("N min read", muted)
 *   • Hairline divider
 *
 * Heroes are deliberately omitted on the JOURNALS list — many roasters
 * use logo / placeholder thumbnails for their blog posts (Coffee
 * Culture, Blue Tokai, etc.) which look like noise in a list view.
 * The hero stays in the article reader where it has the space + the
 * supporting context to read as content.
 *
 * Engagement (like / comment / repost / share) used to live on this
 * row but doesn't belong here — those actions presume the user has
 * read the article. The reading-time line replaces them; the full
 * action bar lives at the bottom of the article reader.
 *
 * Distinct from `<ArticlePreviewCard>` (Figma 801:155) — that card is
 * the SHARED preview surface used by feed reposts of articles and by
 * the chat-bubble unfurl. The JOURNALS list is editorial: no card
 * chrome, no shadow, just stacked content separated by hairlines.
 *
 * Tap anywhere → /article/{id}. The byline is its own Pressable so
 * tapping the roaster name jumps to their page instead.
 *
 * Every value comes from `t.*` tokens; no inline hex / sizes / spacing
 * literals. Light + dark are handled by token resolution: `text.muted`
 * flips to a warm-brown in dark, `text.primary` flips to Crema White,
 * `divider` becomes the dark-mode line tone.
 */

import { useRouter } from "expo-router";
import { View, Text, Pressable } from "react-native";

import { t, makeStyles } from "../../tokens/useTokens";
import {
  resolveTopicLabel,
  formatArticleDate,
  estimateReadingTime,
} from "../../utils/articleMeta";
import type { RoasterArticle } from "../../resources/types";

interface ArticleListRowProps {
  article: RoasterArticle;
  /** Hide the trailing divider for the last row in a list. */
  showDivider?: boolean;
}

export default function ArticleListRow({
  article,
  showDivider = true,
}: ArticleListRowProps) {
  const router = useRouter();
  const s = useStyles();

  // Display the article's own publish date only. Falling back to
  // scraped_at would surface the scrape day (e.g. 2026-05-08 for the
  // bulk run) as the article date for the 442 / 912 rows that have
  // NULL published_at, which is misleading — those articles aren't
  // from May 2026; the source page just doesn't expose a date the
  // scraper recognized. formatArticleDate returns "" on null and the
  // row hides the date cell cleanly.
  const dateLabel = formatArticleDate(article.published_at);
  // NULL topic_category collapses into "Other" alongside explicit
  // 'other' — see resolveTopicLabel. Both states should read the
  // same on the row meta line.
  const tagLabel = resolveTopicLabel(article.topic_category);
  const readingTime = estimateReadingTime(article.word_count);

  const goToReader = () => router.push(`/article/${article.id}` as any);
  const goToRoaster = () => {
    if (article.roaster_slug)
      router.push(`/roaster/${article.roaster_slug}` as any);
  };

  return (
    <View style={s.wrap}>
      <Pressable
        testID={`article-row-${article.id}`}
        onPress={goToReader}
        accessibilityRole="link"
        accessibilityLabel={
          article.title ? `Open article: ${article.title}` : "Open article"
        }
      >
        {(tagLabel || dateLabel) ? (
          <View style={s.metaRow}>
            {tagLabel ? <Text style={s.tag}>{tagLabel}</Text> : null}
            {dateLabel ? <Text style={s.date}>{dateLabel}</Text> : null}
          </View>
        ) : null}

        <Text style={s.title} numberOfLines={3}>
          {article.title}
        </Text>

        {article.roaster_name ? (
          <Pressable onPress={goToRoaster} hitSlop={4}>
            <Text style={s.byline} numberOfLines={1}>
              By {article.roaster_name}
            </Text>
          </Pressable>
        ) : null}

        {article.excerpt ? (
          <Text style={s.excerpt}>{article.excerpt}</Text>
        ) : null}

        {readingTime ? (
          <Text style={s.readingTime}>{readingTime}</Text>
        ) : null}
      </Pressable>

      {showDivider ? <View style={s.divider} /> : null}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  // Outer wrap supplies the column padding so the divider can span
  // the same content column as the tag / title / excerpt.
  wrap: {
    paddingHorizontal: t.spacing.lg,
    paddingTop: t.spacing.lg,
  } as any,
  // Tag · date row — Inter Medium small, text.muted in both modes.
  // The two labels sit side-by-side with a generous gap; no separator
  // glyph (matches the editorial reference layout — whitespace is the
  // separator).
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.md,
    marginBottom: t.spacing.sm,
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
  // Title — display font (NewSpirit) at the `xl` ladder size. Sized
  // down from `2xl` (which clipped longer titles even at 3 lines)
  // so every title in the catalog fits the 3-line clamp without
  // truncation. text.primary flips Espresso → Crema White in dark
  // mode.
  title: {
    fontFamily: t.font.display,
    fontSize: t.size["font.xl"],
    lineHeight: 24,
    color: t.color["text.primary"],
  } as any,
  byline: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.secondary"],
    marginTop: t.spacing.sm,
  } as any,
  // Excerpt — full text (no numberOfLines clamp). The Haiku enricher
  // produces 1-3 sentence excerpts; if a future excerpt runs long
  // we'll trim at the enricher rather than truncate visually.
  excerpt: {
    fontFamily: t.font["body.regular"],
    fontSize: t.size["font.md"],
    lineHeight: 22,
    color: t.color["text.primary"],
    marginTop: t.spacing.md,
  } as any,
  // Reading time — replaces the old action bar. Same muted weight as
  // the meta row so it reads as a closing metadata line under the
  // excerpt, not a CTA.
  readingTime: {
    fontFamily: t.font["body.medium"],
    fontSize: t.size["font.sm"],
    color: t.color["text.muted"],
    marginTop: t.spacing.md,
    letterSpacing: 0.2,
  } as any,
  divider: {
    height: 1,
    backgroundColor: t.color.divider,
    marginTop: t.spacing.lg,
    // Span the full row width by negating the wrap's horizontal
    // padding — same trick the article reader's engagement strip uses.
    marginHorizontal: -t.spacing.lg,
  } as any,
}));
