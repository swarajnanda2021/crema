/**
 * RoasterLogo — the canonical roaster identity surface site-wide.
 *
 * Square, rounded-corner. Always renders the logo on a cream
 * (`t.color.bg`) background so transparent PNGs don't bleed onto
 * whatever the parent surface is. `contentFit="contain"` so the
 * logo's own aspect ratio is preserved (logos don't get cropped to
 * fill).
 *
 * Two variants:
 *   • `default` — bare rounded square. Used in lists, search rows,
 *     and any context where the logo sits on a flat parent.
 *   • `hero-overlap` — adds a 4-px cream ring so the square pops off
 *     a colored hero band. Used on the consumer + admin roaster
 *     pages where the logo overlaps the hero/about seam.
 *
 * NOT used for user/person avatars — those continue to render via
 * `CroppedAvatar` (always circular). The split is semantic:
 *   • Roaster identity → rounded square (this primitive)
 *   • Person identity → circle (`CroppedAvatar`)
 *
 * Where the user posts in the feed, the author avatar IS a person
 * (the roaster account user) and uses `CroppedAvatar` — the roaster
 * logo is mirrored to `users.avatar_url` via `sync_roaster_logo_to_user`,
 * so the same image renders circular in social contexts and
 * rounded-square in identity contexts. That's intentional — the same
 * bitmap, two visual languages, one for "who's posting" and one for
 * "this is the brand."
 */

import { Image } from "expo-image";
import { View, Text, StyleSheet } from "react-native";

import { t, makeStyles } from "../../tokens/useTokens";
import { resolveUploadUrl } from "../../api/client";

interface RoasterLogoProps {
  url?: string | null;
  size: number;
  /** Used for the Canela / NewSpirit fallback letter when no logo. */
  fallbackInitial?: string;
  variant?: "default" | "hero-overlap";
}

export default function RoasterLogo({
  url,
  size,
  fallbackInitial,
  variant = "default",
}: RoasterLogoProps) {
  const ringWidth = variant === "hero-overlap" ? 4 : 0;
  // Initial font scales with the box — ~38% of the box reads as a
  // confident monogram without crowding the corners.
  const initialFontSize = Math.round(size * 0.38);
  const s = useStyles();

  return (
    <View
      style={[
        s.box,
        {
          width: size,
          height: size,
          borderWidth: ringWidth,
          borderRadius: t.radius.lg,
        },
      ]}
    >
      {url ? (
        <Image
          source={{ uri: resolveUploadUrl(url) || url }}
          style={StyleSheet.absoluteFillObject as any}
          contentFit="contain"
          transition={200}
        />
      ) : (
        <Text
          style={[s.initial, { fontSize: initialFontSize }]}
          allowFontScaling={false}
        >
          {(fallbackInitial || "?")[0].toUpperCase()}
        </Text>
      )}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  // Roaster identity is always presented on a Crema White (#FAF8F0)
  // surface — both modes — so transparent-PNG logos read consistently
  // and the logo doesn't blend into a dark page bg in night mode.
  box: {
    backgroundColor: t.color["bg.identity"],
    borderColor: t.color["bg.identity"],
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
  } as any,
  initial: {
    fontFamily: t.font.display,
    color: t.color["text.on-light"],
    lineHeight: undefined,
  } as any,
}));
