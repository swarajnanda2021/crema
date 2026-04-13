/**
 * Roaster Profile Page — CRUD Utopia rewrite.
 *
 * Public visitor:  left panel (about, meta, Follow) + right scroll (hero, posts, beans)
 * Owner (isOwner): same layout + compose, edit profile, product management
 *
 * Uses PostCard for all post rendering, EditableCoffeeCard for bean creation,
 * and design tokens throughout — no hardcoded colors.
 */

import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import {
  View, Text, ScrollView, Pressable, StyleSheet, Modal,
  LayoutChangeEvent, Platform, TextInput, ActivityIndicator,
  useWindowDimensions,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, Stack, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import Svg, { Path } from "react-native-svg";
import { Plus, X, PenLine, Camera, MapPin, Check } from "lucide-react-native";

import { useCoffeeData } from "../../src/hooks/useCoffeeData";
import { useRoasterProfiles } from "../../src/hooks/useRoasterProfiles";
import { useAuth } from "../../src/hooks/useAuth";
import { apiFetchRaw, resolveUploadUrl } from "../../src/api/client";
import { t } from "../../src/tokens/useTokens";
import CoffeeCard from "../../src/components/CoffeeCard";
import Navbar from "../../src/components/Navbar";
import PostCard from "../../src/components/domain/PostCard";
import EditableCoffeeCard from "../../src/components/domain/EditableCoffeeCard";
import ComposePost from "../../src/components/ComposePost";
import ImageUploadModal from "../../src/components/ImageUploadModal";
import { openPostModal } from "../../src/components/primitives";

// ── Icons (Figma SVG paths, left panel only) ─────────────────────────────────

function BackArrowIcon() {
  return (
    <Svg width={7} height={14} viewBox="0 0 7 14" fill="none">
      <Path d="M6 1L1 7L6 13" stroke={t.color.divider} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function MapPinIcon({ color = t.color.accent }: { color?: string }) {
  return (
    <Svg width={12} height={16} viewBox="0 0 13.9649 17.3005" fill="none">
      <Path d="M0.75 6.9138C0.75 11.2337 4.52909 14.806 6.20182 16.1756C6.44121 16.3716 6.56234 16.4708 6.74095 16.5211C6.88002 16.5602 7.0847 16.5602 7.22378 16.5211C7.40271 16.4707 7.523 16.3725 7.76329 16.1757C9.43602 14.8061 13.2149 11.234 13.2149 6.9142C13.2149 5.2794 12.5583 3.71137 11.3895 2.55539C10.2207 1.39942 8.63552 0.75 6.98257 0.75C5.32961 0.75 3.74427 1.39952 2.57545 2.55549C1.40664 3.71147 0.75 5.27901 0.75 6.9138Z" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M5.20178 6.09214C5.20178 7.0756 5.99903 7.87285 6.98249 7.87285C7.96595 7.87285 8.76321 7.0756 8.76321 6.09214C8.76321 5.10868 7.96595 4.31142 6.98249 4.31142C5.99903 4.31142 5.20178 5.10868 5.20178 6.09214Z" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function ExternalLinkIcon({ color = t.color.accent }: { color?: string }) {
  return (
    <Svg width={14} height={14} viewBox="0 0 15.5 15.5" fill="none">
      <Path d="M5.41685 1.68333H3.73685C2.69142 1.68333 2.16831 1.68333 1.76901 1.88679C1.41778 2.06575 1.13242 2.35111 0.953455 2.70234C0.750001 3.10165 0.750001 3.62475 0.750001 4.67018V11.7635C0.750001 12.8089 0.750001 13.3314 0.953455 13.7307C1.13242 14.0819 1.41778 14.3678 1.76901 14.5467C2.16792 14.75 2.69039 14.75 3.73378 14.75H10.8329C11.8763 14.75 12.398 14.75 12.7969 14.5467C13.1481 14.3678 13.4344 14.0817 13.6134 13.7304C13.8167 13.3315 13.8167 12.8096 13.8167 11.7662V10.0833M14.75 5.41667V0.75M14.75 0.75H10.0833M14.75 0.75L8.21667 7.28333" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function UsersIcon({ color = t.color.accent }: { color?: string }) {
  return (
    <Svg width={18} height={15} viewBox="0 0 19.562 16.5517" fill="none">
      <Path d="M18.812 15.8016C18.812 14.054 17.1366 12.5672 14.7982 12.0162M12.7913 15.8017C12.7913 13.5849 10.0958 11.7879 6.77067 11.7879C3.44554 11.7879 0.75 13.5849 0.75 15.8017M12.7913 8.77755C15.0081 8.77755 16.8051 6.98052 16.8051 4.76378C16.8051 2.54703 15.0081 0.75 12.7913 0.75M6.77067 8.77755C4.55392 8.77755 2.75689 6.98052 2.75689 4.76378C2.75689 2.54703 4.55392 0.75 6.77067 0.75C8.98741 0.75 10.7844 2.54703 10.7844 4.76378C10.7844 6.98052 8.98741 8.77755 6.77067 8.77755Z" stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function LeftPanelShareIcon({ color = t.color.accent }: { color?: string }) {
  return (
    <Svg width={14} height={16} viewBox="0 0 14.8014 17.4264" fill="none">
      <Path d="M11.3382 7.40073H13.3069C13.481 7.40073 13.6479 7.46987 13.771 7.59294C13.894 7.71601 13.9632 7.88293 13.9632 8.05698V15.9319C13.9632 16.106 13.894 16.2729 13.771 16.396C13.6479 16.519 13.481 16.5882 13.3069 16.5882H1.49443C1.32039 16.5882 1.15347 16.519 1.0304 16.396C0.907324 16.2729 0.838184 16.106 0.838184 15.9319V8.05698C0.838184 7.88293 0.907324 7.71601 1.0304 7.59294C1.15347 7.46987 1.32039 7.40073 1.49443 7.40073H3.46318" stroke={color} strokeWidth={1.67637} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M4.11968 4.11942L7.40093 0.838184L10.6822 4.11942" stroke={color} strokeWidth={1.67637} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M7.40091 0.838184V10.0256" stroke={color} strokeWidth={1.67637} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

// ── FollowButton ─────────────────────────────────────────────────────────────

function FollowButton({ following, onToggle }: { following: boolean; onToggle: () => void }) {
  return (
    <Pressable onPress={onToggle} style={[fb.btn, following && fb.btnFollowing]}>
      {!following && <Plus size={10} color={t.color["text.on-dark"]} strokeWidth={2.5} />}
      {following && <Check size={10} color={t.color["text.primary"]} strokeWidth={2.5} />}
      <Text style={[fb.text, following && fb.textFollowing]}>
        {following ? "Following" : "Follow"}
      </Text>
    </Pressable>
  );
}

const fb = StyleSheet.create({
  btn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 4, width: 71, height: 27, borderRadius: 2,
    borderWidth: 1.5, borderColor: t.color["text.on-dark"],
  },
  btnFollowing: { width: 88, backgroundColor: t.color.accent, borderColor: t.color.accent },
  text: { fontFamily: t.font["body.semibold"], fontSize: 12, color: t.color["text.on-dark"] },
  textFollowing: { color: t.color["text.primary"] },
});

// ── CoffeeGrid ───────────────────────────────────────────────────────────────

const GRID_GAP = 12;
const GRID_PAD = 20;
const TARGET_CARD_W = 240;
const CARD_ASPECT = 372 / 240;

function CoffeeGrid({
  coffees, isOwner, onDeleteProduct, roasterName, onSaveCard,
}: {
  coffees: any[]; isOwner?: boolean;
  onDeleteProduct?: (id: string) => void;
  roasterName?: string; onSaveCard?: (data: any) => Promise<void>;
}) {
  const [containerW, setContainerW] = useState(0);
  const available = containerW > 0 ? containerW - GRID_PAD * 2 : 800;
  const numCols = Math.max(1, Math.min(4, Math.round((available + GRID_GAP) / (TARGET_CARD_W + GRID_GAP))));
  const cardW = Math.floor((available - GRID_GAP * (numCols - 1)) / numCols);
  const cardH = Math.floor(cardW * CARD_ASPECT);

  if (coffees.length === 0 && !isOwner) {
    return (
      <View style={cg.empty}><Text style={cg.emptyText}>No coffees listed yet.</Text></View>
    );
  }
  return (
    <View onLayout={(e) => setContainerW(e.nativeEvent.layout.width)} style={[cg.grid, { gap: GRID_GAP, paddingHorizontal: GRID_PAD }]}>
      {coffees.map((c) => (
        <View key={c.product_id || c.id} style={{ width: cardW, height: cardH }}>
          <CoffeeCard
            coffee={c} width={cardW} height={cardH}
            shelfMode={isOwner && !!onDeleteProduct}
            onRemove={isOwner && onDeleteProduct ? () => onDeleteProduct(c.product_id || c.id) : undefined}
          />
        </View>
      ))}
      {isOwner && roasterName && onSaveCard && containerW > 0 && (
        <View key="__editable__" style={{ width: cardW, height: cardH }}>
          <EditableCoffeeCard roasterName={roasterName} width={cardW} height={cardH} onSave={onSaveCard} />
        </View>
      )}
    </View>
  );
}

const cg = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap" },
  empty: { paddingVertical: 48, alignItems: "center" },
  emptyText: { fontFamily: t.font["body.regular"], fontSize: 14, color: t.color["text.secondary"] },
});

// ── Main Page ────────────────────────────────────────────────────────────────

const NAVBAR_H = 72;
const POSTS_PER_PAGE = 5;
const ABOUT_LIMIT = 260;

export default function RoasterDetailPage() {
  const { slug, edit } = useLocalSearchParams<{ slug: string; edit?: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const { products, roasters, appendProducts, removeProduct } = useCoffeeData();
  const { getProfile, refreshProfiles, loading: profileLoading } = useRoasterProfiles();
  const { height: winH } = useWindowDimensions();

  // Roaster lookup
  const productRoaster = roasters.find((r: any) => r.slug === slug);
  const profile = getProfile(slug, productRoaster?.website, productRoaster?.name);
  const roaster = productRoaster ?? (profile ? {
    slug: profile.roaster_slug ?? slug,
    name: profile.name ?? slug,
    city: profile.city ?? null,
    website: profile.website ?? null,
  } : null);

  // Products (merge local + catalog, dedup)
  const catalogCoffees = useMemo(() => products.filter((p: any) => p.roaster_slug === slug), [products, slug]);
  const [localCoffees, setLocalCoffees] = useState<any[]>([]);
  const [deletedProductIds, setDeletedProductIds] = useState<Set<string>>(new Set());
  const coffees = useMemo(() => {
    const seen = new Set<string>();
    return [...localCoffees, ...catalogCoffees].filter((c) => {
      const id = c.product_id ?? c.id;
      if (deletedProductIds.has(id)) return false;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }, [localCoffees, catalogCoffees, deletedProductIds]);

  const isOwner = user?.account_type === "roaster" && user?.roaster_slug === slug;

  // Posts
  const [allPosts, setAllPosts] = useState<any[]>([]);
  const [postsLoading, setPostsLoading] = useState(true);
  const [visiblePosts, setVisiblePosts] = useState(POSTS_PER_PAGE);

  // Follow
  const [following, setFollowing] = useState(false);
  const [followerCount, setFollowerCount] = useState(0);
  const [followers, setFollowers] = useState<any[]>([]);
  const [showFollowersModal, setShowFollowersModal] = useState(false);
  const [myFollows, setMyFollows] = useState<string[]>([]);

  // Tabs & compose
  const [activeTab, setActiveTab] = useState<"posts" | "beans">("posts");
  const [showCompose, setShowCompose] = useState(false);
  const [composing, setComposing] = useState(false);
  const [editingPost, setEditingPost] = useState<any>(null);
  const [aboutExpanded, setAboutExpanded] = useState(false);

  // Profile editing (owner)
  const [isEditing, setIsEditing] = useState(edit === "1");
  const [saving, setSaving] = useState(false);

  // Profile derived values
  const heroImageUrl = useMemo(
    () => profile?.hero_image_url || (!profileLoading && coffees.find((c: any) => c.image_url)?.image_url) || null,
    [profile, coffees, profileLoading],
  );
  const logoUrl = profile?.logo_url ?? null;
  const rawSpecs = profile?.specialties;
  const parsedSpecs = Array.isArray(rawSpecs) ? rawSpecs
    : typeof rawSpecs === "string" && rawSpecs.startsWith("[") ? JSON.parse(rawSpecs)
    : typeof rawSpecs === "string" && rawSpecs ? rawSpecs.split(",").map((s: string) => s.trim())
    : [];
  const specialtyTags: string[] = parsedSpecs.length > 0
    ? parsedSpecs.slice(0, 4)
    : ["Single Origin", "Estate Grown", "Specialty Grade"];
  const city = roaster?.city || profile?.city || null;
  const website = roaster?.website || profile?.website || null;
  const aboutBlurb = profile?.about_blurb || null;

  // Edit form state
  const [editAbout, setEditAbout] = useState(aboutBlurb || "");
  const [editSpecialties, setEditSpecialties] = useState(specialtyTags.join(", "));
  const [editWebsite, setEditWebsite] = useState(website || "");
  const [editCity, setEditCity] = useState(city || "");
  const [editLogo, setEditLogo] = useState(logoUrl || "");
  const [editHero, setEditHero] = useState(heroImageUrl || "");
  const heroCropX = profile?.hero_crop_x ?? 50;
  const heroCropY = profile?.hero_crop_y ?? 50;
  const heroZoom = profile?.hero_zoom ?? 1;
  const [editCropX, setEditCropX] = useState(heroCropX);
  const [editCropY, setEditCropY] = useState(heroCropY);
  const [editHeroZoom, setEditHeroZoom] = useState(heroZoom);
  const [isDraggingHero, setIsDraggingHero] = useState(false);
  const [heroImgAspect, setHeroImgAspect] = useState(1.8);
  const [heroContW, setHeroContW] = useState(0);
  const [heroContH, setHeroContH] = useState(0);
  const dragStartRef = useRef({ x: 0, y: 0, cropX: 50, cropY: 50 });
  const heroWrapRef = useRef<View>(null);
  const [showLogoUpload, setShowLogoUpload] = useState(false);
  const [showHeroUpload, setShowHeroUpload] = useState(false);

  // ── Data loading ───────────────────────────────────────────────────────────

  const loadPosts = useCallback(async () => {
    try {
      setPostsLoading(true);
      const res = await apiFetchRaw(`/roasters/${slug}/posts`);
      const d = res?.data ?? res;
      setAllPosts(d?.posts || []);
    } catch { setAllPosts([]); }
    finally { setPostsLoading(false); }
  }, [slug]);

  useEffect(() => { if (slug) loadPosts(); }, [loadPosts, slug]);

  useEffect(() => {
    if (!slug) return;
    apiFetchRaw(`/followers/${slug}`).then((res) => {
      const d = res?.data ?? res;
      setFollowerCount(d?.follower_count || 0);
      setFollowers(d?.followers || []);
    }).catch(() => {});
    apiFetchRaw(`/follow-status/${slug}`).then((res) => {
      const d = res?.data ?? res;
      setFollowing(d?.following || false);
    }).catch(() => {});
  }, [slug]);

  // Default to beans tab if no posts
  useEffect(() => {
    if (!postsLoading && allPosts.length === 0) setActiveTab("beans");
  }, [postsLoading, allPosts]);

  // Sync edit state
  useEffect(() => { if (edit === "1" && isOwner) setIsEditing(true); }, [edit, isOwner]);
  useEffect(() => {
    if (isEditing) {
      setEditAbout(aboutBlurb || ""); setEditSpecialties(specialtyTags.join(", "));
      setEditWebsite(website || ""); setEditCity(city || "");
      setEditLogo(logoUrl || ""); setEditHero(heroImageUrl || "");
      setEditCropX(heroCropX); setEditCropY(heroCropY); setEditHeroZoom(heroZoom);
    }
  }, [isEditing, aboutBlurb, profile]);

  // Fetch my follows when followers modal opens
  useEffect(() => {
    if (!showFollowersModal || !user) return;
    apiFetchRaw<any>("/my-following")
      .then((res) => { const d = res?.data ?? res; setMyFollows(d.following || []); })
      .catch(() => {});
  }, [showFollowersModal, user]);

  // ── Action handlers ────────────────────────────────────────────────────────

  const handleFollowToggle = useCallback(async () => {
    try {
      const res = await apiFetchRaw(`/roasters/${slug}/follow`, { method: "POST" });
      const d = res?.data ?? res;
      setFollowing(d.following);
      setFollowerCount(d.follower_count);
      apiFetchRaw(`/followers/${slug}`).then((r) => {
        const fd = r?.data ?? r;
        setFollowers(fd?.followers || []);
      }).catch(() => {});
    } catch { setFollowing((f) => !f); }
  }, [slug]);

  const handleToggleFollowInModal = useCallback(async (roasterSlug: string) => {
    try {
      const res = await apiFetchRaw<any>(`/roasters/${roasterSlug}/follow`, { method: "POST" });
      const d = res?.data ?? res;
      setMyFollows((prev) => d.following ? [...prev, roasterSlug] : prev.filter((s) => s !== roasterSlug));
    } catch {}
  }, []);

  const handlePinToggle = useCallback(async (postId: number) => {
    try { await apiFetchRaw(`/posts/${postId}/pin`, { method: "PUT" }); await loadPosts(); }
    catch (e: any) { console.warn("Pin toggle error:", e.message); }
  }, [loadPosts]);

  const handleDeletePost = useCallback(async (postId: number) => {
    try {
      await apiFetchRaw(`/posts/${postId}`, { method: "DELETE" });
      setAllPosts((prev) => prev.filter((p) => p.id !== postId));
    } catch (e: any) { console.warn("Delete post error:", e.message); }
  }, []);

  const handleEditPost = useCallback(async (postId: number, data: any) => {
    await apiFetchRaw(`/posts/${postId}`, { method: "PUT", body: JSON.stringify(data) });
    setEditingPost(null);
    await loadPosts();
  }, [loadPosts]);

  const handleCreatePost = useCallback(async (data: any) => {
    try {
      setComposing(true);
      await apiFetchRaw("/posts", {
        method: "POST",
        body: JSON.stringify({
          title: data.title, teaser: data.teaser,
          external_url: data.external_url || null,
          cover_image_url: data.cover_image_url || null,
          post_type: data.post_type || "article",
          location: data.location || null, images: data.images || [],
        }),
      });
      setShowCompose(false);
      await loadPosts();
    } catch (e: any) { console.warn("Create post error:", e.message); }
    finally { setComposing(false); }
  }, [loadPosts]);

  const handleCreateProduct = useCallback(async (data: any) => {
    try {
      const raw = await apiFetchRaw(`/roasters/${slug}/products`, {
        method: "POST", body: JSON.stringify(data),
      });
      const d = raw?.data ?? raw;
      const normalised = {
        ...d, product_id: `rp_${d.id}`, roaster_slug: slug,
        roaster_name: roaster?.name ?? slug.replace(/-/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
        _source: "roaster_managed",
      };
      setLocalCoffees((prev) => [normalised, ...prev]);
      appendProducts([normalised]);
    } catch (e: any) { console.warn("Create product error:", e.message); }
  }, [slug, appendProducts, roaster]);

  const handleDeleteProduct = useCallback(async (productId: string) => {
    setDeletedProductIds((prev) => new Set([...prev, productId]));
    setLocalCoffees((prev) => prev.filter((c) => (c.product_id ?? c.id) !== productId));
    removeProduct(productId);
    try {
      const isRoasterManaged = productId.startsWith("rp_");
      if (isRoasterManaged) {
        await apiFetchRaw(`/roasters/${slug}/products/${productId.replace(/^rp_/, "")}`, { method: "DELETE" });
      } else {
        await apiFetchRaw(`/roasters/${slug}/products/hide`, {
          method: "POST", body: JSON.stringify({ product_id: productId }),
        });
      }
    } catch (e: any) { console.warn("Delete product error:", e.message); }
  }, [slug, removeProduct]);

  const handleSaveProfile = async () => {
    setSaving(true);
    try {
      const specs = editSpecialties.split(",").map((s) => s.trim()).filter(Boolean);
      await apiFetchRaw(`/roasters/${slug}/profile`, {
        method: "PUT",
        body: JSON.stringify({
          about_blurb: editAbout, specialties: specs, website: editWebsite,
          city: editCity, logo_url: editLogo, hero_image_url: editHero,
          hero_crop_x: editCropX, hero_crop_y: editCropY, hero_zoom: editHeroZoom,
        }),
      });
      await refreshProfiles();
      setIsEditing(false);
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("edit");
        window.history.replaceState({}, "", url.toString());
      }
    } catch (e) { console.warn("Save roaster profile error:", e); }
    finally { setSaving(false); }
  };

  // ── Hero drag-to-reposition ────────────────────────────────────────────────

  const handleHeroDragStart = useCallback((e: any) => {
    if (!isEditing) return;
    e.preventDefault();
    dragStartRef.current = { x: e.clientX, y: e.clientY, cropX: editCropX, cropY: editCropY };
    setIsDraggingHero(true);
    const handleMove = (ev: MouseEvent) => {
      const el = heroWrapRef.current as unknown as HTMLElement;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setEditCropX(Math.max(0, Math.min(100, dragStartRef.current.cropX - ((ev.clientX - dragStartRef.current.x) / rect.width) * 100)));
      setEditCropY(Math.max(0, Math.min(100, dragStartRef.current.cropY - ((ev.clientY - dragStartRef.current.y) / rect.height) * 100)));
    };
    const handleUp = () => {
      setIsDraggingHero(false);
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
  }, [isEditing, editCropX, editCropY]);

  const handleHeroWheel = useCallback((e: any) => {
    if (!isEditing || !e.ctrlKey) return;
    e.preventDefault();
    setEditHeroZoom((z) => Math.round(Math.max(1, Math.min(5, z - e.deltaY * 0.01)) * 100) / 100);
  }, [isEditing]);

  // Sorted posts: pinned first, then by date
  const sortedPosts = useMemo(() => {
    const pinned = allPosts.filter((p) => p.is_featured);
    const rest = allPosts.filter((p) => !p.is_featured);
    return [...pinned, ...rest];
  }, [allPosts]);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!roaster) {
    return (
      <>
        <Stack.Screen options={{ headerShown: false }} />
        <Navbar />
        <View style={s.notFound}><Text style={s.notFoundText}>Roaster not found</Text></View>
      </>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <Navbar />

      {/* Edit banner */}
      {isOwner && isEditing && (
        <View style={s.editBanner}>
          <View style={s.editBannerLeft}>
            <PenLine size={12} color={t.color.accent} strokeWidth={2} />
            <Text style={s.editBannerLabel}>Editing profile</Text>
          </View>
          <View style={s.editBannerRight}>
            <Pressable onPress={() => setIsEditing(false)} style={s.editBannerDiscard}>
              <Text style={s.editBannerDiscardText}>Discard</Text>
            </Pressable>
            <Pressable onPress={handleSaveProfile} style={s.editBannerSave} disabled={saving}>
              {saving ? <ActivityIndicator size="small" color={t.color["text.on-dark"]} /> : <Text style={s.editBannerSaveText}>Save changes</Text>}
            </Pressable>
          </View>
        </View>
      )}

      <View style={[s.pageContainer, { height: isEditing ? winH - NAVBAR_H - 44 : winH - NAVBAR_H }]}>

        {/* ── LEFT PANEL ── */}
        <View style={[s.leftPanel, { height: isEditing ? winH - NAVBAR_H - 44 : winH - NAVBAR_H }, isEditing && { paddingBottom: 120 }]}>
          <Pressable onPress={() => router.back()} style={s.backBtn}>
            <BackArrowIcon />
            <Text style={s.backText}>Back</Text>
          </Pressable>

          <Pressable onPress={() => { if (Platform.OS === "web" && navigator?.clipboard) navigator.clipboard.writeText(window.location.href); }} style={s.shareRow}>
            <Text style={s.shareText}>SHARE</Text>
            <LeftPanelShareIcon />
          </Pressable>

          <Text style={s.roasterName} numberOfLines={3}>{roaster.name}</Text>

          {/* About */}
          {isEditing ? (
            <View style={s.aboutBlock}>
              <TextInput style={[s.aboutText, s.inlineEdit]} value={editAbout} onChangeText={setEditAbout}
                placeholder="Tell people about your roastery\u2026" placeholderTextColor="rgba(199,186,165,0.35)" multiline />
            </View>
          ) : aboutBlurb ? (
            <View style={s.aboutBlock}>
              <Text style={s.aboutText}>
                {aboutExpanded || aboutBlurb.length <= ABOUT_LIMIT ? aboutBlurb : aboutBlurb.slice(0, ABOUT_LIMIT) + "\u2026"}
                {aboutBlurb.length > ABOUT_LIMIT && (
                  <Text onPress={() => setAboutExpanded((v) => !v)} style={s.aboutMore}>{aboutExpanded ? " less" : " more"}</Text>
                )}
              </Text>
            </View>
          ) : isOwner ? (
            <Pressable onPress={() => setIsEditing(true)} style={s.aboutBlock}>
              <Text style={[s.aboutText, { opacity: 0.4 }]}>Tap the pencil to add your story\u2026</Text>
            </Pressable>
          ) : null}

          {/* Logo upload (edit only) */}
          {isEditing && (
            <Pressable onPress={() => setShowLogoUpload(true)} style={s.uploadTrigger}>
              {editLogo ? (
                <Image source={{ uri: resolveUploadUrl(editLogo) }} style={s.uploadThumb} contentFit="cover" />
              ) : (
                <View style={s.uploadThumbEmpty}><Camera size={24} color={t.color.divider} strokeWidth={1.5} /></View>
              )}
              <Text style={s.uploadTriggerText}>Change logo</Text>
            </Pressable>
          )}

          {!isEditing && <View style={{ flex: 1 }} />}
          {isEditing && <View style={{ height: 24 }} />}

          {/* Specialty tags */}
          <View style={s.tagBand}>
            {!isEditing && <View style={s.rule} />}
            {isEditing ? (
              <TextInput style={[s.tagText, s.inlineEditTag]} value={editSpecialties} onChangeText={setEditSpecialties}
                placeholder="Single Origin, Estate Grown" placeholderTextColor="rgba(199,186,165,0.35)" />
            ) : (
              <Text style={s.tagText}>{specialtyTags.join(" / ")}</Text>
            )}
            {!isEditing && <View style={s.rule} />}
          </View>

          {/* Meta row */}
          <View style={s.metaRow}>
            {isEditing ? (
              <>
                <View style={s.metaItem}>
                  <ExternalLinkIcon />
                  <TextInput style={s.inlineEditMeta} value={editWebsite} onChangeText={setEditWebsite}
                    placeholder="Website URL" placeholderTextColor="rgba(199,186,165,0.35)" autoCapitalize="none" />
                </View>
                <View style={s.metaItem}>
                  <MapPinIcon />
                  <TextInput style={s.inlineEditMeta} value={editCity} onChangeText={setEditCity}
                    placeholder="City" placeholderTextColor="rgba(199,186,165,0.35)" />
                </View>
              </>
            ) : (
              <>
                {website && (
                  <Pressable onPress={() => Linking.openURL(website)} style={s.metaItem}>
                    <ExternalLinkIcon /><Text style={s.metaText}>Website</Text>
                  </Pressable>
                )}
                <Pressable onPress={() => setShowFollowersModal(true)} style={s.metaItem}>
                  <UsersIcon /><Text style={s.metaText}>{followerCount} {followerCount === 1 ? "follower" : "followers"}</Text>
                </Pressable>
                {city && (<View style={s.metaItem}><MapPinIcon /><Text style={s.metaText}>{city}</Text></View>)}
              </>
            )}
          </View>

          {!isEditing && <View style={s.rule} />}

          {!isOwner && (
            <View style={s.followRow}><FollowButton following={following} onToggle={handleFollowToggle} /></View>
          )}
        </View>

        {/* ── RIGHT PANEL ── */}
        <View style={s.rightPanel}>
          <ScrollView
            style={s.rightScroll} contentContainerStyle={s.rightContent}
            showsVerticalScrollIndicator={false} scrollEventThrottle={400}
            onScroll={(e) => {
              const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
              if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 300) {
                if (activeTab === "posts" && visiblePosts < sortedPosts.length) {
                  setVisiblePosts((c) => Math.min(c + POSTS_PER_PAGE, sortedPosts.length));
                }
              }
            }}
          >
            {/* Hero */}
            <View
              ref={heroWrapRef}
              style={[s.heroImageWrap, isEditing && isDraggingHero && { cursor: "grabbing" } as any, isEditing && !isDraggingHero && { cursor: "grab" } as any]}
              onLayout={(e) => { setHeroContW(e.nativeEvent.layout.width); setHeroContH(e.nativeEvent.layout.height); }}
              {...(isEditing && Platform.OS === "web" ? { onMouseDown: handleHeroDragStart, onWheel: handleHeroWheel } : {})}
            >
              {(isEditing ? editHero : heroImageUrl) ? (() => {
                const cW = heroContW || 800, cH = heroContH || 334;
                const zoom = isEditing ? editHeroZoom : heroZoom;
                const cx = isEditing ? editCropX : heroCropX;
                const cy = isEditing ? editCropY : heroCropY;
                const contAspect = cW / cH;
                const MIN_OVER = 1.15;
                let iW: number, iH: number;
                if (heroImgAspect > contAspect) { iH = cH * MIN_OVER * zoom; iW = iH * heroImgAspect; }
                else { iW = cW * MIN_OVER * zoom; iH = iW / heroImgAspect; }
                const tx = -(iW - cW) * (cx / 100), ty = -(iH - cH) * (cy / 100);
                return (
                  <Image
                    source={{ uri: resolveUploadUrl(isEditing ? editHero : heroImageUrl) }}
                    style={{ position: "absolute", width: iW, height: iH, left: tx, top: ty } as any}
                    contentFit="fill"
                    onLoad={(e: any) => { const src = e?.source; if (src?.width && src?.height) setHeroImgAspect(src.width / src.height); }}
                  />
                );
              })() : (
                <View style={[StyleSheet.absoluteFillObject, { backgroundColor: t.color["roaster.hero.fallback"] }]} />
              )}
              {isOwner && isEditing && !isDraggingHero && (
                <View style={s.heroDragHint} pointerEvents="none">
                  <Text style={s.heroDragHintText}>Drag to reposition {"\u00B7"} Pinch to zoom</Text>
                </View>
              )}
              {isOwner && isEditing && (
                <Pressable onPress={() => setShowHeroUpload(true)} style={s.heroEditBtn}>
                  <Camera size={14} color={t.color["text.on-dark"]} strokeWidth={1.5} />
                  <Text style={s.heroEditBtnText}>Change cover</Text>
                </Pressable>
              )}
            </View>

            {/* Tab bar */}
            <View style={s.rightTabBar}>
              {!postsLoading && allPosts.length > 0 && (
                <Pressable onPress={() => setActiveTab("posts")} style={s.rightTab}>
                  <Text style={[s.rightTabText, activeTab === "posts" && s.rightTabTextActive]}>POSTS</Text>
                  {activeTab === "posts" && <View style={s.rightTabUnderline} />}
                </Pressable>
              )}
              <Pressable onPress={() => setActiveTab("beans")} style={s.rightTab}>
                <Text style={[s.rightTabText, activeTab === "beans" && s.rightTabTextActive]}>BEANS</Text>
                {activeTab === "beans" && <View style={s.rightTabUnderline} />}
              </Pressable>
            </View>

            {/* POSTS TAB */}
            {activeTab === "posts" && (
              <>
                {showCompose && (
                  <>
                    <ComposePost onSubmit={handleCreatePost} onCancel={() => setShowCompose(false)} loading={composing} products={products} user={user} />
                    {sortedPosts.length > 0 && <View style={s.dividerLight} />}
                  </>
                )}
                {!postsLoading && sortedPosts.length > 0 && sortedPosts.slice(0, visiblePosts).map((post, i) => (
                  <View key={post.id}>
                    <PostCard
                      post={post} user={user} isOwner={isOwner}
                      onComment={(p) => openPostModal({ post: p, mode: "comment" })}
                      onRepost={(p) => openPostModal({ post: p, mode: "repost" })}
                      onViewOriginal={(id) => openPostModal({ postId: id, mode: "comment" })}
                      onEdit={(p) => setEditingPost(p)}
                      onPin={(p) => handlePinToggle(p.id)}
                      onDelete={(p) => handleDeletePost(p.id)}
                    />
                    {i < Math.min(sortedPosts.length, visiblePosts) - 1 && <View style={s.dividerLight} />}
                  </View>
                ))}
                {isOwner && !postsLoading && allPosts.length === 0 && (
                  <View style={s.emptyPostsWrap}>
                    <Text style={s.emptyPostsTitle}>Share your story</Text>
                    <Text style={s.emptyPostsBody}>Post about your coffee, link to press coverage, or share anything worth reading.</Text>
                    <Pressable onPress={() => setShowCompose(true)} style={s.emptyPostsBtn}>
                      <Text style={s.emptyPostsBtnText}>Write your first post {"\u2192"}</Text>
                    </Pressable>
                  </View>
                )}
              </>
            )}

            {/* BEANS TAB */}
            {activeTab === "beans" && (
              <>
                <Text style={s.gridHeading}>
                  {`Explore ${coffees.length} ${coffees.length === 1 ? "coffee" : "coffees"} from ${roaster.name}`}
                </Text>
                <CoffeeGrid coffees={coffees} isOwner={isOwner} onDeleteProduct={handleDeleteProduct} roasterName={roaster.name} onSaveCard={handleCreateProduct} />
              </>
            )}

            {/* Followers modal */}
            <Modal visible={showFollowersModal} transparent animationType="fade" onRequestClose={() => setShowFollowersModal(false)}>
              <View style={s.followersOverlayWrap}>
                <Pressable style={s.followersOverlayBg} onPress={() => setShowFollowersModal(false)} />
                <View style={s.followersModal}>
                  <View style={s.followersModalHeader}>
                    <Text style={s.followersCount}>{followerCount} {followerCount === 1 ? "follower" : "followers"}</Text>
                    <Pressable onPress={() => setShowFollowersModal(false)} hitSlop={8}><X size={18} color={t.color["text.primary"]} /></Pressable>
                  </View>
                  <ScrollView style={s.followersScrollArea} showsVerticalScrollIndicator={false}>
                    {followers.length === 0 ? (
                      <View style={s.followersEmpty}><Text style={s.followersEmptyText}>No followers yet</Text></View>
                    ) : followers.map((f: any, idx: number) => {
                      const isMe = user && f.username === user.username;
                      const followSlug = f.roaster_slug || f.username;
                      const amFollowing = myFollows.includes(followSlug);
                      const isRoasterAcct = f.account_type === "roaster" && f.roaster_slug;
                      return (
                        <View key={f.username}>
                          {idx > 0 && <View style={s.followerDivider} />}
                          <View style={s.followerRow}>
                            <Pressable onPress={() => { setShowFollowersModal(false); router.push(isRoasterAcct ? `/roaster/${f.roaster_slug}` : `/user/${f.username}`); }} style={s.followerPressable}>
                              {f.avatar_url ? (
                                <Image source={{ uri: resolveUploadUrl(f.avatar_url) }} style={s.followerAvatar} contentFit="cover" />
                              ) : (
                                <View style={s.followerAvatarFallback}>
                                  <Text style={s.followerInitial}>{(f.display_name || f.username || "?")[0].toUpperCase()}</Text>
                                </View>
                              )}
                              <View style={s.followerInfo}>
                                <Text style={s.followerName} numberOfLines={1}>{f.display_name}</Text>
                                {f.location && (
                                  <View style={s.followerLocationRow}>
                                    <MapPin size={12} color={t.color.accent} strokeWidth={2} />
                                    <Text style={s.followerLocation} numberOfLines={1}>{f.location}</Text>
                                  </View>
                                )}
                              </View>
                            </Pressable>
                            {!isMe && (
                              <Pressable onPress={() => handleToggleFollowInModal(followSlug)} style={[s.followerFollowBtn, amFollowing && s.followerFollowBtnActive]}>
                                {!amFollowing && <Plus size={10} color={t.color["text.secondary"]} strokeWidth={2.5} />}
                                {amFollowing && <Check size={10} color={t.color["text.primary"]} strokeWidth={2.5} />}
                                <Text style={[s.followerFollowBtnText, amFollowing && s.followerFollowBtnTextActive]}>{amFollowing ? "Following" : "Follow"}</Text>
                              </Pressable>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </ScrollView>
                </View>
              </View>
            </Modal>

            <View style={{ height: 100 }} />
          </ScrollView>

          {isEditing && <View style={s.editDimOverlay} pointerEvents="none" />}

          {/* FAB — owner, posts tab */}
          {isOwner && !isEditing && activeTab === "posts" && (
            <Pressable onPress={() => setShowCompose(true)} style={s.fab}>
              <Plus size={22} color={t.color["text.on-dark"]} strokeWidth={2.5} />
            </Pressable>
          )}

          {/* Edit post modal */}
          <Modal visible={!!editingPost} transparent animationType="fade" onRequestClose={() => setEditingPost(null)}>
            <View style={s.followersOverlayWrap}>
              <Pressable style={s.followersOverlayBg} onPress={() => setEditingPost(null)} />
              <View style={s.editPostModal}>
                {editingPost && (
                  <ComposePost
                    onSubmit={async (data) => { await handleEditPost(editingPost.id, data); }}
                    onCancel={() => setEditingPost(null)}
                    user={user}
                    products={products}
                    initialData={{ body: editingPost.teaser, images: editingPost.images || [], location: editingPost.location || "" }}
                  />
                )}
              </View>
            </View>
          </Modal>

          {/* Image upload modals */}
          <ImageUploadModal visible={showLogoUpload} title="Upload Logo" purpose="logo" currentUrl={editLogo}
            onConfirm={(url) => setEditLogo(url)} onClose={() => setShowLogoUpload(false)} />
          <ImageUploadModal visible={showHeroUpload} title="Upload Cover Image" purpose="hero" currentUrl={editHero}
            onConfirm={(url) => setEditHero(url)} onClose={() => setShowHeroUpload(false)} />
        </View>
      </View>
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const liningNumerals = Platform.OS === "web"
  ? { fontFeatureSettings: "'lnum', 'pnum'" } as any : {};

const s = StyleSheet.create({
  notFound: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: t.color.bg },
  notFoundText: { fontFamily: t.font["body.regular"], fontSize: 16, color: t.color["text.primary"] },

  pageContainer: { flexDirection: "row", overflow: "hidden" } as any,

  leftPanel: {
    width: "42%" as any, backgroundColor: t.color["roaster.panel"],
    paddingHorizontal: "6.25%" as any, paddingTop: 126, paddingBottom: 32,
    flexDirection: "column", overflowY: "auto" as any, flexShrink: 0,
  } as any,

  backBtn: { flexDirection: "row", alignItems: "center", gap: 14, marginBottom: 85 },
  backText: { fontFamily: t.font["body.medium"], fontSize: 14, color: t.color.divider },

  shareRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  shareText: { fontFamily: t.font["body.medium"], fontSize: 14, color: t.color.divider, letterSpacing: 0.5 },

  roasterName: {
    fontFamily: t.font.display, fontSize: 56.8, color: t.color["text.on-dark"],
    lineHeight: 63, marginTop: 8, marginBottom: 12, ...liningNumerals,
  } as any,

  aboutBlock: { paddingRight: 20 },
  aboutText: { fontFamily: t.font["body.regular"], fontSize: 12, color: t.color.divider, lineHeight: 18 },
  aboutMore: { fontFamily: t.font["body.semibold"], fontSize: 12, color: t.color["text.on-dark"] },

  tagBand: { marginBottom: 14 },
  rule: { height: 1, width: 280, alignSelf: "flex-start" as any, backgroundColor: "rgba(250,248,240,0.25)", marginVertical: 0 },
  tagText: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.on-dark"], lineHeight: 18, paddingVertical: 8 },

  metaRow: { flexDirection: "row", flexWrap: "wrap" as any, gap: 20, marginTop: 5, marginBottom: 9 },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  metaText: { fontFamily: t.font["body.medium"], fontSize: 14, color: t.color["text.on-dark"] },

  followRow: { marginTop: 14 },

  // Inline editing
  inlineEdit: {
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: "rgba(250,248,240,0.1)", minHeight: 80, textAlignVertical: "top" as any,
  } as any,
  inlineEditTag: {
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
    backgroundColor: "rgba(250,248,240,0.1)", textAlign: "center" as any, flex: 1,
  } as any,
  inlineEditMeta: {
    fontFamily: t.font["body.medium"], fontSize: 14, color: t.color["text.on-dark"],
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: "rgba(250,248,240,0.1)", minWidth: 80,
  } as any,
  uploadTrigger: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 12, paddingVertical: 8 } as any,
  uploadThumb: { width: 72, height: 72, borderRadius: 10, borderWidth: 1, borderColor: "rgba(199,186,165,0.3)" },
  uploadThumbEmpty: {
    width: 72, height: 72, borderRadius: 10, borderWidth: 1,
    borderColor: "rgba(199,186,165,0.3)", borderStyle: "dashed" as any,
    alignItems: "center", justifyContent: "center",
  } as any,
  uploadTriggerText: { fontFamily: t.font["body.medium"], fontSize: 12, color: t.color.divider, textDecorationLine: "underline" as any },

  // Edit banner
  editBanner: {
    height: 44, flexDirection: "row", alignItems: "center",
    justifyContent: "space-between" as any, paddingHorizontal: 24, backgroundColor: t.color["text.primary"],
  } as any,
  editBannerLeft: { flexDirection: "row", alignItems: "center", gap: 8 } as any,
  editBannerLabel: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color.accent },
  editBannerRight: { flexDirection: "row", alignItems: "center", gap: 10 } as any,
  editBannerDiscard: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 4, borderWidth: 1, borderColor: "rgba(199,186,165,0.3)" },
  editBannerDiscardText: { fontFamily: t.font["body.medium"], fontSize: 12, color: t.color.divider },
  editBannerSave: { paddingHorizontal: 18, paddingVertical: 6, borderRadius: 4, backgroundColor: t.color.bg },
  editBannerSaveText: { fontFamily: t.font["body.semibold"], fontSize: 12, color: t.color["text.primary"] },

  // Right panel
  rightPanel: { flex: 1, position: "relative" as any, backgroundColor: t.color.bg },
  rightScroll: { flex: 1 },
  rightContent: { flexGrow: 1 },

  // Hero
  heroImageWrap: { width: "100%" as any, height: 334, backgroundColor: t.color["roaster.hero.fallback"], position: "relative" as any, overflow: "hidden" } as any,
  heroDragHint: {
    position: "absolute" as any, top: "50%" as any, left: "50%" as any,
    transform: [{ translateX: -70 }, { translateY: -14 }],
    backgroundColor: "rgba(0,0,0,0.5)", borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8,
  } as any,
  heroDragHintText: { fontFamily: t.font["body.medium"], fontSize: 12, color: t.color["text.on-dark"] },
  heroEditBtn: {
    position: "absolute" as any, bottom: 14, right: 14, flexDirection: "row", alignItems: "center",
    gap: 6, backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8,
  } as any,
  heroEditBtnText: { fontFamily: t.font["body.medium"], fontSize: 12, color: t.color["text.on-dark"] },

  editDimOverlay: {
    position: "absolute" as any, top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(250,248,240,0.5)", zIndex: 5,
  },

  // Tabs
  rightTabBar: {
    flexDirection: "row", alignItems: "stretch", backgroundColor: t.color.bg,
    height: 80, paddingLeft: 56, gap: 100, borderBottomWidth: 1, borderBottomColor: "rgba(215,209,196,0.5)",
  } as any,
  rightTab: { justifyContent: "center", position: "relative" } as any,
  rightTabUnderline: { position: "absolute", bottom: -1, left: 0, right: 0, height: 4, backgroundColor: t.color["text.primary"] } as any,
  rightTabText: { fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.muted"], letterSpacing: 0.5, textTransform: "uppercase" } as any,
  rightTabTextActive: { color: t.color["text.primary"] },

  // FAB
  fab: {
    position: "absolute" as any, bottom: 28, right: 28,
    width: t.size["fab.size"], height: t.size["fab.size"], borderRadius: t.size["fab.size"] / 2,
    alignItems: "center", justifyContent: "center", backgroundColor: t.color["text.primary"],
    shadowColor: "#000", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.18, shadowRadius: 12, elevation: 8, zIndex: 50,
  } as any,

  // Empty posts
  emptyPostsWrap: {
    marginHorizontal: 28, marginVertical: 24, padding: 20, borderRadius: 8,
    borderWidth: 1, borderColor: t.color.border, backgroundColor: "#FFFEFB",
  },
  emptyPostsTitle: { fontFamily: t.font.display, fontSize: 20, color: t.color["text.primary"], marginBottom: 8 },
  emptyPostsBody: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.secondary"], lineHeight: 19 },
  emptyPostsBtn: {
    marginTop: 14, alignSelf: "flex-start" as any, paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 4, borderWidth: 1, borderColor: t.color["text.primary"],
  },
  emptyPostsBtnText: { fontFamily: t.font["body.medium"], fontSize: 13, color: t.color["text.primary"] },

  // Dividers
  dividerLight: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(215,209,196,0.35)", marginHorizontal: 20 },

  // Grid heading
  gridHeading: {
    fontFamily: t.font.display, fontSize: 20, color: t.color["text.primary"],
    lineHeight: 28, paddingHorizontal: 28, paddingTop: 24, paddingBottom: 20, ...liningNumerals,
  } as any,

  // Followers modal
  followersOverlayWrap: { flex: 1, justifyContent: "center", alignItems: "center" } as any,
  followersOverlayBg: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.4)" } as any,
  followersModal: {
    backgroundColor: t.color.bg, borderRadius: t.radius.lg,
    width: "90%", maxWidth: 400, maxHeight: "70%",
    paddingHorizontal: 24, paddingTop: 20, paddingBottom: 8, zIndex: 1,
  } as any,
  followersModalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 } as any,
  followersScrollArea: { flexGrow: 0 },
  followersCount: { fontFamily: t.font["body.semibold"], fontSize: 14, color: t.color["text.primary"] },
  followersEmpty: { paddingVertical: 40, alignItems: "center" } as any,
  followersEmptyText: { fontFamily: t.font["body.regular"], fontSize: 14, color: t.color["text.muted"] },
  followerRow: { flexDirection: "row", alignItems: "center", paddingVertical: 12, paddingHorizontal: 4, borderRadius: 6 } as any,
  followerPressable: { flex: 1, flexDirection: "row", alignItems: "center", gap: 14, minWidth: 0 } as any,
  followerFollowBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 4, width: 71, height: 27, borderRadius: 2, borderWidth: 1.5,
    borderColor: t.color["text.secondary"], flexShrink: 0,
  } as any,
  followerFollowBtnActive: { width: 88, backgroundColor: t.color.accent, borderColor: t.color.accent },
  followerFollowBtnText: { fontFamily: t.font["body.semibold"], fontSize: 12, color: t.color["text.secondary"] },
  followerFollowBtnTextActive: { color: t.color["text.primary"] },
  followerDivider: { height: StyleSheet.hairlineWidth, backgroundColor: "rgba(215,209,196,0.5)" },
  followerAvatar: { width: t.size["avatar.xl"], height: t.size["avatar.xl"], borderRadius: t.size["avatar.xl"] / 2 },
  followerAvatarFallback: {
    width: t.size["avatar.xl"], height: t.size["avatar.xl"], borderRadius: t.size["avatar.xl"] / 2,
    backgroundColor: t.color["text.primary"], alignItems: "center", justifyContent: "center",
  } as any,
  followerInitial: { fontFamily: t.font["body.semibold"], fontSize: 18, color: t.color["text.on-dark"] },
  followerInfo: { flex: 1, minWidth: 0 },
  followerName: { fontFamily: t.font["body.regular"], fontSize: 18, color: t.color["text.primary"] },
  followerLocationRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 } as any,
  followerLocation: { fontFamily: t.font["body.regular"], fontSize: 13, color: t.color["text.secondary"] },

  // Edit post modal
  editPostModal: {
    backgroundColor: t.color.bg, borderRadius: t.radius.xl,
    width: "90%", maxWidth: 560, maxHeight: "85%", overflow: "hidden" as any,
    shadowColor: "#000", shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.25, shadowRadius: 24, elevation: 16,
    zIndex: 1,
  } as any,
});
