/**
 * Article share URL — single source of truth.
 *
 * The article reader's ActionBar copies this URL to the clipboard.
 * The in-app chat (`<ThreadBody>`) parses every message body for the
 * matching pattern and renders an `<ArticlePreviewCard>` inside the
 * bubble when it matches.
 *
 * Format: `https://crema.app/article/{id}`. The domain isn't live
 * yet — it's a deep-link target we'll wire up to the article reader
 * once the production hostname is set up. The HTTPS prefix means
 * pasting the URL anywhere outside the app at least leaves a
 * parseable link rather than a custom-scheme dead end.
 *
 * The pattern is intentionally strict (`^...$`, optional whitespace)
 * so a typed sentence containing the URL inline doesn't accidentally
 * collapse to a preview card. The user has to paste the URL on its
 * own to get the unfurl — same heuristic Slack and other chat clients
 * use.
 */
export const articleShareUrl = (id: number | string): string =>
  `https://crema.app/article/${id}`;

export const ARTICLE_SHARE_URL_PATTERN =
  /^\s*https?:\/\/crema\.app\/article\/(\d+)\s*$/i;

/** Returns the article id when `body` is exactly the share URL,
 *  otherwise null. Use inside chat-bubble rendering to decide whether
 *  to swap the bubble for an `<ArticlePreviewCard>`. */
export function parseArticleShareUrl(body: string | null | undefined): number | null {
  if (!body) return null;
  const m = body.match(ARTICLE_SHARE_URL_PATTERN);
  if (!m) return null;
  const id = Number(m[1]);
  return Number.isFinite(id) ? id : null;
}
