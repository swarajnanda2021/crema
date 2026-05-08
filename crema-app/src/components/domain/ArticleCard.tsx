/**
 * ArticleCard — chronological feed card for the Discover JOURNALS
 * tab.
 *
 * Thin wrapper around the canonical `<ArticlePreviewCard>` (Figma
 * 801:155): white card, display heading, parent-domain pill
 * (e.g. `sprudge.com`), hero image inside an inner rounded card.
 * Same card shape that PostCard uses for `post_type === "article"`,
 * so URL uploads in the feed and articles in the JOURNALS tab read
 * as one design.
 *
 * Tap → /article/{id}. The reader screen hydrates synchronously
 * from `RoasterArticlesProvider` so navigation is instant.
 *
 * Roaster identity (RoasterLogo, name, date, reading time) used to
 * sit in a meta row below the title — that information is now
 * communicated via the JOURNALS roaster strip + the article reader,
 * not duplicated on every card. Same with `excerpt`: the Figma
 * spec drops it, and the Haiku enricher no longer produces a
 * `summary` field anyway.
 */

import { useRouter } from "expo-router";

import type { RoasterArticle } from "../../resources/types";
import ArticlePreviewCard from "./ArticlePreviewCard";

interface ArticleCardProps {
  article: RoasterArticle;
  /** Width prop kept for backwards-compat with existing call sites
   *  that pass a resolved column width. The new card fills its
   *  parent's width via flex/100%, so the prop is currently unused —
   *  retained so call sites don't break. */
  width?: number;
}

export default function ArticleCard({ article }: ArticleCardProps) {
  const router = useRouter();

  return (
    <ArticlePreviewCard
      title={article.title}
      sourceUrl={article.url}
      imageUrl={article.image_url}
      onPress={() => router.push(`/article/${article.id}` as any)}
      accessibilityLabel={
        article.title ? `Open article: ${article.title}` : "Open article"
      }
    />
  );
}
