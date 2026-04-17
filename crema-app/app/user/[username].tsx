/**
 * Public user profile page — same Figma layout as own profile,
 * but read-only with Follow button instead of Edit.
 *
 * Ported faithfully from main with CRUD Utopia imports/API.
 */

import { useEffect, useState, useCallback, useRef } from "react";
import {
  View, Text, ScrollView, Pressable, RefreshControl,
  StyleSheet, useWindowDimensions, LayoutChangeEvent, ActivityIndicator,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Plus, Check, MessageCircle } from "lucide-react-native";
import Svg, { Path } from "react-native-svg";

import { useAuth } from "../../src/hooks/useAuth";
import { useShelves } from "../../src/hooks/useShelves";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useCafeResolver } from "../../src/hooks/useCafeResolver";
import { apiFetchRaw, resolveUploadUrl } from "../../src/api/client";
import { t, SHELF_LABELS } from "../../src/tokens/useTokens";

import PostCard from "../../src/components/domain/PostCard";
import { openPostModal } from "../../src/components/primitives";
import CoffeeCard from "../../src/components/CoffeeCard";
import Navbar from "../../src/components/Navbar";
import StampBookList from "../../src/components/StampBookList";

type ProfileTab = "posts" | "shelf" | "stamps" | "following";
type ShelfKey = "open_bags" | "on_the_list";
const SHELF_KEYS: ShelfKey[] = ["open_bags", "on_the_list"];
const SHELF_SECTION_LABELS: Record<ShelfKey, string> = {
  open_bags: "Open Bags",
  on_the_list: "On the List",
};

// ── Hero icons (Figma-faithful, #D798DA, ~15px) ─────────────────────────────

function HeroCoffeeIcon() {
  return (
    <Svg width={15} height={15} viewBox="0 0 16.55 16.55" fill="none">
      <Path d="M0.75 15.8H6.556M6.556 15.8H6.651M6.556 15.8C3.345 15.775 0.75 13.01 0.75 9.604V5.994C0.75 5.543 1.095 5.177 1.522 5.177H11.685C12.111 5.177 12.457 5.543 12.457 5.994V6.062M6.651 15.8H12.457M6.651 15.8C9.862 15.775 12.457 13.01 12.457 9.604M12.457 6.062H13.711C14.866 6.062 15.802 7.053 15.802 8.276C15.802 9.498 14.866 10.489 13.711 10.489H12.457V9.604M12.457 6.062V9.604M9.948 0.75L9.112 2.521M7.44 0.75L6.603 2.521M4.931 0.75L4.095 2.521" stroke={t.color.accent} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function HeroHeartIcon() {
  return (
    <Svg width={15} height={14} viewBox="0 0 16.97 16" fill="none">
      <Path d="M8.483 3.616C6.765 -0.649 0.75 -0.195 0.75 5.256C0.75 10.708 8.483 15.25 8.483 15.25C8.483 15.25 16.217 10.708 16.217 5.256C16.217 -0.195 10.202 -0.649 8.483 3.616Z" stroke={t.color.accent} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function HeroBeanIcon() {
  return (
    <Svg width={15} height={15} viewBox="0 0 15 15" fill="none">
      <Path d="M5.032 0.023C3.93 0.114 2.917 0.471 2.107 1.048C1.301 1.629 0.569 2.663 0.237 3.683C0.039 4.282 -0.004 4.579 0 5.298C0.013 7.989 0.875 10.017 2.831 11.972C4.649 13.789 6.812 14.827 9.104 14.99C9.897 15.046 10.995 14.857 11.732 14.538C13.442 13.798 14.442 12.558 14.877 10.637C15.006 10.069 15.041 8.979 14.946 8.334C14.657 6.362 13.688 4.523 12.094 2.93C11.366 2.202 10.741 1.72 9.785 1.152C8.371 0.303 6.644 -0.106 5.032 0.023ZM6.799 1.617C9.978 2.284 12.895 5.251 13.395 8.329C13.498 8.975 13.468 10.146 13.33 10.637C13.244 10.947 13.244 10.951 12.865 10.779C12.37 10.551 11.904 10.418 11.344 10.34C10.116 10.164 9.436 9.832 8.932 9.152C8.535 8.618 8.423 8.316 8.242 7.343C7.988 5.948 7.652 5.233 6.924 4.514C6.54 4.131 6.023 3.774 5.519 3.533C5.166 3.365 4.58 3.21 3.882 3.106C3.27 3.012 2.598 2.783 2.598 2.667C2.598 2.512 3.723 1.823 4.201 1.685C4.959 1.466 5.954 1.44 6.799 1.617ZM2.62 4.394C2.801 4.45 3.262 4.557 3.645 4.631C4.589 4.811 4.804 4.872 5.205 5.078C5.627 5.294 6.006 5.655 6.256 6.09C6.506 6.512 6.571 6.723 6.73 7.623C6.945 8.803 7.161 9.371 7.63 9.983C8.234 10.775 9.177 11.429 10.013 11.645C10.194 11.692 10.56 11.761 10.832 11.8C11.34 11.873 11.68 11.955 12.171 12.131L12.46 12.235L12.322 12.385C11.848 12.902 10.969 13.285 9.944 13.419C9.466 13.479 8.639 13.449 8.178 13.35C7.079 13.122 5.756 12.48 4.774 11.701C4.33 11.352 3.361 10.387 3.055 9.991C2.374 9.122 1.93 8.08 1.65 6.71C1.457 5.772 1.444 5.38 1.581 4.704C1.642 4.398 1.693 4.114 1.693 4.067C1.693 3.989 1.719 3.998 1.995 4.135C2.159 4.217 2.443 4.334 2.62 4.394Z" fill={t.color.accent} />
    </Svg>
  );
}

function HeroPeopleIcon() {
  return (
    <Svg width={18} height={15} viewBox="0 0 19.56 16.55" fill="none">
      <Path d="M18.812 15.802C18.812 14.054 17.137 12.567 14.798 12.016M12.791 15.802C12.791 13.585 10.096 11.788 6.771 11.788C3.446 11.788 0.75 13.585 0.75 15.802M12.791 8.778C15.008 8.778 16.805 6.981 16.805 4.764C16.805 2.547 15.008 0.75 12.791 0.75M6.771 8.778C4.554 8.778 2.757 6.981 2.757 4.764C2.757 2.547 4.554 0.75 6.771 0.75C8.987 0.75 10.784 2.547 10.784 4.764C10.784 6.981 8.987 8.778 6.771 8.778Z" stroke={t.color.accent} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function HeroPinIcon() {
  return (
    <Svg width={12} height={16} viewBox="0 0 13.96 17.3" fill="none">
      <Path d="M0.75 6.914C0.75 11.234 4.529 14.806 6.202 16.176C6.441 16.372 6.562 16.471 6.741 16.521C6.88 16.56 7.085 16.56 7.224 16.521C7.403 16.471 7.523 16.373 7.763 16.176C9.436 14.806 13.215 11.234 13.215 6.914C13.215 5.279 12.558 3.711 11.39 2.555C10.221 1.399 8.636 0.75 6.983 0.75C5.33 0.75 3.744 1.4 2.575 2.555C1.407 3.711 0.75 5.279 0.75 6.914Z" stroke={t.color.accent} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5.202 6.092C5.202 7.076 5.999 7.873 6.982 7.873C7.966 7.873 8.763 7.076 8.763 6.092C8.763 5.109 7.966 4.311 6.982 4.311C5.999 4.311 5.202 5.109 5.202 6.092Z" stroke={t.color.accent} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// ── FavoriteCafeText: links free-text café reference to its profile ────────────

function FavoriteCafeText({ text }: { text: string }) {
  const router = useRouter();
  const { resolve } = useCafeResolver();
  const cafe = resolve(text);
  if (cafe) {
    return (
      <Pressable onPress={() => router.push(`/cafe/${cafe.cafe_slug}` as any)}>
        <Text style={[s.infoText, { textDecorationLine: "underline" }] as any}>{cafe.name}</Text>
      </Pressable>
    );
  }
  return <Text style={s.infoText}>{text}</Text>;
}

// ── ShelfCarousel — horizontal scroll of coffee cards ────────────────────────

const CAROUSEL_CARD_W = 240;
const CAROUSEL_CARD_H = Math.floor(240 * (400 / 240));
const CAROUSEL_GAP = 16;
const CAROUSEL_PAD = 20;

function ShelfCarousel({ coffees, isOwner, onAddToShelf }: {
  coffees: Array<{ coffee: any; entryId: string }>;
  isOwner?: boolean;
  onAddToShelf?: (productId: string) => void;
}) {
  if (coffees.length === 0) {
    return <View style={g.empty}><Text style={g.emptyText}>Nothing here yet.</Text></View>;
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: CAROUSEL_PAD, gap: CAROUSEL_GAP, paddingBottom: 8 }}
    >
      {coffees.map(({ coffee, entryId }) => (
        <View key={entryId} style={{ width: CAROUSEL_CARD_W, height: CAROUSEL_CARD_H }}>
          <CoffeeCard
            coffee={coffee}
            width={CAROUSEL_CARD_W}
            height={CAROUSEL_CARD_H}
            shelfMode
            isOwner={isOwner}
            onAddToShelf={!isOwner ? onAddToShelf : undefined}
          />
        </View>
      ))}
    </ScrollView>
  );
}

const g = StyleSheet.create({
  empty: { paddingVertical: 60, alignItems: "center", paddingHorizontal: 32 },
  emptyText: { fontFamily: t.font["body.semibold"], fontSize: 15, color: t.color["text.primary"], marginBottom: 6 },
});

// ── Main page ────────────────────────────────────────────────────────────────

export default function UserProfilePage() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { user: authUser } = useAuth();
  const { fetchUserShelves, addToShelf } = useShelves();
  const { productMap } = useCoffeeData();
  const router = useRouter();
  const { width: screenW } = useWindowDimensions();
  const isNarrow = screenW < 768;

  // Avatar manual positioning state
  const [pubImgAspect, setPubImgAspect] = useState(1.5);
  const [pubContW, setPubContW] = useState(0);
  const POSTS_PER_PAGE = 5;
  const [visiblePostCount, setVisiblePostCount] = useState(5);
  const [pubContH, setPubContH] = useState(0);

  const [profileUser, setProfileUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProfileTab>("posts");
  // No sub-tab state — both shelf sections render at once
  const [posts, setPosts] = useState<any[]>([]);
  const [shelves, setShelves] = useState<any>({ open_bags: [], on_the_list: [] });
  const [followingList, setFollowingList] = useState<any[]>([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [following, setFollowing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const isOwn = authUser?.username === username;

  const loadData = useCallback(async () => {
    if (!username) return;
    const [userRes, postsRes, shelfRes] = await Promise.allSettled([
      apiFetchRaw(`/auth/users/${username}`),
      apiFetchRaw(`/users/${username}/posts`),
      fetchUserShelves(username),
    ]);
    if (userRes.status === "fulfilled") {
      const raw = userRes.value;
      const u = raw?.data ?? raw;
      setProfileUser(u);
      const slug = `user_${u.id}`;
      apiFetchRaw(`/followers/${slug}`).then((r) => { const d = r?.data ?? r; setFollowerCount(d?.follower_count || 0); }).catch(() => {});
      if (authUser && !isOwn) {
        apiFetchRaw(`/follow-status/${slug}`).then((r) => { const d = r?.data ?? r; setFollowing(d?.following || false); }).catch(() => {});
      }
    }
    if (postsRes.status === "fulfilled") {
      const raw = postsRes.value;
      const d = raw?.data ?? raw;
      const p = d?.posts ?? d;
      setPosts(Array.isArray(p) ? p : []);
    }
    if (shelfRes.status === "fulfilled") setShelves(shelfRes.value || { open_bags: [], on_the_list: [] });
    setLoading(false);
  }, [username, authUser]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (activeTab !== "following" || !profileUser) return;
    if (isOwn) {
      apiFetchRaw("/my-following").then((r) => { const d = r?.data ?? r; setFollowingList(d?.following || []); }).catch(() => {});
    }
  }, [activeTab, profileUser, isOwn]);

  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const handleFollowToggle = async () => {
    if (!profileUser) return;
    try {
      const res = await apiFetchRaw(`/roasters/user_${profileUser.id}/follow`, { method: "POST" });
      const d = res?.data ?? res;
      setFollowing(d.following);
      setFollowerCount(d.follower_count);
    } catch (e) { console.error("Follow toggle failed:", e); }
  };

  const shelfSections = SHELF_KEYS.map((key) => ({
    key,
    label: SHELF_SECTION_LABELS[key],
    entries: (shelves[key] || []).map((entry: any) => ({
      coffee: productMap?.get(entry.product_id),
      entryId: String(entry.id),
    }))
      .filter((e: any) => e.coffee?.coffee_name)
      .filter((e: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.coffee?.product_id === e.coffee?.product_id) === i),
  }));

  if (loading) {
    return (<><Stack.Screen options={{ headerShown: false }} /><Navbar /><View style={s.loadingWrap}><ActivityIndicator size="large" color={t.color["text.primary"]} /></View></>);
  }
  if (!profileUser) {
    return (<><Stack.Screen options={{ headerShown: false }} /><Navbar /><View style={s.loadingWrap}><Text style={s.loadingText}>User not found</Text></View></>);
  }

  const u = profileUser;
  const roastLabel = (() => {
    const pref = u.coffee_preference;
    const brew = u.brewing_style;
    if (!pref && !brew) return null;
    const prefText = pref === "light" ? "Light" : pref === "medium" ? "Medium" : pref === "dark" ? "Dark" : "";
    const brewText = brew === "espresso" ? "Espresso" : brew === "filter" ? "Filter" : "";
    return `${prefText}${brewText ? " " + brewText : ""} Roast Drinker`.trim();
  })();

  // ── Hero section (Figma 116:380) ──
  const heroContent = (
    <View style={[s.hero, isNarrow && s.heroNarrow]}>
      <View
        style={[s.avatarWrap, isNarrow && s.avatarWrapNarrow]}
        onLayout={(e) => { setPubContW(e.nativeEvent.layout.width); setPubContH(e.nativeEvent.layout.height); }}
      >
        {u.avatar_url ? (() => {
          const cW = pubContW || 350;
          const cH = pubContH || 360;
          const zoom = u.avatar_zoom ?? 1;
          const cx = u.avatar_crop_x ?? 50;
          const cy = u.avatar_crop_y ?? 50;
          const containerAspect = cW / cH;
          const MIN_OVER = 1.2;
          let iW: number, iH: number;
          if (pubImgAspect > containerAspect) { iH = cH * MIN_OVER * zoom; iW = iH * pubImgAspect; }
          else { iW = cW * MIN_OVER * zoom; iH = iW / pubImgAspect; }
          const tx = -(iW - cW) * (cx / 100);
          const ty = -(iH - cH) * (cy / 100);
          return (
            <Image
              source={{ uri: resolveUploadUrl(u.avatar_url) }}
              style={{ position: "absolute", width: iW, height: iH, left: tx, top: ty } as any}
              contentFit="fill"
              onLoad={(e: any) => { const src = e?.source; if (src?.width && src?.height) setPubImgAspect(src.width / src.height); }}
            />
          );
        })() : (
          <View style={s.avatarFallback}>
            <Text style={s.avatarLetter}>{(u.display_name || "?")[0].toUpperCase()}</Text>
          </View>
        )}
      </View>

      <View style={[s.infoCol, isNarrow && s.infoColNarrow]}>
        <Text style={s.displayName}>{u.display_name}</Text>
        {u.bio ? <Text style={s.bio}>{u.bio}</Text> : null}

        <View style={s.divider} />

        {/* Row 1: favorite drink + favorite cafe */}
        <View style={s.infoRow}>
          {u.favorite_drink ? (
            <View style={s.infoItem}><HeroCoffeeIcon /><Text style={s.infoText}>{u.favorite_drink}</Text></View>
          ) : null}
          {u.favorite_cafe ? (
            <View style={s.infoItem}>
              <HeroHeartIcon />
              <FavoriteCafeText text={u.favorite_cafe} />
            </View>
          ) : null}
        </View>

        <View style={s.divider} />

        {/* Row 2: roast preference */}
        {roastLabel ? (
          <>
            <View style={s.infoRow}><HeroBeanIcon /><Text style={s.infoText}>{roastLabel}</Text></View>
            <View style={s.divider} />
          </>
        ) : null}

        {/* Row 3: followers + location */}
        <View style={s.infoRow}>
          <View style={s.infoItem}><HeroPeopleIcon /><Text style={s.infoText}>{followerCount} followers</Text></View>
          {u.location ? (
            <View style={s.infoItem}><HeroPinIcon /><Text style={s.infoText}>{u.location}</Text></View>
          ) : null}
        </View>

        <View style={s.divider} />

        {/* Follow + Message buttons */}
        {!isOwn && authUser && (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={handleFollowToggle} style={[s.followBtn, following && s.followBtnFollowing]}>
              {following ? (
                <><Check size={10} color={t.color["text.primary"]} strokeWidth={2.5} /><Text style={s.followBtnTextFollowing}>Following</Text></>
              ) : (
                <><Plus size={10} color={t.color["text.primary"]} strokeWidth={2.5} /><Text style={s.followBtnText}>Follow</Text></>
              )}
            </Pressable>
            <Pressable
              onPress={async () => {
                try {
                  const raw = await apiFetchRaw(`/direct-threads/with/${username}`, { method: "POST" });
                  const d = raw?.data ?? raw;
                  if (d?.thread_id) {
                    // Cross-component signal: let the navbar open the
                    // Messages dropdown at this thread.
                    if (typeof window !== "undefined") {
                      (window as any).__crema_openThread?.("direct_message", d.thread_id);
                    }
                  }
                } catch (e) { console.warn("Open DM failed:", e); }
              }}
              style={s.messageBtn}
            >
              <MessageCircle size={11} color={t.color["text.primary"]} strokeWidth={2} />
              <Text style={s.followBtnText}>Message</Text>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );

  // ── Tab bar ──
  const tabs: ProfileTab[] = isOwn ? ["posts", "shelf", "stamps", "following"] : ["posts", "shelf", "stamps"];
  const tabBar = (
    <View style={s.tabBar}>
      {tabs.map((tab) => (
        <Pressable key={tab} onPress={() => { setActiveTab(tab); setVisiblePostCount(POSTS_PER_PAGE); }} style={s.tab}>
          <Text style={[s.tabText, activeTab === tab && s.tabTextActive]}>
            {tab === "posts" ? "POSTS" : tab === "shelf" ? "COFFEE SHELF" : tab === "stamps" ? "STAMP BOOK" : "FOLLOWING"}
          </Text>
          {activeTab === tab && <View style={s.tabUnderline} />}
        </Pressable>
      ))}
    </View>
  );

  // ── Tab content ──
  let tabContent: React.ReactNode = null;

  if (activeTab === "posts") {
    tabContent = (
      <View style={s.tabContent}>
        {posts.length === 0 ? (
          <View style={g.empty}><Text style={g.emptyText}>No posts yet.</Text></View>
        ) : (
          posts.slice(0, visiblePostCount).map((post: any, idx: number) => (
            <View key={`post-${post.id}-${idx}`}>
              <PostCard post={post} user={authUser}
                onComment={(p) => openPostModal({ post: p, mode: "comment" })}
                onRepost={(p) => openPostModal({ post: p, mode: "repost" })}
                onViewOriginal={(id) => openPostModal({ postId: id, mode: "comment" })}
              />
              {idx < Math.min(posts.length, visiblePostCount) - 1 && <View style={s.postDivider} />}
            </View>
          ))
        )}
      </View>
    );
  } else if (activeTab === "shelf") {
    tabContent = (
      <View style={s.tabContent}>
        {shelfSections.map((section) => (
          <View key={section.key} style={s.shelfSection}>
            <Text style={s.shelfSectionTitle}>{section.label}</Text>
            <View style={s.shelfSectionMeta}>
              <HeroCoffeeIcon />
              <Text style={s.shelfSectionCount}>
                {section.entries.length} {section.entries.length === 1 ? "Coffee" : "Coffees"}
              </Text>
            </View>
            <View style={s.shelfSectionDivider} />
            <ShelfCarousel coffees={section.entries} isOwner={isOwn} onAddToShelf={(productId: string) => { addToShelf(productId, "open_bags"); }} />
          </View>
        ))}
      </View>
    );
  } else if (activeTab === "stamps") {
    tabContent = (
      <View style={s.tabContent}>
        <StampBookList username={username as string} isOwnProfile={isOwn} />
      </View>
    );
  } else if (activeTab === "following" && isOwn) {
    tabContent = (
      <View style={s.tabContent}>
        {followingList.length === 0 ? (
          <View style={g.empty}><Text style={g.emptyText}>Not following anyone yet.</Text></View>
        ) : (
          followingList.map((f: any) => (
            <Pressable
              key={f.slug}
              onPress={() => { if (f.is_roaster) router.push(`/roaster/${f.slug}`); else router.push(`/user/${f.username}`); }}
              style={s.followRow}
            >
              {f.avatar_url ? (
                <Image source={{ uri: resolveUploadUrl(f.avatar_url) }} style={s.followAvatar} contentFit="cover" />
              ) : (
                <View style={[s.followAvatar, s.followAvatarFb]}>
                  <Text style={s.followAvatarLetter}>{(f.display_name || "?")[0].toUpperCase()}</Text>
                </View>
              )}
              <View style={s.followInfo}>
                <Text style={s.followName}>{f.display_name}</Text>
                <Text style={s.followMeta}>{f.follower_count} follower{f.follower_count !== 1 ? "s" : ""}</Text>
              </View>
            </Pressable>
          ))
        )}
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Navbar />
      <View style={s.container}>
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.color["text.primary"]} />}
          showsVerticalScrollIndicator={false}
          onScroll={(e) => {
            const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
            if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 300) {
              if (activeTab === "posts" && visiblePostCount < posts.length) {
                setVisiblePostCount((c) => Math.min(c + POSTS_PER_PAGE, posts.length));
              }
            }
          }}
          scrollEventThrottle={400}
        >
          {heroContent}
          {tabBar}
          {tabContent}
        </ScrollView>
      </View>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: t.color.bg },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  loadingWrap: { flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: t.color.bg } as any,
  loadingText: { fontFamily: t.font["body.regular"], fontSize: 16, color: t.color["text.secondary"] },

  // Hero — centered on screen
  hero: {
    flexDirection: "row", justifyContent: "center", alignSelf: "center",
    width: "100%", maxWidth: 860, paddingTop: 40, paddingBottom: 32, gap: 48,
  } as any,
  heroNarrow: { flexDirection: "column", alignItems: "center", gap: 20, paddingTop: 24, paddingBottom: 24 },

  // Avatar — SQUARE with slight rounding (borderRadius: 5)
  // Matches app/(tabs)/profile.tsx + Figma 202:2548 (488.68 × 501.72
  // at 1440 design viewport). Same responsive rule on both pages so
  // the avatar size doesn't jump when someone edits their own profile
  // or when comparing across users.
  avatarWrap: {
    width: "34%",
    aspectRatio: 488.68 / 501.72,
    maxWidth: 489,
    borderRadius: 5,
    overflow: "hidden",
  } as any,
  avatarWrapNarrow: { width: "60%", maxWidth: 300 },
  avatarFallback: { width: "100%", height: "100%", backgroundColor: t.color["card.info"], alignItems: "center", justifyContent: "center" } as any,
  avatarLetter: { fontFamily: t.font.display, fontSize: 48, color: t.color["text.primary"] },

  // Info column
  infoCol: { flex: 1, justifyContent: "center" } as any,
  infoColNarrow: { alignItems: "center" } as any,
  displayName: { fontFamily: t.font.display, fontSize: 56.8, color: t.color["text.primary"], lineHeight: 66 },
  bio: { fontFamily: t.font["body.regular"], fontSize: 12, color: t.color["text.secondary"], marginTop: 4, lineHeight: 18 },
  divider: { height: 1, backgroundColor: t.color.border, maxWidth: 281, width: "100%", marginVertical: 8 } as any,
  infoRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 2 },
  infoItem: { flexDirection: "row", alignItems: "center", gap: 7 },
  infoText: { fontFamily: t.font["body.medium"], fontSize: 14, color: t.color["text.primary"] },

  // Follow button
  followBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 4, width: 71, height: 27, borderRadius: 2, borderWidth: 1.5, borderColor: t.color["text.primary"],
  },
  followBtnFollowing: { width: 88, backgroundColor: t.color.accent, borderColor: t.color.accent },
  followBtnText: { fontFamily: t.font["body.semibold"], fontSize: 12, color: t.color["text.primary"] },
  followBtnTextFollowing: { fontFamily: t.font["body.semibold"], fontSize: 12, color: t.color["text.primary"] },
  // Match the follow-button geometry for visual continuity.
  messageBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 4, paddingHorizontal: 12, height: 27, borderRadius: 2,
    borderWidth: 1.5, borderColor: t.color["text.primary"],
  } as any,

  // Tab bar
  tabBar: {
    flexDirection: "row", alignItems: "stretch", alignSelf: "center",
    width: "100%", maxWidth: 860, backgroundColor: t.color.bg, height: 80, gap: 48,
    borderTopWidth: 1, borderTopColor: "rgba(215,209,196,0.5)",
    borderBottomWidth: 1, borderBottomColor: "rgba(215,209,196,0.5)",
  } as any,
  tab: { justifyContent: "center", position: "relative" } as any,
  tabText: { fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.muted"], letterSpacing: 0.5, textTransform: "uppercase" } as any,
  tabTextActive: { color: t.color["text.primary"] },
  tabUnderline: { position: "absolute", bottom: -1, left: 0, right: 0, height: 4, backgroundColor: t.color["text.primary"] } as any,

  // Tab content
  tabContent: { paddingTop: 20, alignSelf: "center", width: "100%", maxWidth: 860, minHeight: 2400, paddingBottom: 100 } as any,
  postDivider: { height: 1, backgroundColor: "rgba(215,209,196,0.5)", marginVertical: 4 },

  // Shelf sub-tabs
  shelfSection: { marginBottom: 40 },
  shelfSectionTitle: { fontFamily: t.font.display, fontSize: 35, color: t.color["text.primary"], lineHeight: 42, paddingHorizontal: 20, marginTop: 16 },
  shelfSectionMeta: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 20, marginTop: 8, marginBottom: 12 },
  shelfSectionCount: { fontFamily: t.font["body.medium"], fontSize: 14, color: t.color["text.primary"] },
  shelfSectionDivider: { height: 1, backgroundColor: t.color.divider, marginHorizontal: 20, marginBottom: 16 },

  // Following list
  followRow: {
    flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 20, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: "rgba(215,209,196,0.3)",
  },
  followAvatar: { width: 36, height: 36, borderRadius: 18, overflow: "hidden" } as any,
  followAvatarFb: { backgroundColor: t.color["text.primary"], alignItems: "center", justifyContent: "center" } as any,
  followAvatarLetter: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.on-dark"] },
  followInfo: { flex: 1 },
  followName: { fontFamily: t.font["body.medium"], fontSize: 14, color: t.color["text.primary"] },
  followMeta: { fontFamily: t.font["body.regular"], fontSize: 11, color: t.color["text.muted"], marginTop: 2 },
});
