/**
 * openExternal — single entrypoint for any link that leaves the site.
 *
 * Buy buttons, roaster websites, café Instagram handles, Google Maps,
 * article links in posts — everything that points outside the Crema
 * origin should route through here. Using Linking.openURL directly on
 * React Native Web replaces the current tab, which is the wrong
 * default for a discovery product (users lose their place).
 *
 * Behaviour:
 *   - Web: window.open(url, "_blank", "noopener,noreferrer"). The
 *     noopener/noreferrer pair stops the opened page from touching
 *     window.opener (anti-phishing) and strips the Referer header.
 *   - Native: falls through to Linking.openURL, which hands off to
 *     Safari / Chrome on iOS / Android — already "external" by nature.
 */

import { Linking, Platform } from "react-native";

export function openExternal(url: string | null | undefined): void {
  if (!url) return;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.open(url, "_blank", "noopener,noreferrer");
    return;
  }
  Linking.openURL(url).catch(() => { /* swallow — user-cancelled or bad URL */ });
}
