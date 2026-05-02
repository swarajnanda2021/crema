/**
 * imageUrl — small CDN-aware thumbnail helpers.
 *
 * The scraper stores the canonical full-resolution image URL for each
 * product (`clean_image_url` in `Scraper/scraper/utils.py` strips
 * Shopify size suffixes so the catalog isn't pinned to one variant).
 * Rendering that full-res image into a 240-px CoffeeCard means we ship
 * a 1500–3000-px-wide JPG over the wire for every card on Discover —
 * the dominant first-load cost and the user-visible "slow image pop"
 * after the page paints.
 *
 * `thumbnailUrl(url, w)` re-attaches a size hint when the CDN supports
 * server-side resize:
 *
 *   • **Shopify** (`cdn.shopify.com`) honors `?width=N`, returning a
 *     resized variant from the CDN. Cheap, cache-friendly, free.
 *   • **WordPress / WooCommerce** (`/wp-content/uploads/...`) doesn't
 *     have a portable resize query — most sites need a server plugin.
 *     We pass the URL through unchanged so the original still loads.
 *   • **Anything else** (custom hosts, our own `/uploads/...` files,
 *     external URLs from articles): also passed through.
 *
 * Even covering Shopify alone shrinks ~60% of catalog images from
 * megabytes to tens of kilobytes per card.
 */

export function thumbnailUrl(
  url: string | null | undefined,
  width = 480,
): string | null {
  if (!url) return null;
  // Shopify CDN supports `?width=N` (and `&width=N` when other query
  // params already exist, e.g. `?v=...`). The CDN returns a resized
  // variant from cache.
  if (url.includes("cdn.shopify.com")) {
    if (/[?&]width=/.test(url)) return url; // already sized
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}width=${width}`;
  }
  return url;
}
