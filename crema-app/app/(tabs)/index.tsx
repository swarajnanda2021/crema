import { Redirect } from "expo-router";

/**
 * Catalog-only build: the social feed that used to live at `/` was
 * removed. The catalog (Discover) is the landing now, so `/` redirects
 * to `/browse`. The full social feed is preserved at git tag `social-v1`.
 */
export default function Index() {
  return <Redirect href="/browse" />;
}
