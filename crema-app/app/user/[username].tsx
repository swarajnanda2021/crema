/**
 * Public user profile — CRUD Utopia edition.
 * Read-only with Follow button. Same layout as own profile.
 */

import { useEffect, useState, useCallback } from "react";
import {
  View, Text, ScrollView, Pressable, RefreshControl,
  StyleSheet, useWindowDimensions, ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { Plus, Check } from "lucide-react-native";
import Svg, { Path, Circle } from "react-native-svg";

import { useAuth } from "../../src/hooks/useAuth";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { apiFetchRaw, resolveUploadUrl } from "../../src/api/client";
import { t, fonts } from "../../src/tokens/useTokens";
import type { ShelfKey } from "../../src/tokens/useTokens";
import { CroppedAvatar, openPostModal } from "../../src/components/primitives";
import PostCard from "../../src/components/domain/PostCard";
import CoffeeCard from "../../src/components/CoffeeCard";
import Navbar from "../../src/components/Navbar";

type ProfileTab = "posts" | "shelf" | "following";
type ShelfSub = "currently_drinking" | "drank" | "want_to_try";
const SHELF_SUB_LABELS: Record<ShelfSub, string> = { currently_drinking: "Currently Drinking", drank: "Drank", want_to_try: "Want to Try" };
const SHELF_KEYS: ShelfKey[] = ["currently_drinking", "drank", "want_to_try"];

// Hero icons (same as profile.tsx)
function HeroCoffeeIcon() { return <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"><Path d="M17 8h1a4 4 0 110 8h-1M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8zM6 1v3M10 1v3M14 1v3" stroke={t.color.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></Svg>; }
function HeroHeartIcon() { return <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"><Path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" stroke={t.color.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></Svg>; }
function HeroBeanIcon() { return <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"><Circle cx="12" cy="12" r="10" stroke={t.color.accent} strokeWidth={2}/><Path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" stroke={t.color.accent} strokeWidth={2} strokeLinecap="round"/></Svg>; }
function HeroPeopleIcon() { return <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"><Path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke={t.color.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></Svg>; }
function HeroPinIcon() { return <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"><Path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" stroke={t.color.accent} strokeWidth={2}/><Circle cx="12" cy="10" r="3" stroke={t.color.accent} strokeWidth={2}/></Svg>; }

function CoffeeGrid({ entries, productMap }: { entries: any[]; productMap: any }) {
  const [containerW, setContainerW] = useState(0);
  const cols = Math.max(1, Math.floor((containerW + 16) / 256));
  const cardW = cols > 0 ? (containerW - (cols - 1) * 16) / cols : 240;
  return (
    <View onLayout={(e) => setContainerW(e.nativeEvent.layout.width)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 } as any}>
      {entries.map((entry) => {
        const coffee = productMap?.get(entry.product_id) || { product_id: entry.product_id, coffee_name: entry.product_id };
        return <View key={entry.id} style={{ width: cardW }}><CoffeeCard coffee={coffee} width={cardW} height={cardW * 1.55} /></View>;
      })}
    </View>
  );
}

export default function UserProfilePage() {
  const { username } = useLocalSearchParams<{ username: string }>();
  const { user: authUser } = useAuth();
  const { productMap } = useCoffeeData();
  const router = useRouter();
  const { width: screenW } = useWindowDimensions();

  const [profileUser, setProfileUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ProfileTab>("posts");
  const [activeShelf, setActiveShelf] = useState<ShelfSub>("currently_drinking");
  const [posts, setPosts] = useState<any[]>([]);
  const [shelves, setShelves] = useState<any>({ currently_drinking: [], drank: [], want_to_try: [] });
  const [followingList, setFollowingList] = useState<any[]>([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [following, setFollowing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const isOwn = authUser?.username === username;

  const loadData = useCallback(async () => {
    if (!username) return;
    const [userR, postsR, shelfR] = await Promise.allSettled([
      apiFetchRaw(`/auth/users/${username}`),
      apiFetchRaw(`/users/${username}/posts`),
      apiFetchRaw(`/shelves/filter?user_id=0`), // placeholder, fixed below
    ]);
    if (userR.status === "fulfilled") {
      const u = userR.value?.data ?? userR.value;
      setProfileUser(u);
      const slug = `user_${u.id}`;
      apiFetchRaw(`/followers/${slug}`).then((r) => { const d = r?.data ?? r; setFollowerCount(d?.follower_count || 0); }).catch(() => {});
      if (authUser && !isOwn) {
        apiFetchRaw(`/follow-status/${slug}`).then((r) => { const d = r?.data ?? r; setFollowing(d?.following || false); }).catch(() => {});
      }
      // Now fetch shelves with correct user_id
      apiFetchRaw(`/shelves/filter?user_id=${u.id}`).then((r) => {
        const d = r?.data ?? r;
        setShelves(d && typeof d === "object" && !Array.isArray(d) ? d : { currently_drinking: [], drank: [], want_to_try: [] });
      }).catch(() => {});
    }
    if (postsR.status === "fulfilled") {
      const d = postsR.value?.data ?? postsR.value;
      setPosts(d?.posts || []);
    }
    if (activeTab === "following" && authUser) {
      apiFetchRaw("/my-following").then((r) => { const d = r?.data ?? r; setFollowingList(d?.following || []); }).catch(() => {});
    }
    setLoading(false);
  }, [username, authUser, isOwn]);

  useEffect(() => { loadData(); }, [loadData]);
  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const handleFollowToggle = async () => {
    if (!profileUser) return;
    try {
      const r = await apiFetchRaw(`/roasters/user_${profileUser.id}/follow`, { method: "POST" });
      const d = r?.data ?? r;
      setFollowing(d?.following ?? !following);
      setFollowerCount(d?.follower_count ?? followerCount);
    } catch (e) { console.error("Follow failed:", e); }
  };

  if (loading) return <><Stack.Screen options={{ headerShown: false }} /><Navbar /><View style={s.loading}><ActivityIndicator size="large" color={t.color["text.primary"]} /></View></>;
  if (!profileUser) return <><Stack.Screen options={{ headerShown: false }} /><Navbar /><View style={s.loading}><Text style={s.empty}>User not found</Text></View></>;

  const shelfEntries = shelves[activeShelf] || [];

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Navbar />
      <View style={s.container}>
        <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.color["accent.cta"]} />}>

          {/* Hero */}
          <View style={s.hero}>
            <View style={s.avatarWrap}>
              {profileUser.avatar_url ? (
                <CroppedAvatar url={profileUser.avatar_url} cropX={profileUser.avatar_crop_x} cropY={profileUser.avatar_crop_y} zoom={profileUser.avatar_zoom} size={screenW > 900 ? 280 : Math.min(screenW * 0.45, 280)} />
              ) : (
                <View style={[s.avatarFb, { width: 280, height: 280 }]}><Text style={s.avatarFbL}>{(profileUser.display_name || "?")[0]}</Text></View>
              )}
            </View>
            <View style={s.heroInfo}>
              <Text style={s.displayName}>{profileUser.display_name}</Text>
              {profileUser.bio && <Text style={s.bio}>{profileUser.bio}</Text>}
              <View style={s.heroIcons}>
                {profileUser.favorite_drink && <View style={s.iconRow}><HeroCoffeeIcon /><Text style={s.iconText}>{profileUser.favorite_drink}</Text></View>}
                {profileUser.favorite_cafe && <View style={s.iconRow}><HeroHeartIcon /><Text style={s.iconText}>{profileUser.favorite_cafe}</Text></View>}
                {profileUser.coffee_preference && <View style={s.iconRow}><HeroBeanIcon /><Text style={s.iconText}>{profileUser.coffee_preference} Roast Drinker</Text></View>}
                <View style={s.iconRow}><HeroPeopleIcon /><Text style={s.iconText}>{followerCount} followers</Text></View>
                {profileUser.location && <View style={s.iconRow}><HeroPinIcon /><Text style={s.iconText}>{profileUser.location}</Text></View>}
              </View>
              {!isOwn && authUser && (
                <Pressable onPress={handleFollowToggle} style={[s.followBtn, following && s.followBtnActive]}>
                  {following ? <><Check size={10} color={t.color["text.primary"]} strokeWidth={2.5} /><Text style={s.followBtnTextActive}>Following</Text></> :
                    <><Plus size={10} color={t.color["text.primary"]} strokeWidth={2.5} /><Text style={s.followBtnText}>Follow</Text></>}
                </Pressable>
              )}
            </View>
          </View>

          {/* Tabs */}
          <View style={s.tabBar}>
            {(["posts", "shelf", "following"] as ProfileTab[]).map((tab) => (
              <Pressable key={tab} onPress={() => setActiveTab(tab)} style={s.tab}>
                <Text style={[s.tabText, activeTab === tab && s.tabActive]}>{tab === "posts" ? "POSTS" : tab === "shelf" ? "COFFEE SHELF" : "FOLLOWING"}</Text>
                {activeTab === tab && <View style={s.tabLine} />}
              </Pressable>
            ))}
          </View>

          <View style={s.tabContent}>
            {activeTab === "posts" && (posts.length === 0 ? <Text style={s.empty}>No posts yet.</Text> :
              posts.map((post, idx) => (
                <View key={post.id}>
                  <PostCard post={post} user={authUser}
                    onComment={(p) => openPostModal({ post: p, mode: "comment" })}
                    onRepost={(p) => openPostModal({ post: p, mode: "repost" })}
                    onViewOriginal={(id) => openPostModal({ postId: id, mode: "comment" })}
                  />
                  {idx < posts.length - 1 && <View style={s.divider} />}
                </View>
              )))}
            {activeTab === "shelf" && <>
              <View style={s.shelfTabs}>
                {SHELF_KEYS.map((k) => (
                  <Pressable key={k} onPress={() => setActiveShelf(k as ShelfSub)}>
                    <Text style={[s.shelfTabText, activeShelf === k && s.shelfTabActive]}>{SHELF_SUB_LABELS[k as ShelfSub]}</Text>
                  </Pressable>
                ))}
              </View>
              {shelfEntries.length === 0 ? <Text style={s.empty}>Nothing here.</Text> :
                <CoffeeGrid entries={shelfEntries} productMap={productMap} />}
            </>}
            {activeTab === "following" && (followingList.length === 0 ? <Text style={s.empty}>Not following anyone.</Text> :
              followingList.map((f) => (
                <View key={f.slug} style={s.followRow}>
                  <Pressable onPress={() => router.push(`/user/${f.username}` as any)} style={s.followLeft}>
                    {f.avatar_url ? <CroppedAvatar url={f.avatar_url} size={36} /> : <View style={s.followFb}><Text style={s.followFbL}>{(f.display_name||"?")[0]}</Text></View>}
                    <View style={{ flex: 1, marginLeft: 10 }}><Text style={s.followName}>{f.display_name}</Text></View>
                  </Pressable>
                </View>
              )))}
          </View>
        </ScrollView>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.color.bg } as any,
  container: { flex: 1, backgroundColor: t.color.bg },
  content: { maxWidth: 1200, alignSelf: "center" as any, width: "100%" as any, paddingBottom: 100 },
  hero: { flexDirection: "row", paddingHorizontal: "6.25%" as any, paddingTop: 24, paddingBottom: 16, gap: 40 } as any,
  avatarWrap: {} as any,
  avatarFb: { borderRadius: 8, backgroundColor: t.color["card.info"], alignItems: "center", justifyContent: "center" } as any,
  avatarFbL: { fontFamily: t.font.display, fontSize: 64, color: t.color["text.primary"] },
  heroInfo: { flex: 1, paddingTop: 8 },
  displayName: { fontFamily: t.font.display, fontSize: 40, color: t.color["text.primary"], marginBottom: 8 },
  bio: { fontFamily: t.font["body.regular"], fontSize: t.size["font.md"], color: t.color["text.secondary"], marginBottom: 12, lineHeight: 20 },
  heroIcons: { gap: 6 } as any,
  iconRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 } as any,
  iconText: { fontFamily: t.font["body.medium"], fontSize: t.size["font.base"], color: t.color["text.primary"] },
  followBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, marginTop: 12, width: 100, height: 30, borderRadius: 2, borderWidth: 1.5, borderColor: t.color["text.primary"] } as any,
  followBtnActive: { backgroundColor: t.color.accent, borderColor: t.color.accent },
  followBtnText: { fontFamily: t.font["body.semibold"], fontSize: 12, color: t.color["text.primary"] },
  followBtnTextActive: { fontFamily: t.font["body.semibold"], fontSize: 12, color: t.color["text.primary"] },
  tabBar: { flexDirection: "row", paddingHorizontal: "6.25%" as any, borderBottomWidth: 1, borderBottomColor: t.color["border.light"], marginTop: 8 } as any,
  tab: { paddingVertical: 12, marginRight: 32, alignItems: "center" } as any,
  tabText: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.muted"], letterSpacing: 0.5 },
  tabActive: { color: t.color["text.primary"] },
  tabLine: { height: 3, backgroundColor: t.color["text.primary"], borderRadius: 1.5, marginTop: 8, width: "100%" } as any,
  tabContent: { paddingHorizontal: "6.25%" as any, paddingTop: 16 },
  shelfTabs: { flexDirection: "row", gap: 24, marginBottom: 16 } as any,
  shelfTabText: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.muted"] },
  shelfTabActive: { color: t.color["text.primary"] },
  followRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.color["border.light"] } as any,
  followLeft: { flexDirection: "row", alignItems: "center", flex: 1 } as any,
  followFb: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.color["text.primary"], alignItems: "center", justifyContent: "center" } as any,
  followFbL: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.on-dark"] },
  followName: { fontFamily: t.font["body.medium"], fontSize: t.size["font.md"], color: t.color["text.primary"] },
  divider: { height: 1, backgroundColor: t.color.divider },
  empty: { fontFamily: t.font["body.regular"], fontSize: t.size["font.md"], color: t.color["text.muted"], textAlign: "center", paddingVertical: 40 },
});
