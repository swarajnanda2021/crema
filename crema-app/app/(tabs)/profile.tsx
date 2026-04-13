/**
 * Own-profile page — CRUD Utopia edition.
 *
 * Data: apiFetchRaw for posts, shelves, followers. useAuth for user.
 * Display: PostCard, CoffeeCard, CroppedAvatar from primitives.
 * Tokens: all colors/fonts/sizes from design-tokens.json.
 *
 * Tabs: Posts / Coffee Shelf / Following
 * In-place editing for hero fields.
 */

import { useEffect, useState, useCallback } from "react";
import {
  View, Text, TextInput, ScrollView, Pressable, RefreshControl,
  StyleSheet, useWindowDimensions, ActivityIndicator,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Plus, Check, Camera } from "lucide-react-native";
import Svg, { Path, Circle } from "react-native-svg";

import { useAuth } from "../../src/hooks/useAuth";
import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { apiFetchRaw, resolveUploadUrl } from "../../src/api/client";
import { t, fonts, SHELF_LABELS } from "../../src/tokens/useTokens";
import type { ShelfKey } from "../../src/tokens/useTokens";
import { CroppedAvatar, openPostModal } from "../../src/components/primitives";
import PostCard from "../../src/components/domain/PostCard";
import CoffeeCard from "../../src/components/CoffeeCard";
import ComposePost from "../../src/components/ComposePost";
import ImageUploadModal from "../../src/components/ImageUploadModal";

type ProfileTab = "posts" | "shelf" | "following";
type ShelfSub = "currently_drinking" | "drank" | "want_to_try";
const SHELF_KEYS: ShelfKey[] = ["currently_drinking", "drank", "want_to_try"];
const SHELF_SUB_LABELS: Record<ShelfSub, string> = { currently_drinking: "Currently Drinking", drank: "Drank", want_to_try: "Want to Try" };
const POSTS_PER_PAGE = 5;

// Hero icons
function HeroCoffeeIcon() { return <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"><Path d="M17 8h1a4 4 0 110 8h-1M3 8h14v9a4 4 0 01-4 4H7a4 4 0 01-4-4V8zM6 1v3M10 1v3M14 1v3" stroke={t.color.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></Svg>; }
function HeroHeartIcon() { return <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"><Path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" stroke={t.color.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></Svg>; }
function HeroBeanIcon() { return <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"><Circle cx="12" cy="12" r="10" stroke={t.color.accent} strokeWidth={2}/><Path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01" stroke={t.color.accent} strokeWidth={2} strokeLinecap="round"/></Svg>; }
function HeroPeopleIcon() { return <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"><Path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2M9 11a4 4 0 100-8 4 4 0 000 8zM23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75" stroke={t.color.accent} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"/></Svg>; }
function HeroPinIcon() { return <Svg width={18} height={18} viewBox="0 0 24 24" fill="none"><Path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" stroke={t.color.accent} strokeWidth={2}/><Circle cx="12" cy="10" r="3" stroke={t.color.accent} strokeWidth={2}/></Svg>; }

// CoffeeGrid
function CoffeeGrid({ entries, productMap, onRemove }: { entries: any[]; productMap: any; onRemove?: (id: string) => void }) {
  const [containerW, setContainerW] = useState(0);
  const cols = Math.max(1, Math.floor((containerW + 16) / 256));
  const cardW = cols > 0 ? (containerW - (cols - 1) * 16) / cols : 240;
  return (
    <View onLayout={(e) => setContainerW(e.nativeEvent.layout.width)} style={{ flexDirection: "row", flexWrap: "wrap", gap: 16 } as any}>
      {entries.map((entry) => {
        const coffee = productMap?.get(entry.product_id) || { product_id: entry.product_id, coffee_name: entry.product_id };
        return (
          <View key={entry.id || entry.entryId} style={{ width: cardW }}>
            <CoffeeCard coffee={coffee} width={cardW} height={cardW * 1.55} shelfMode={!!onRemove} onRemove={onRemove ? () => onRemove(String(entry.id)) : undefined} />
          </View>
        );
      })}
    </View>
  );
}

export default function ProfilePage() {
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const { user, updateProfile } = useAuth();
  const { productMap } = useCoffeeData();
  const router = useRouter();
  const { width: screenW } = useWindowDimensions();

  const [activeTab, setActiveTab] = useState<ProfileTab>("posts");
  const [activeShelf, setActiveShelf] = useState<ShelfSub>("currently_drinking");
  const [posts, setPosts] = useState<any[]>([]);
  const [visiblePostCount, setVisiblePostCount] = useState(POSTS_PER_PAGE);
  const [shelves, setShelves] = useState<any>({ currently_drinking: [], drank: [], want_to_try: [] });
  const [followingList, setFollowingList] = useState<any[]>([]);
  const [followerCount, setFollowerCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [isEditing, setIsEditing] = useState(edit === "1");
  const [saving, setSaving] = useState(false);
  const [editName, setEditName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editDrink, setEditDrink] = useState("");
  const [editCafe, setEditCafe] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [showAvatarUpload, setShowAvatarUpload] = useState(false);

  useEffect(() => { if (edit === "1") setIsEditing(true); }, [edit]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const h = () => setIsEditing(true);
    window.addEventListener("crema:edit-profile", h);
    return () => window.removeEventListener("crema:edit-profile", h);
  }, []);
  useEffect(() => {
    if (isEditing && user) {
      setEditName(user.display_name || ""); setEditBio(user.bio || "");
      setEditDrink(user.favorite_drink || ""); setEditCafe(user.favorite_cafe || "");
      setEditLocation(user.location || "");
    }
  }, [isEditing, user]);

  const loadData = useCallback(async () => {
    if (!user) return;
    const [postsR, shelfR, followingR, followersR] = await Promise.allSettled([
      apiFetchRaw(`/users/${user.username}/posts`),
      apiFetchRaw(`/shelves/filter?user_id=${user.id}`),
      apiFetchRaw("/my-following"),
      apiFetchRaw(`/followers/user_${user.id}`),
    ]);
    if (postsR.status === "fulfilled") { const d = postsR.value?.data ?? postsR.value; setPosts(d?.posts || []); }
    if (shelfR.status === "fulfilled") { const d = shelfR.value?.data ?? shelfR.value; setShelves(d && typeof d === "object" && !Array.isArray(d) ? d : { currently_drinking: [], drank: [], want_to_try: [] }); }
    if (followingR.status === "fulfilled") { const d = followingR.value?.data ?? followingR.value; setFollowingList(d?.following || []); }
    if (followersR.status === "fulfilled") { const d = followersR.value?.data ?? followersR.value; setFollowerCount(d?.follower_count || 0); }
    setLoading(false);
  }, [user]);

  useEffect(() => { loadData(); }, [loadData]);
  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile({ display_name: editName.trim(), bio: editBio.trim(), favorite_drink: editDrink.trim(), favorite_cafe: editCafe.trim(), location: editLocation.trim() });
      setIsEditing(false);
    } catch {} finally { setSaving(false); }
  };

  const handlePostSubmit = async (data: any) => {
    await apiFetchRaw("/posts", { method: "POST", body: JSON.stringify({ ...data, roaster_slug: `user_${user?.id}` }) });
    setShowCompose(false); loadData();
  };

  if (loading || !user) return <View style={s.loading}><ActivityIndicator size="large" color={t.color["text.primary"]} /></View>;
  if (user.account_type === "roaster" && user.roaster_slug) { router.replace(`/roaster/${user.roaster_slug}` as any); return null; }

  const shelfEntries = (shelves[activeShelf] || []);

  return (
    <View style={s.container}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.color["accent.cta"]} />}>

        {/* Hero */}
        <View style={s.hero}>
          <Pressable onPress={isEditing ? () => setShowAvatarUpload(true) : undefined} style={s.avatarWrap}>
            {user.avatar_url ? (
              <CroppedAvatar url={user.avatar_url} cropX={user.avatar_crop_x} cropY={user.avatar_crop_y} zoom={user.avatar_zoom} size={screenW > 900 ? 280 : Math.min(screenW * 0.45, 280)} />
            ) : (
              <View style={[s.avatarFb, { width: 280, height: 280 }]}><Text style={s.avatarFbLetter}>{(user.display_name || "?")[0]}</Text></View>
            )}
            {isEditing && <View style={s.avatarEditOverlay}><Camera size={24} color="#FAF8F0" /></View>}
          </Pressable>
          <View style={s.heroInfo}>
            {isEditing
              ? <TextInput value={editName} onChangeText={setEditName} style={s.editNameInput} placeholder="Name" placeholderTextColor={t.color["text.muted"]} />
              : <Text style={s.displayName}>{user.display_name}</Text>}
            {isEditing
              ? <TextInput value={editBio} onChangeText={setEditBio} style={s.editBioInput} placeholder="Bio" placeholderTextColor={t.color["text.muted"]} multiline />
              : user.bio ? <Text style={s.bio}>{user.bio}</Text> : null}
            <View style={s.heroIcons}>
              {(isEditing || user.favorite_drink) && <View style={s.iconRow}><HeroCoffeeIcon />{isEditing ? <TextInput value={editDrink} onChangeText={setEditDrink} style={s.editInline} placeholder="Drink" placeholderTextColor={t.color["text.muted"]} /> : <Text style={s.iconText}>{user.favorite_drink}</Text>}</View>}
              {(isEditing || user.favorite_cafe) && <View style={s.iconRow}><HeroHeartIcon />{isEditing ? <TextInput value={editCafe} onChangeText={setEditCafe} style={s.editInline} placeholder="Cafe" placeholderTextColor={t.color["text.muted"]} /> : <Text style={s.iconText}>{user.favorite_cafe}</Text>}</View>}
              {user.coffee_preference && <View style={s.iconRow}><HeroBeanIcon /><Text style={s.iconText}>{user.coffee_preference} {user.brewing_style} Roast Drinker</Text></View>}
              <View style={s.iconRow}><HeroPeopleIcon /><Text style={s.iconText}>{followerCount} followers</Text></View>
              {(isEditing || user.location) && <View style={s.iconRow}><HeroPinIcon />{isEditing ? <TextInput value={editLocation} onChangeText={setEditLocation} style={s.editInline} placeholder="Location" placeholderTextColor={t.color["text.muted"]} /> : <Text style={s.iconText}>{user.location}</Text>}</View>}
            </View>
            {isEditing && <View style={s.editActions}>
              <Pressable onPress={() => setIsEditing(false)} style={s.cancelBtn}><Text style={s.cancelText}>Cancel</Text></Pressable>
              <Pressable onPress={handleSave} style={s.saveBtn} disabled={saving}>{saving ? <ActivityIndicator size="small" color="#FAF8F0" /> : <Text style={s.saveText}>Save</Text>}</Pressable>
            </View>}
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

        {/* Tab content */}
        <View style={s.tabContent}>
          {activeTab === "posts" && <>
            {showCompose && <View style={{ marginBottom: 16 }}><ComposePost onSubmit={handlePostSubmit} onCancel={() => setShowCompose(false)} user={user} products={Array.from(productMap?.values() || [])} /></View>}
            {posts.length === 0 && !showCompose ? <Text style={s.empty}>No posts yet.</Text> :
              posts.slice(0, visiblePostCount).map((post, idx) => (
                <View key={post.id}>
                  <PostCard post={post} user={user} isOwner={user?.id === post.user_id}
                    onComment={(p) => openPostModal({ post: p, mode: "comment" })}
                    onRepost={(p) => openPostModal({ post: p, mode: "repost" })}
                    onViewOriginal={(id) => openPostModal({ postId: id, mode: "comment" })}
                    onDelete={async (p) => { await apiFetchRaw(`/posts/${p.id}`, { method: "DELETE" }); loadData(); }}
                  />
                  {idx < Math.min(posts.length, visiblePostCount) - 1 && <View style={s.divider} />}
                </View>
              ))}
          </>}
          {activeTab === "shelf" && <>
            <View style={s.shelfTabs}>
              {SHELF_KEYS.map((k) => (
                <Pressable key={k} onPress={() => setActiveShelf(k as ShelfSub)} style={s.shelfTab}>
                  <Text style={[s.shelfTabText, activeShelf === k && s.shelfTabActive]}>{SHELF_SUB_LABELS[k as ShelfSub]}</Text>
                  {activeShelf === k && <View style={s.shelfTabLine} />}
                </Pressable>
              ))}
            </View>
            {shelfEntries.length === 0 ? <Text style={s.empty}>Nothing here yet.</Text> :
              <CoffeeGrid entries={shelfEntries} productMap={productMap} onRemove={async (id) => { await apiFetchRaw(`/shelves/${id}`, { method: "DELETE" }); loadData(); }} />}
          </>}
          {activeTab === "following" && <>
            {followingList.length === 0 ? <Text style={s.empty}>Not following anyone yet.</Text> :
              followingList.map((f) => (
                <View key={f.slug} style={s.followRow}>
                  <Pressable onPress={() => f.is_roaster ? router.push(`/roaster/${f.roaster_slug}` as any) : router.push(`/user/${f.username}` as any)} style={s.followLeft}>
                    {f.avatar_url ? <CroppedAvatar url={f.avatar_url} size={36} /> : <View style={s.followFb}><Text style={s.followFbL}>{(f.display_name||"?")[0]}</Text></View>}
                    <View style={{ flex: 1, marginLeft: 10 }}><Text style={s.followName}>{f.display_name}</Text><Text style={s.followMeta}>{f.follower_count} followers</Text></View>
                  </Pressable>
                  <Pressable onPress={async () => { await apiFetchRaw(`/roasters/${f.slug}/follow`, { method: "POST" }); setFollowingList((p) => p.filter((x) => x.slug !== f.slug)); }} style={s.followingBtn}>
                    <Check size={10} color={t.color["text.primary"]} strokeWidth={2.5} /><Text style={s.followingBtnText}>Following</Text>
                  </Pressable>
                </View>
              ))}
          </>}
        </View>
      </ScrollView>

      {activeTab === "posts" && !showCompose && !isEditing && (
        <Pressable onPress={() => setShowCompose(true)} style={s.fab}>
          <Plus size={22} color={t.color["text.on-dark"]} strokeWidth={2.5} />
        </Pressable>
      )}
      <ImageUploadModal visible={showAvatarUpload} purpose="avatar" onConfirm={async (url) => { await updateProfile({ avatar_url: url }); setShowAvatarUpload(false); }} onClose={() => setShowAvatarUpload(false)} />
    </View>
  );
}

const s = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.color.bg } as any,
  container: { flex: 1, backgroundColor: t.color.bg },
  content: { maxWidth: 1200, alignSelf: "center" as any, width: "100%" as any, paddingBottom: 100 },
  hero: { flexDirection: "row", paddingHorizontal: "6.25%" as any, paddingTop: 24, paddingBottom: 16, gap: 40 } as any,
  avatarWrap: { position: "relative" } as any,
  avatarFb: { borderRadius: 8, backgroundColor: t.color["card.info"], alignItems: "center", justifyContent: "center" } as any,
  avatarFbLetter: { fontFamily: t.font.display, fontSize: 64, color: t.color["text.primary"] },
  avatarEditOverlay: { position: "absolute", bottom: 8, right: 8, backgroundColor: "rgba(53,17,1,0.6)", borderRadius: 20, padding: 8 } as any,
  heroInfo: { flex: 1, paddingTop: 8 },
  displayName: { fontFamily: t.font.display, fontSize: 40, color: t.color["text.primary"], marginBottom: 8 },
  bio: { fontFamily: t.font["body.regular"], fontSize: t.size["font.md"], color: t.color["text.secondary"], marginBottom: 12, lineHeight: 20 },
  heroIcons: { gap: 6 } as any,
  iconRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 } as any,
  iconText: { fontFamily: t.font["body.medium"], fontSize: t.size["font.base"], color: t.color["text.primary"] },
  editNameInput: { fontFamily: t.font.display, fontSize: 32, color: t.color["text.primary"], borderBottomWidth: 1, borderBottomColor: t.color.border, marginBottom: 8, paddingVertical: 4 },
  editBioInput: { fontFamily: t.font["body.regular"], fontSize: t.size["font.md"], color: t.color["text.primary"], borderWidth: 1, borderColor: t.color.border, borderRadius: 6, padding: 8, marginBottom: 8, minHeight: 60 } as any,
  editInline: { fontFamily: t.font["body.medium"], fontSize: t.size["font.base"], color: t.color["text.primary"], borderBottomWidth: 1, borderBottomColor: t.color.border, flex: 1, paddingVertical: 2 },
  editActions: { flexDirection: "row", gap: 10, marginTop: 12 } as any,
  cancelBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 4, borderWidth: 1, borderColor: t.color.border },
  cancelText: { fontFamily: t.font["body.medium"], fontSize: t.size["font.base"], color: t.color["text.secondary"] },
  saveBtn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 4, backgroundColor: t.color["text.primary"], minWidth: 80, alignItems: "center" } as any,
  saveText: { fontFamily: t.font["body.semibold"], fontSize: t.size["font.base"], color: t.color["text.on-dark"] },
  tabBar: { flexDirection: "row", paddingHorizontal: "6.25%" as any, borderBottomWidth: 1, borderBottomColor: t.color["border.light"], marginTop: 8 } as any,
  tab: { paddingVertical: 12, marginRight: 32, alignItems: "center" } as any,
  tabText: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.muted"], letterSpacing: 0.5 },
  tabActive: { color: t.color["text.primary"] },
  tabLine: { height: 3, backgroundColor: t.color["text.primary"], borderRadius: 1.5, marginTop: 8, width: "100%" } as any,
  tabContent: { paddingHorizontal: "6.25%" as any, paddingTop: 16 },
  shelfTabs: { flexDirection: "row", gap: 24, marginBottom: 16 } as any,
  shelfTab: { alignItems: "center" } as any,
  shelfTabText: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.muted"] },
  shelfTabActive: { color: t.color["text.primary"] },
  shelfTabLine: { height: 2, backgroundColor: t.color.accent, borderRadius: 1, marginTop: 4, width: "100%" } as any,
  followRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: t.color["border.light"] } as any,
  followLeft: { flexDirection: "row", alignItems: "center", flex: 1 } as any,
  followFb: { width: 36, height: 36, borderRadius: 18, backgroundColor: t.color["text.primary"], alignItems: "center", justifyContent: "center" } as any,
  followFbL: { fontFamily: t.font["body.semibold"], fontSize: 13, color: t.color["text.on-dark"] },
  followName: { fontFamily: t.font["body.medium"], fontSize: t.size["font.md"], color: t.color["text.primary"] },
  followMeta: { fontFamily: t.font["body.regular"], fontSize: t.size["font.sm"], color: t.color["text.muted"], marginTop: 2 },
  followingBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, width: 88, height: 27, borderRadius: 2, backgroundColor: t.color.accent, borderWidth: 1.5, borderColor: t.color.accent } as any,
  followingBtnText: { fontFamily: t.font["body.semibold"], fontSize: 12, color: t.color["text.primary"] },
  divider: { height: 1, backgroundColor: t.color.divider },
  empty: { fontFamily: t.font["body.regular"], fontSize: t.size["font.md"], color: t.color["text.muted"], textAlign: "center", paddingVertical: 40 },
  fab: { position: "absolute", bottom: 28, right: 28, width: t.size["fab.size"], height: t.size["fab.size"], borderRadius: t.size["fab.size"] / 2, alignItems: "center", justifyContent: "center", backgroundColor: t.color["text.primary"], shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 8 } as any,
});
