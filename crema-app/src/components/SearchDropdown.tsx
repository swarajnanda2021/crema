/**
 * SearchDropdown — navbar sitewide search (§2.11).
 *
 * Mirrors the site's dropdown language (messages, notifications,
 * profile). Click the navbar glass → dropdown opens below the icon
 * with a styled cream-backed input at the top and four result
 * sections below: Users, Beans, Roasters, Cafés.
 *
 * Behaviour:
 *   - Typing narrows all four sections live. Users hit the backend
 *     (`/users/search?q=...`); the other three filter local caches
 *     (useCoffeeData + useCafes) — cheap and offline-friendly.
 *   - Each section caps at 5 rows; a "See all" affordance routes to
 *     Discover with the query pre-filled.
 *   - Rows navigate and close the dropdown.
 *   - Beans intentionally skip the product image — keeps rows tight
 *     and readable, matches the user's §2.11 call.
 *   - Outside-click dismissal on web, same pattern as
 *     MessagesDropdown / NotificationsDropdown.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, Pressable, TextInput, ScrollView, StyleSheet, Platform,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { Search as SearchIcon, X } from "lucide-react-native";
import { t, cardShadow } from "../tokens/useTokens";
import { apiFetchRaw, resolveUploadUrl } from "../api/client";
import { useCoffeeData } from "../hooks/useCoffeeData";
import { useCafes } from "../hooks/useCafes";
import { CroppedAvatar } from "./primitives";

interface Props {
  visible: boolean;
  onClose: () => void;
}

interface UserHit {
  id: number;
  username: string;
  display_name: string;
  avatar_url: string | null;
  avatar_crop_x?: number | null;
  avatar_crop_y?: number | null;
  avatar_zoom?: number | null;
  location?: string | null;
}

// Bumped from 5 to 8 per section once the dropdown turned into a
// real floating modal — the extra vertical space made 5 feel tight.
const SECTION_LIMIT = 8;

export default function SearchDropdown({ visible, onClose }: Props) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [ready, setReady] = useState(false);
  const [userHits, setUserHits] = useState<UserHit[]>([]);
  const cardRef = useRef<any>(null);
  const inputRef = useRef<any>(null);
  const debounceRef = useRef<any>(null);

  const { products, roasters } = useCoffeeData();
  const { cafes } = useCafes();

  // Local (cached) filtering for beans / roasters / cafés.
  const q = query.trim().toLowerCase();
  const beanHits = useMemo(() => {
    if (!q) return [] as any[];
    return (products as any[])
      .filter((p) => (p.available !== false && p.available !== 0)
        && ((p.coffee_name || "").toLowerCase().includes(q)
          || (p.roaster_name || "").toLowerCase().includes(q)
          || (p.origin || "").toLowerCase().includes(q)
          || (p.tasting_notes || "").toLowerCase().includes(q)))
      .slice(0, SECTION_LIMIT);
  }, [products, q]);

  const roasterHits = useMemo(() => {
    if (!q) return [] as any[];
    return (roasters as any[])
      .filter((r) => (r.name || "").toLowerCase().includes(q)
        || (r.city || "").toLowerCase().includes(q))
      .slice(0, SECTION_LIMIT);
  }, [roasters, q]);

  const cafeHits = useMemo(() => {
    if (!q) return [] as any[];
    return cafes
      .filter((c) => (c.name || "").toLowerCase().includes(q)
        || (c.city || "").toLowerCase().includes(q)
        || (c.about_blurb || "").toLowerCase().includes(q))
      .slice(0, SECTION_LIMIT);
  }, [cafes, q]);

  // Users hit the backend. Debounced 200ms to avoid a request per
  // keystroke on fast typers.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!q) { setUserHits([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await apiFetchRaw<any>(`/users/search?q=${encodeURIComponent(q)}&limit=${SECTION_LIMIT}`);
        const data = res?.data ?? res;
        setUserHits(Array.isArray(data) ? data : []);
      } catch {
        setUserHits([]);
      }
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  // Focus + fade-in on open; reset on close.
  useEffect(() => {
    if (visible) {
      const h = setTimeout(() => {
        setReady(true);
        inputRef.current?.focus?.();
      }, 50);
      return () => { clearTimeout(h); setReady(false); };
    } else {
      const h = setTimeout(() => { setQuery(""); setUserHits([]); }, 180);
      return () => clearTimeout(h);
    }
  }, [visible]);

  // Outside-click dismissal (web). Same pattern as the other
  // navbar dropdowns. Armed after 150ms so the opening click
  // doesn't instantly close the panel.
  useEffect(() => {
    if (!visible || Platform.OS !== "web") return;
    let armed = false;
    const armTimer = setTimeout(() => { armed = true; }, 150);
    const handler = (e: MouseEvent) => {
      if (!armed) return;
      const card = cardRef.current as any;
      const target = e.target as Node;
      if (card && typeof card.contains === "function" && card.contains(target)) return;
      const navbar = (typeof document !== "undefined")
        ? document.querySelector('[data-role="navbar"]') : null;
      if (navbar && (navbar as any).contains && (navbar as any).contains(target)) return;
      onClose();
    };
    if (typeof document !== "undefined") {
      document.addEventListener("click", handler);
    }
    return () => {
      clearTimeout(armTimer);
      if (typeof document !== "undefined") {
        document.removeEventListener("click", handler);
      }
    };
  }, [visible, onClose]);

  if (!visible) return null;

  const goto = (path: string) => {
    onClose();
    // Small delay so the dropdown's fade-out isn't interrupted by
    // the navigation animation on web.
    setTimeout(() => router.push(path as any), 40);
  };

  const anyResults = userHits.length + beanHits.length + roasterHits.length + cafeHits.length > 0;

  // §2.11 — navbar-pinned dropdown. Matches the messages /
  // notifications / profile pattern exactly: no backdrop, no
  // centered modal, just a floating card beneath the search icon.
  // The earlier "See all results for X" affordance was dropped
  // because it kicked to /browse?q=... which didn't actually
  // filter — the dropdown IS the search surface now.
  const cardPositionStyle = Platform.OS === "web"
    ? { position: "fixed" as any, top: 72, right: 90, zIndex: 9999 }
    : { position: "absolute" as any, top: 8, right: 40, zIndex: 9999 };

  return (
    <View
      ref={cardRef}
      style={[s.card, cardPositionStyle, !ready && { opacity: 0 }]}
      pointerEvents="box-none"
    >
      {/* Styled input. Replaces the raw browser-default focus ring
         with the cream-field look used in the rest of the site. */}
      <View style={s.inputWrap}>
        <SearchIcon size={16} color={t.color["text.muted"]} />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          placeholder="Search users, beans, roasters, cafés"
          placeholderTextColor={t.color["text.muted"]}
          style={s.input}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {query ? (
          <Pressable onPress={() => setQuery("")} hitSlop={6}>
            <X size={14} color={t.color["text.muted"]} />
          </Pressable>
        ) : null}
      </View>
      <View style={s.divider} />

      <ScrollView style={s.results} showsVerticalScrollIndicator={false}>
        {!q ? (
          <Text style={s.hint}>Start typing to find users, beans, roasters, and cafés.</Text>
        ) : !anyResults ? (
          <Text style={s.hint}>No matches for "{q}".</Text>
        ) : (
          <>
            {userHits.length > 0 && (
              <Section label="Users">
                {userHits.map((u) => (
                  <Pressable
                    key={`u-${u.id}`}
                    onPress={() => goto(`/user/${u.username}`)}
                    style={({ pressed }: any) => [s.row, pressed && s.rowPressed]}
                  >
                    {u.avatar_url ? (
                      <CroppedAvatar
                        url={u.avatar_url}
                        cropX={u.avatar_crop_x ?? undefined}
                        cropY={u.avatar_crop_y ?? undefined}
                        zoom={u.avatar_zoom ?? undefined}
                        size={28}
                      />
                    ) : (
                      <View style={s.avatarFb}>
                        <Text style={s.avatarLetter}>{(u.display_name || u.username || "?")[0].toUpperCase()}</Text>
                      </View>
                    )}
                    <View style={s.rowText}>
                      <Text style={s.rowTitle} numberOfLines={1}>{u.display_name || u.username}</Text>
                      {u.location ? <Text style={s.rowMeta} numberOfLines={1}>{u.location}</Text> : null}
                    </View>
                  </Pressable>
                ))}
              </Section>
            )}

            {beanHits.length > 0 && (
              <Section label="Beans">
                {beanHits.map((b: any) => (
                  <Pressable
                    key={`b-${b.product_id}`}
                    onPress={() => goto(`/coffee/${b.product_id}`)}
                    style={({ pressed }: any) => [s.row, pressed && s.rowPressed]}
                  >
                    {/* §2.11 — no image for beans by design; keeps
                       rows tight and text-scannable. */}
                    <View style={s.beanDot} />
                    <View style={s.rowText}>
                      <Text style={s.rowTitle} numberOfLines={1}>{b.coffee_name}</Text>
                      <Text style={s.rowMeta} numberOfLines={1}>
                        {b.roaster_name}{b.roast_level ? ` \u00B7 ${b.roast_level}` : ""}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </Section>
            )}

            {roasterHits.length > 0 && (
              <Section label="Roasters">
                {roasterHits.map((r: any) => (
                  <Pressable
                    key={`r-${r.roaster_slug}`}
                    onPress={() => goto(`/roaster/${r.roaster_slug}`)}
                    style={({ pressed }: any) => [s.row, pressed && s.rowPressed]}
                  >
                    {r.logo_url ? (
                      <Image source={{ uri: resolveUploadUrl(r.logo_url) }} style={s.thumb} />
                    ) : (
                      <View style={s.thumbFb}>
                        <Text style={s.avatarLetter}>{(r.name || "?")[0]}</Text>
                      </View>
                    )}
                    <View style={s.rowText}>
                      <Text style={s.rowTitle} numberOfLines={1}>{r.name}</Text>
                      {r.city ? <Text style={s.rowMeta} numberOfLines={1}>{r.city}</Text> : null}
                    </View>
                  </Pressable>
                ))}
              </Section>
            )}

            {cafeHits.length > 0 && (
              <Section label="Cafés">
                {cafeHits.map((c: any) => (
                  <Pressable
                    key={`c-${c.cafe_slug}`}
                    onPress={() => goto(`/cafe/${c.cafe_slug}`)}
                    style={({ pressed }: any) => [s.row, pressed && s.rowPressed]}
                  >
                    {c.logo_url || c.cover_image_url ? (
                      <Image source={{ uri: resolveUploadUrl(c.logo_url || c.cover_image_url) }} style={s.thumb} />
                    ) : (
                      <View style={s.thumbFb}>
                        <Text style={s.avatarLetter}>{(c.name || "?")[0]}</Text>
                      </View>
                    )}
                    <View style={s.rowText}>
                      <Text style={s.rowTitle} numberOfLines={1}>{c.name}</Text>
                      {c.city ? <Text style={s.rowMeta} numberOfLines={1}>{c.city}</Text> : null}
                    </View>
                  </Pressable>
                ))}
              </Section>
            )}

          </>
        )}
      </ScrollView>
    </View>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={s.section}>
      <Text style={s.sectionLabel}>{label}</Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    width: 380,
    maxHeight: 540,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    overflow: "hidden",
    ...cardShadow,
    shadowOpacity: 0.15,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  } as any,

  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
  } as any,
  input: {
    flex: 1,
    fontFamily: t.font["body.regular"],
    fontSize: 13,
    color: t.color["text.primary"],
    paddingVertical: 4,
    ...(Platform.OS === "web" ? { outlineStyle: "none" } : {}),
  } as any,
  divider: { height: 1, backgroundColor: "#EDE8E1", marginHorizontal: 12 },

  results: { maxHeight: 460 } as any,
  hint: {
    fontFamily: t.font["body.regular"], fontSize: 11.5,
    color: t.color["text.muted"], textAlign: "center",
    paddingVertical: 28, paddingHorizontal: 18, lineHeight: 16,
  } as any,

  section: { paddingVertical: 6 } as any,
  sectionLabel: {
    fontFamily: t.font["body.semibold"], fontSize: 10,
    color: t.color["text.muted"],
    letterSpacing: 0.6,
    textTransform: "uppercase",
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4,
  } as any,

  row: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 6,
  } as any,
  rowPressed: { backgroundColor: "rgba(215,152,218,0.12)" },
  rowText: { flex: 1, minWidth: 0 } as any,
  rowTitle: { fontFamily: t.font["body.semibold"], fontSize: 12.5, color: t.color["text.primary"] },
  rowMeta: { fontFamily: t.font["body.regular"], fontSize: 10.5, color: t.color["text.muted"], marginTop: 1 },

  thumb: { width: 28, height: 28, borderRadius: 6 } as any,
  thumbFb: {
    width: 28, height: 28, borderRadius: 6,
    backgroundColor: t.color["card.info"],
    alignItems: "center", justifyContent: "center",
  } as any,
  avatarFb: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: t.color["text.primary"],
    alignItems: "center", justifyContent: "center",
  } as any,
  avatarLetter: {
    fontFamily: t.font["body.semibold"], fontSize: 11, color: "#FAF8F0",
  },
  beanDot: {
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: t.color["text.primary"],
    marginHorizontal: 11,
  } as any,

  // `seeAll` / `seeAllText` styles were dropped when the "See all
  // results for X" affordance was removed — it just kicked users
  // to /browse?q=... which didn't actually filter. The modal is
  // the search experience; if users need more they tap through.
});
